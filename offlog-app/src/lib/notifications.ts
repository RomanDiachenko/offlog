import { writable, get } from 'svelte/store';
import db, { getAllActiveTasksWithReminders, updateTask, getTaskById, clearReminderIfUnchanged } from './db';
import { invokeTauri, isTauri as isTauriPlatform, getQuietHours, getNotificationsEnabled } from '../config';
import type { TaskDoc, ProjectDoc } from './types';
import { fmtDay, dayOf } from './utils';

// The line under a reminder's title, the same on every platform.
export function reminderBody(task: TaskDoc): string {
  return task.due_date ? `Due ${fmtDay(dayOf(task.due_date), { weekday: true })}` : 'Reminder';
}

// Spread queued reminders out instead of letting them all land on the
// window's end instant: a dozen reminders firing in the same tick present to
// Android's notification manager (or the Windows toast queue) as a burst,
// which some OSes throttle or collapse rather than showing individually.
// 15s * a reminder's position in the current scheduling pass keeps a
// realistic queue spread over seconds-to-minutes without meaningfully
// delaying anyone.
const QUIET_HOURS_STAGGER_STEP_MS = 15_000;

// Quiet hours: if `at` falls inside the configured local wall-clock
// window, returns the Date for the window's end instead (the next
// occurrence of the end time after `at`, plus `staggerIndex` *
// QUIET_HOURS_STAGGER_STEP_MS so a batch of queued reminders doesn't all
// land on the same instant) — the reminder queues rather than firing.
// Returns `at` unchanged when quiet hours are off or `at` isn't inside
// the window (stagger never applies to an on-time reminder). Exported
// for tests/notifications.test.ts.
export function applyQuietHours(at: Date, staggerIndex = 0): Date {
  const q = getQuietHours();
  if (!q.enabled) return at;
  const [sh, sm] = q.start.split(':').map(Number);
  const [eh, em] = q.end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const atMin = at.getHours() * 60 + at.getMinutes();
  const wraps = startMin > endMin; // e.g. 22:00 -> 07:00
  const inWindow = wraps ? (atMin >= startMin || atMin < endMin) : (atMin >= startMin && atMin < endMin);
  if (!inWindow) return at;
  const end = new Date(at);
  end.setHours(eh, em, 0, 0);
  // Only push to the next day when `at` is on the pre-midnight side of a
  // wrapping window (e.g. 23:00 with 22:00->07:00 ends 07:00 tomorrow);
  // the post-midnight side (e.g. 02:00) already ends later the same day.
  if (wraps && atMin >= startMin) end.setDate(end.getDate() + 1);
  return new Date(end.getTime() + staggerIndex * QUIET_HOURS_STAGGER_STEP_MS);
}

// Set by a notification click (native action or web Notification.onclick).
// App.svelte watches this to open the corresponding task.
export const pendingOpenTaskId = writable<string | null>(null);

// A notification action ("Done"/"Snooze 1h" straight from the toast) that
// failed its underlying updateTask() write. Same store-and-let-App-react
// pattern as pendingOpenTaskId above, deliberately NOT a direct
// showError() import: store.ts already imports this module, so importing it
// back would be a circular import and would break the one-directional layer
// rule. These handlers can't be awaited by their caller (they run inside a
// plain OS callback), and swallowing the rejection outright would mean the
// user taps "Done" on a reminder, nothing happens, and nothing says so.
export const notificationActionError = writable<string>('');

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';
export const permissionState = writable<PermissionState>('default');

// Android 12+ splits notification scheduling into two separate grants:
// POST_NOTIFICATIONS (can this app show a notification at all — the
// `permissionState` above) and the "Alarms & reminders" special access
// (can this app fire one at an *exact* time via AlarmManager). The second
// one has no in-app runtime prompt dialog — it's a system settings toggle
// — so a reminder can look "scheduled" while actually being silently
// delivered late (batched into the OS's next inexact wakeup window,
// sometimes minutes off) with nothing in the UI explaining why. Only
// meaningful on native; stays 'unsupported' on web (reminders there are
// setTimeout-based and don't go through AlarmManager at all).
export type ExactAlarmState = 'granted' | 'denied' | 'unsupported';
export const exactAlarmState = writable<ExactAlarmState>('unsupported');

// Bare-called from onMount and button handlers with no local error handling
// at any call site, so a plugin-call rejection is caught here instead of
// becoming an unhandled rejection -- 'denied' is the safe fallback state.
export async function checkExactAlarmPermission(): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const res = await LocalNotifications.checkExactNotificationSetting();
    exactAlarmState.set(res.exact_alarm === 'granted' ? 'granted' : 'denied');
  } catch {
    exactAlarmState.set('denied');
  }
}

// Bumped when a reminder is newly set while exact alarms are off, at most
// once per launch, so the phone shell can offer the fix in context. Never
// sent to the system page unasked: that only happens from requestExactAlarmPermission().
export const exactAlarmNudge = writable(0);
let exactNudged = false;
// Reminders seen by the previous native pass; null until the first one, so
// reminders that already existed at launch never count as "just set".
let knownReminders: Set<string> | null = null;

// Deep-links to the OS "Alarms & reminders" settings screen for this app —
// there's no runtime permission dialog for this one, unlike requestPermission().
export async function requestExactAlarmPermission(): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const res = await LocalNotifications.changeExactNotificationSetting();
    const was = get(exactAlarmState);
    exactAlarmState.set(res.exact_alarm === 'granted' ? 'granted' : 'denied');
    // Re-arm here: recheckGrants() on resume compares against the state just
    // set, sees no change, and would leave existing alarms inexact.
    if (get(exactAlarmState) !== was) await rescheduleAll();
  } catch {
    exactAlarmState.set('denied');
  }
}

const isNative = () => !!window.Capacitor?.isNativePlatform?.();
// Deterministic 32-bit integer id from a task's string id — Capacitor's
// local-notifications plugin requires numeric ids.
function numericId(taskId: string): number {
  let h = 0;
  for (let i = 0; i < taskId.length; i++) {
    h = (h * 31 + taskId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

// Android's "not asked yet" is not "blocked": a fresh install must read as
// 'default' so nothing says Blocked before Offlog has ever asked.
function displayState(display: string): PermissionState {
  return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'default';
}

// Bare-called from Enable buttons with no local error handling, so a
// plugin-call rejection is caught here instead of becoming an unhandled
// rejection -- 'denied' is the safe fallback state.
export async function requestPermission(): Promise<PermissionState> {
  try {
    if (isNative()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const res = await LocalNotifications.requestPermissions();
      const state = displayState(res.display);
      permissionState.set(state);
      // Reminders wait for the grant (see scheduleNative); arm them now.
      if (state === 'granted') rescheduleAll().catch(() => {});
      return state;
    }
    // Not the web Notification API on desktop: WebView2 has no handler for
    // its prompt, so requestPermission() silently resolves "denied". Toasts
    // go through the send_task_notification command instead.
    if (isTauriPlatform()) {
      // Windows has no prompt to request, only a per-app switch -- read it
      // (see check_desktop_notification_setting's own comment).
      const enabled = await invokeTauri<boolean>('check_desktop_notification_setting');
      const state: PermissionState = enabled ? 'granted' : 'denied';
      permissionState.set(state);
      return state;
    }
    if (typeof Notification === 'undefined') {
      permissionState.set('unsupported');
      return 'unsupported';
    }
    const res = await Notification.requestPermission();
    const state = res as PermissionState;
    permissionState.set(state);
    return state;
  } catch {
    permissionState.set('denied');
    return 'denied';
  }
}

export function checkPermission(): void {
  if (isNative() || isTauriPlatform()) return; // resolved lazily via initNotificationListeners() instead
  if (typeof Notification === 'undefined') { permissionState.set('unsupported'); return; }
  permissionState.set(Notification.permission as PermissionState);
}

// ── Web scheduling (best-effort — see docs/tech.md for the "app must stay
// running" caveat; there's no push backend behind this local-first app) ──
//
// DST/timezone: reminder_at is stored as an absolute ISO instant (UTC epoch
// under the hood). Every delay computed below is
// `new Date(reminder_at).getTime() - Date.now()` — plain epoch-ms
// arithmetic, DST-safe by construction, with no local-time component for a
// DST transition to corrupt. Keep it that way. The native path
// (scheduleNative below) hands Android's AlarmManager an absolute Date for
// the same reason.

const _webTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_TIMEOUT = 2_147_483_647; // setTimeout's 32-bit signed int limit (~24.8 days)

// Which reminders this device has already shown, keyed by
// `${id}:${reminder_at}` so a later reminder on the same task still fires.
// Kept per device, never written to the task: clearing reminder_at on fire
// synced to the phone and cancelled its alarm before it rang, and two devices
// clearing the same reminder offline came back as a sync conflict. A fired
// reminder stays on its task until the catch-up window passes; only then is
// it cleared, long after every device has had its turn.
// The set is claimed before any await, so overlapping rescheduleAll() passes
// (catch-up and a live timer for the same instant) show one notification.
const FIRED_KEY = 'offlog_fired_reminders';
const FIRED_IDS_MAX = 500;
const _firedIds = new Set<string>(readFired());
function readFired(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch { return []; }
}
function saveFired() {
  try { localStorage.setItem(FIRED_KEY, JSON.stringify([..._firedIds])); } catch {}
}
function firedKey(task: TaskDoc): string { return `${task._id}:${task.reminder_at}`; }
function rememberFired(key: string) {
  _firedIds.add(key);
  while (_firedIds.size > FIRED_IDS_MAX) {
    const oldest = _firedIds.values().next().value as string | undefined;
    if (oldest === undefined) break;
    _firedIds.delete(oldest);
  }
  saveFired();
}
function forgetFired(key: string) {
  if (_firedIds.delete(key)) saveFired();
}

function fireWebNotification(task: TaskDoc): Promise<void> {
  const id = task._id!;
  const key = firedKey(task);
  if (_firedIds.has(key)) return Promise.resolve();
  rememberFired(key);
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return Promise.resolve();
  const n = new Notification(task.title, {
    body: reminderBody(task),
    tag: id,
  });
  n.onclick = () => {
    window.focus();
    pendingOpenTaskId.set(id);
    n.close();
  };
  return Promise.resolve();
}

function scheduleWeb(task: TaskDoc, staggerIndex = 0) {
  const id = task._id!;
  const existing = _webTimers.get(id);
  if (existing) clearTimeout(existing);
  if (!task.reminder_at) return;
  const delay = applyQuietHours(new Date(task.reminder_at), staggerIndex).getTime() - Date.now();
  if (delay <= 0) return; // handled by the catch-up check instead
  // Too far out to schedule now — picked up on a later reload() once it's
  // within range instead (every app open + every live sync change calls
  // rescheduleAll()). This only drops a reminder if it is >24.8 days out AND
  // the web app is never opened again until after it is due — an accepted
  // residual edge case rather than a background re-check timer. The native
  // path has no such limit.
  if (delay > MAX_TIMEOUT) return;
  _webTimers.set(id, setTimeout(() => { fireWebNotification(task); _webTimers.delete(id); }, delay));
}

function cancelWeb(taskId: string) {
  const existing = _webTimers.get(taskId);
  if (existing) { clearTimeout(existing); _webTimers.delete(taskId); }
}

// Reminders due while the app/tab wasn't open can't fire on web (no push
// server behind this app) — fire them immediately on load instead, as
// long as they're not too stale to be useful.
//
// A reminder past this window must be explicitly cleared, not just skipped:
// otherwise it is never fired (too stale) and never cleared, stays "active"
// indefinitely, and re-enters this same dead-end check on every reload. Every
// stale reminder gets closed out one way or the other, never left dangling.
// Exported for tests/notifications.test.ts. Returns a promise resolving once
// every fire/clear write below has landed -- production callers need not
// await it, but tests must, rather than racing a setTimeout against real
// PouchDB writes.
//
// The 24h window is deliberately generous: a reminder that came due while the
// app wasn't running is fired late rather than dropped. Anything past the
// window has its reminder_at cleared, so too short a window silently destroys
// the user's setting without it ever firing -- easy to hit on desktop, where
// scheduling is setTimeout-based and needs the app running (e.g. a 23:00
// reminder deferred to 07:00 by quiet hours on a machine that's off
// overnight). 24h covers a normal overnight or workday gap.
const CATCH_UP_WINDOW_MS = 24 * 60 * 60 * 1000;

// A failed clear isn't user-initiated and isn't worth a toast: the next
// catch-up pass retries it.
function clearStale(t: TaskDoc): Promise<void> {
  const key = firedKey(t);
  return clearReminderIfUnchanged(t._id!, t.reminder_at!).then(() => forgetFired(key), () => {});
}

export function catchUpWeb(tasks: TaskDoc[]): Promise<void> {
  const now = Date.now();
  const pending: Promise<void>[] = [];
  let queuedCount = 0;
  for (const t of tasks) {
    if (!t.reminder_at) continue;
    const at = new Date(t.reminder_at).getTime();
    if (at > now) continue; // still in the future — scheduleWeb() owns this one
    if (now - at < CATCH_UP_WINDOW_MS) {
      // Firing "now" — if quiet hours are currently active, queue until
      // they end instead of firing immediately, same as a future
      // reminder would via scheduleWeb()'s applyQuietHours() call.
      // Staggered by queue position so a whole backlog doesn't land on
      // the OS notification queue in the same instant.
      const fireAt = applyQuietHours(new Date(now), queuedCount).getTime();
      if (fireAt > now) {
        queuedCount++;
        const id = t._id!;
        const existing = _webTimers.get(id);
        if (existing) clearTimeout(existing);
        _webTimers.set(id, setTimeout(() => { fireWebNotification(t); _webTimers.delete(id); }, fireAt - now));
      } else {
        pending.push(fireWebNotification(t));
      }
    }
    else pending.push(clearStale(t));
  }
  return Promise.all(pending).then(() => {});
}

// ── Native (Android) scheduling — genuinely fires while the app is fully
// closed, since it's handed off to the OS scheduler ──

// "Done" and "Snooze 1h" action buttons on the notification itself — lets a
// reminder be handled from the lock screen without opening the app. Must be
// registered before any notification using this actionTypeId is scheduled
// (Android reads the action type at schedule time, not at display time).
const REMINDER_ACTION_TYPE = 'REMINDER_ACTIONS';

// Android 8+ requires a notification channel per notification, and every
// scheduled notification must carry a matching channelId. Without an explicit
// one, the OS/plugin falls back to an auto-created "Default" channel at
// IMPORTANCE_DEFAULT or lower: no guaranteed sound, no heads-up popup, and
// its importance is then fixed forever at whatever it was on first
// auto-creation (apps cannot change a channel's importance afterwards, only
// the user can, via system settings). An explicit high-importance channel,
// created once up front, is the only way to guarantee sound + heads-up.
const REMINDER_CHANNEL_ID = 'reminders';

async function ensureReminderChannel() {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.createChannel({
    id: REMINDER_CHANNEL_ID,
    name: 'Task reminders',
    description: 'Reminders for tasks with a due date or reminder time',
    importance: 5, // IMPORTANCE_HIGH — sound + heads-up popup
    visibility: 1, // VISIBILITY_PUBLIC — full content on lock screen
    vibration: true,
  });
}

async function scheduleNative(tasks: TaskDoc[]) {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await ensureReminderChannel();
  await LocalNotifications.registerActionTypes({
    types: [{
      id: REMINDER_ACTION_TYPE,
      actions: [
        { id: 'done', title: 'Done' },
        { id: 'snooze', title: 'Snooze 1h' },
      ],
    }],
  });
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
  }
  if (get(exactAlarmState) === 'unsupported') await checkExactAlarmPermission();
  // isExactNotification must follow the grant: the plugin's schedule() opens
  // the system "Alarms & reminders" page by itself whenever an exact alarm
  // is requested without it, which would happen on every launch.
  const exact = get(exactAlarmState) === 'granted';
  const upcoming = tasks.filter(t => t.reminder_at && new Date(t.reminder_at).getTime() > Date.now());
  const keys = new Set(upcoming.map(t => `${t._id}:${t.reminder_at}`));
  if (!exact && !exactNudged && knownReminders && [...keys].some(k => !knownReminders!.has(k))) {
    exactNudged = true;
    exactAlarmNudge.update(n => n + 1);
  }
  knownReminders = keys;
  const toSchedule = upcoming
    .map((t, i) => ({
      id: numericId(t._id!),
      title: t.title,
      body: reminderBody(t),
      schedule: { at: applyQuietHours(new Date(t.reminder_at!), i) },
      extra: { taskId: t._id },
      actionTypeId: REMINDER_ACTION_TYPE,
      channelId: REMINDER_CHANNEL_ID,
      isExactNotification: exact,
    }));
  // The plugin's schedule() asks Android for permission by itself when it
  // isn't granted, which put the prompt on the very first launch. Reminders
  // wait instead; requestPermission() and recheckGrants() reschedule once
  // the user allows them.
  if (!toSchedule.length || (await LocalNotifications.checkPermissions()).display !== 'granted') return;
  await LocalNotifications.schedule({ notifications: toSchedule });
}

// ── Native (Tauri desktop) scheduling — real Windows toast notifications,
// but on a JS timer, same mechanism as scheduleWeb() above ──
//
// Windows has no OS-side scheduling an unpackaged app can use, so the desktop
// path does what scheduleWeb() does -- a JS setTimeout, since the app stays
// running in the tray -- and shows a native toast at fire time through the
// Rust command send_task_notification (tauri-winrt-notification). A click or
// a Done/Snooze press comes back as the 'notification-action' event listened
// for below. Reminders therefore fire only while Offlog is running; after
// Quit they wait for the next start's catch-up. Reuses _webTimers/_firedIds
// -- mutually exclusive with the web path at runtime (one platform per
// session), so sharing that is safe.
// Windows shows nothing, and Show() still succeeds, when Offlog's toasts are
// switched off -- and that switch can change while the app sits in the tray.
// So the setting is read at fire time: while it's off the reminder keeps its
// reminder_at, as on Android, and the hourly re-arm fires it once allowed.
// A toast that could not be sent is retried by the next re-arm.
async function fireTauriNotification(task: TaskDoc): Promise<void> {
  const id = task._id!;
  const key = firedKey(task);
  if (_firedIds.has(key)) return;
  // Claimed before the await: a re-arm pass running meanwhile would
  // otherwise pass the check above too and send a second toast.
  rememberFired(key);
  const allowed = await invokeTauri<boolean>('check_desktop_notification_setting').catch(() => true);
  permissionState.set(allowed ? 'granted' : 'denied');
  if (!allowed) { forgetFired(key); return; }
  try {
    await invokeTauri('send_task_notification', { title: task.title, body: reminderBody(task), taskId: id });
  } catch {
    forgetFired(key);
  }
}

function scheduleTauriTimer(task: TaskDoc, staggerIndex = 0) {
  const id = task._id!;
  const existing = _webTimers.get(id);
  if (existing) clearTimeout(existing);
  if (!task.reminder_at) return;
  const delay = applyQuietHours(new Date(task.reminder_at), staggerIndex).getTime() - Date.now();
  if (delay <= 0 || delay > MAX_TIMEOUT) return; // handled by catchUpTauri, or too far out for this session
  _webTimers.set(id, setTimeout(() => { fireTauriNotification(task); _webTimers.delete(id); }, delay));
}

// Same reasoning as catchUpWeb() — a reminder due while the app wasn't
// running has no OS-level catch-up on desktop either (see this section's
// header comment), so fire it on load instead if it's not too stale.
function catchUpTauri(tasks: TaskDoc[]) {
  const now = Date.now();
  // Shares catchUpWeb()'s 24h window — desktop scheduling is setTimeout-based,
  // so this is the path where an overnight gap would otherwise wipe a
  // reminder. See that constant's comment.
  let queuedCount = 0;
  for (const t of tasks) {
    if (!t.reminder_at) continue;
    const at = new Date(t.reminder_at).getTime();
    if (at > now) continue;
    if (now - at < CATCH_UP_WINDOW_MS) {
      const fireAt = applyQuietHours(new Date(now), queuedCount).getTime();
      if (fireAt > now) {
        queuedCount++;
        const id = t._id!;
        const existing = _webTimers.get(id);
        if (existing) clearTimeout(existing);
        _webTimers.set(id, setTimeout(() => { fireTauriNotification(t); _webTimers.delete(id); }, fireAt - now));
      } else {
        fireTauriNotification(t);
      }
    }
    else clearStale(t);
  }
}

async function scheduleTauri(tasks: TaskDoc[]) {
  for (const id of [..._webTimers.keys()]) cancelWeb(id);
  tasks.forEach((t, i) => scheduleTauriTimer(t, i));
  catchUpTauri(tasks);
}

// Moves a task to its project's last column — the same "done" rule used
// everywhere else in the app: "done" is positional, column_id ===
// columns.at(-1), and there is no separate done boolean.
async function completeTaskFromNotification(taskId: string): Promise<void> {
  const task = await getTaskById(taskId);
  if (!task) return;
  const project = await db.get(task.project_id) as ProjectDoc;
  const lastCol = project.columns.at(-1);
  if (!lastCol) return;
  await updateTask(taskId, { column_id: lastCol.id, reminder_at: null });
}

async function snoozeTaskFromNotification(taskId: string): Promise<void> {
  const at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await updateTask(taskId, { reminder_at: at });
  // rescheduleAll() runs on the next store reload (triggered by the write
  // above via the live change feed) and will pick up the new reminder_at —
  // no need to reschedule this one notification directly here.
}

export async function initNotificationListeners(): Promise<void> {
  if (isTauriPlatform()) {
    // Reads Windows' per-app switch -- see requestPermission()'s Tauri branch
    // and check_desktop_notification_setting's own comment.
    await requestPermission();
    const { listen } = await import('@tauri-apps/api/event');
    await listen<[string, string]>('notification-action', (event) => {
      const [actionId, taskId] = event.payload;
      if (!taskId) return;
      if (actionId === 'done') completeTaskFromNotification(taskId).catch(() => notificationActionError.set('Could not mark that task done. Please try again.'));
      else if (actionId === 'snooze') snoozeTaskFromNotification(taskId).catch(() => notificationActionError.set('Could not snooze that reminder. Please try again.'));
      else {
        // bare click (no action button) -- lib.rs emits '' for this case.
        // Windows brings no window forward on a toast click by itself, so
        // the app can stay behind other windows even though the card opens.
        invokeTauri('show_main_window').catch(() => {});
        pendingOpenTaskId.set(taskId);
      }
    });
    return;
  }
  if (!isNative()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const perm = await LocalNotifications.checkPermissions();
  permissionState.set(displayState(perm.display));
  await checkExactAlarmPermission();
  await ensureReminderChannel();
  // Back from the system settings (or anywhere): either grant may have
  // changed. A new exact-alarm state re-arms every reminder with it.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recheckGrants().catch(() => {}); });
  LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const taskId = (action.notification.extra as { taskId?: string } | undefined)?.taskId;
    if (!taskId) return;
    if (action.actionId === 'done') completeTaskFromNotification(taskId).catch(() => notificationActionError.set('Could not mark that task done. Please try again.'));
    else if (action.actionId === 'snooze') snoozeTaskFromNotification(taskId).catch(() => notificationActionError.set('Could not snooze that reminder. Please try again.'));
    else pendingOpenTaskId.set(taskId); // 'tap' (default open) — anything else falls through to opening the task
  });
}

export async function recheckGrants(): Promise<void> {
  if (!isNative()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const perm = await LocalNotifications.checkPermissions();
  const shown = get(permissionState);
  permissionState.set(displayState(perm.display));
  const before = get(exactAlarmState);
  await checkExactAlarmPermission();
  if (get(exactAlarmState) !== before || get(permissionState) !== shown) await rescheduleAll();
}

// Cancel-all-then-reschedule-from-scratch, called after every store reload
// (init + every live sync change). Simple, self-healing, and cheap at the
// scale of a personal task manager — no need to track every individual
// create/update/delete/complete site separately.
// One pass at a time: on Android a pass is several plugin round-trips
// (pending, cancel, schedule), and two interleaved passes can re-arm a
// stale list after the fresh one. A call during a pass queues one rerun.
let _pass: Promise<void> | null = null, _rerun = false;
export function rescheduleAll(): Promise<void> {
  if (_pass) { _rerun = true; return _pass; }
  _pass = (async () => {
    let failure: unknown = null;
    try {
      do {
        _rerun = false;
        try { await reschedulePass(); failure = null; } catch (e) { failure = e; }
      } while (_rerun);
    } finally { _pass = null; }
    if (failure) throw failure;
  })();
  return _pass;
}

async function reschedulePass(): Promise<void> {
  // Master in-app toggle (config.ts's getNotificationsEnabled) -- an empty
  // task list here means every scheduling path below cancels whatever it
  // already had pending instead of re-arming it, same effect as "disabled"
  // should have, without a separate cancel-everything code path per platform.
  const tasks = getNotificationsEnabled() ? await getAllActiveTasksWithReminders() : [];
  if (isNative()) {
    await scheduleNative(tasks);
  } else if (isTauriPlatform()) {
    await scheduleTauri(tasks);
  } else {
    for (const id of [..._webTimers.keys()]) cancelWeb(id);
    tasks.forEach((t, i) => scheduleWeb(t, i));
    catchUpWeb(tasks);
  }
}
