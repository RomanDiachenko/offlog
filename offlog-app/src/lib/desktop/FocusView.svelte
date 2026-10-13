<script lang="ts">
  import { ICON } from '../shared/iconPaths';
  import { onMount, createEventDispatcher } from 'svelte';
  import { getOpenTasksForFocusPicker, updateTask, getTaskById, subscribe } from '../db';
  import { projects, showError } from '../store';
  import { PRIORITY_COLOR as PRIO_COLOR, PRIORITY_LABEL as PRIO_LABEL } from '../constants';
  import CardDetail from './CardDetail.svelte';
  import type { TaskDoc, ProjectDoc } from '../types';
  import { hapticToggle } from '../haptics';
  import { today, loadFocusLock, saveFocusLock, type FocusLock } from '../focusLock';
  import { onNewDay } from '../today';
  import { rankPicker, type Reason as SuggestReason } from '../shared/focusRank';
  import { offerUndo } from '../undoToast';

  const dispatch = createEventDispatcher<{ menu: void; search: void }>();

  // A daily commitment lock, not an auto-computed priority list: up to 3
  // tasks, picked once, locked until each is done or the day rolls over.
  // Lock read/write lives in focusLock.ts, shared with DashboardView's
  // "Daily Brief" card — see it for why this isn't a PouchDB doc.
  const MAX_COMMIT = 3;

  let lock: FocusLock | null = loadFocusLock();
  let lockedTasks: TaskDoc[] = [];
  let pickerTasks: (TaskDoc & { project_name?: string })[] = [];
  const SUGGEST_LABEL: Record<SuggestReason, string> = {
    pinned: 'Pinned', overdue: 'Overdue', due_soon: 'Due soon', priority: 'High priority',
  };
  let suggestedReasons = new Map<string, SuggestReason>();
  let selected: string[] = [];

  // Scoring and the round-robin spread across reasons are shared with the
  // phone (shared/focusRank.ts). The reason a task made the cut is shown as
  // a colored label -- "why" matters more than "that" when committing.
  function arrangePicker<T extends TaskDoc>(tasks: T[]): T[] {
    const { suggested, rest } = rankPicker(tasks, today(), MAX_COMMIT);
    suggestedReasons = new Map(suggested.map(x => [x.task._id!, x.reason]));

    // The suggested notes must land near the top of the board but spread
    // across roughly the first 10 cards, not stacked as a consecutive
    // block. Bucket-major order alone doesn't guarantee "near the top" —
    // several non-suggested pinned tasks can list before the overdue
    // bucket's suggested pick. So: build a "top window" of up to 10 slots,
    // place the suggested picks at evenly-spaced slots within it (in their
    // round-robin pick order), fill the gaps
    // with the rest in bucket-major order, then append the leftovers.
    const suggestedFirst = suggested.map(x => x.task);

    const windowSize = Math.min(10, suggestedFirst.length + rest.length);
    const window: (T | null)[] = new Array(windowSize).fill(null);
    suggestedFirst.forEach((t, i) => {
      const ideal = Math.round(i * (windowSize - 1) / Math.max(1, suggestedFirst.length - 1 || 1));
      let slot = Math.min(windowSize - 1, ideal);
      while (window[slot]) slot = (slot + 1) % windowSize;
      window[slot] = t;
    });
    let ri = 0;
    for (let i = 0; i < windowSize; i++) if (!window[i]) window[i] = rest[ri++];
    return [...(window.filter((t): t is T => !!t)), ...rest.slice(ri)];
  }
  let detailTask: TaskDoc | null = null;
  let detailProject: ProjectDoc | null = null;
  // See KanbanBoard.svelte's identical detailOpenSession for why this
  // exists — {#key detailTask._id} alone doesn't change value on a fast
  // close-then-reopen of the same task.
  let detailOpenSession = 0;

  async function loadLockedTasks() {
    if (!lock) { lockedTasks = []; return; }
    const fetched = await Promise.all(lock.taskIds.map(id => getTaskById(id)));
    // !archived too, not just !deleted — every other read path in the app
    // (getOpenTasksForFocusPicker, getAllTasksDue, etc.) excludes both, so
    // a task archived elsewhere must not stay actionable here.
    lockedTasks = fetched.filter((t): t is TaskDoc => !!t && !t.deleted && !t.archived);
  }

  // Picking more for a lock already made: the picker shows again, minus
  // what is locked, with room for the rest of MAX_COMMIT.
  let adding = false;
  $: lockedIds = new Set(lockedTasks.map(t => t._id!));
  $: room = lock ? MAX_COMMIT - lockedTasks.length : MAX_COMMIT;
  $: picking = !lock || adding;
  $: pickable = lock ? pickerTasks.filter(t => !lockedIds.has(t._id!)) : pickerTasks;

  async function loadPicker() { pickerTasks = arrangePicker(await getOpenTasksForFocusPicker()); }

  async function refresh() {
    lock = loadFocusLock();
    if (!lock) adding = false;
    if (lock) await loadLockedTasks();
    if (!lock || adding) await loadPicker();
  }

  async function startAdding() {
    selected = [];
    adding = true;
    await loadPicker();
  }

  // The lock is date-stamped and loadFocusLock() already discards a stale
  // one, but nothing re-invoked it on the clock -- refresh() only fired on
  // mount and task mutations, so a tray-resident desktop session left open
  // past midnight kept showing yesterday's lock as "Today's Focus" until an
  // unrelated write happened to trigger a reload.
  onMount(() => {
    refresh();
    const unsub = subscribe(() => refresh());
    const unsubDay = onNewDay(() => refresh());
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      unsub();
      unsubDay();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  });

  function toggleSelect(id: string) {
    if (selected.includes(id)) selected = selected.filter(x => x !== id);
    else if (selected.length < room) selected = [...selected, id];
  }

  async function commit() {
    if (!selected.length) return;
    const ids = [...(lock ? lockedTasks.map(t => t._id!) : []), ...selected].slice(0, MAX_COMMIT);
    saveFocusLock({ date: today(), taskIds: ids });
    selected = [];
    adding = false;
    await refresh();
  }

  // Removing and resetting act at once; Undo puts the previous lock back.
  function restoreLock(prev: FocusLock | null) {
    return async () => { saveFocusLock(prev); await refresh(); };
  }

  async function removeFromFocus(t: TaskDoc) {
    const prev = lock;
    const ids = lockedTasks.map(x => x._id!).filter(id => id !== t._id);
    saveFocusLock(ids.length ? { date: today(), taskIds: ids } : null);
    await refresh();
    offerUndo(`focus-remove:${t._id}`, 'Removed from focus', restoreLock(prev));
  }

  async function resetCommitment() {
    const prev = lock;
    saveFocusLock(null);
    selected = [];
    await refresh();
    offerUndo('focus-reset', 'Focus reset', restoreLock(prev));
  }

  function openDetail(t: TaskDoc) {
    detailOpenSession++;
    detailTask = t;
    detailProject = $projects.find(p => p._id === t.project_id) ?? null;
  }

  async function openRelatedTask(id: string) {
    const t = await getTaskById(id);
    if (!t) { showError('This task no longer exists.'); return; }
    const proj = $projects.find(p => p._id === t.project_id);
    if (!proj) { showError('Could not open this task right now.'); return; }
    detailOpenSession++;
    detailTask = t;
    detailProject = proj;
  }

  // Remembers, per task, which column it was in right before markDone()
  // moved it to the last column — in-memory only (resets on reload), just
  // enough to let the same checkbox undo a done-mark by clicking again.
  // Falls back to the project's first column when that memory is gone.
  let doneFromCol: Record<string, string> = {};

  async function markDone(t: TaskDoc) {
    const proj = $projects.find(p => p._id === t.project_id);
    if (!proj) return;
    const lastCol = proj.columns.at(-1)?.id;
    if (!lastCol) return;
    const target = t.column_id === lastCol
      ? (doneFromCol[t._id!] ?? proj.columns[0]?.id)
      : lastCol;
    if (!target || target === t.column_id) return;
    if (t.column_id !== lastCol) doneFromCol[t._id!] = t.column_id;
    try {
      await updateTask(t._id!, { column_id: target });
      await refresh();
      hapticToggle();
    } catch {
      showError('Could not update task. Please try again.');
    }
  }

  // Shared by allDone and the row template, so a done task actually reads
  // as done rather than looking identical to an untouched one.
  function isDone(t: TaskDoc): boolean {
    const proj = $projects.find(p => p._id === t.project_id);
    return !!proj && t.column_id === proj.columns.at(-1)?.id;
  }
  $: allDone = lock !== null && lockedTasks.length > 0 && lockedTasks.every(isDone);

  // The picker uses the full available space as a scattered "brainstorm
  // corkboard" of varying-size note cards rather than a capped-width list.
  // Size and tilt are derived deterministically from the task id (a stable
  // hash, not Math.random()) so cards don't jitter to a new size/angle on
  // every reactive re-render — same task always looks the same until the
  // picker itself reloads. Actual layout is still flow-based (flex-wrap),
  // not true absolute-random positioning — real floating/overlapping
  // cards would be unusable (unclickable overlaps, broken tab order,
  // no responsive story), so "floating and scattered" is expressed
  // through size variety + a few degrees of rotation, not literal chaos.
  function hashId(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h;
  }
  const SIZES = ['note-sm', 'note-md', 'note-lg'] as const;
  function noteSize(t: TaskDoc & { project_name?: string }): string {
    if (suggestedReasons.has(t._id!)) return 'note-lg'; // suggested tasks are always at least this big
    // Full 3-way size mix — a non-suggested note can land on note-lg too.
    // What marks a *suggested* note out is the accent border tint plus its
    // suggest-chip, not size alone.
    return SIZES[hashId(t._id!) % 3];
  }
  // A deliberately varied, mostly-non-zero spread: the corkboard character
  // is intentional, so don't flatten these. Only 1 of 8 buckets is dead
  // flat; the rest vary in both directions but stay gentle.
  const TILTS = [-2, -1.2, -0.5, 0, 0.7, 1.5, 2.2, -1.7];
  function noteTilt(t: TaskDoc): number {
    return TILTS[hashId(t._id!) % TILTS.length];
  }
  // A little vertical stagger alongside the tilt — keeps the flex-grow
  // tiling (no dead gaps) while the row reads as loose stickers rather
  // than a ruled-off table.
  function noteJitter(t: TaskDoc): number {
    const h = hashId(t._id!);
    return (h % 9) - 4; // -4..4 px
  }
</script>

<div class="focus">
  <div class="fluid-stage over-scroll">
  <div class="fc-header fluid-panel glass">
    <button class="hamburger" on:click={() => dispatch('menu')} aria-label="Menu">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">{@html ICON.menu}</svg>
    </button>
    <div class="title-block">
      <h1 class="fc-title">Focus</h1>
      <span class="fc-count">
        {#if lock}
          Today's focus — knock these out, then everything else can wait
        {:else}
          Select up to {MAX_COMMIT} tasks for today's commitment — they'll stay locked here until each is done
        {/if}
      </span>
    </div>
    {#if lock}
      <button class="reset-btn" on:click={resetCommitment}>Reset</button>
    {/if}
    <!-- Every full-page view needs a visible Command Palette entry point,
         not just the Ctrl+K shortcut — unreachable on mobile with no
         physical keyboard. -->
    <button class="palette-btn" on:click={() => dispatch('search')} title="Commands and search (Ctrl+K)" aria-label="Commands and search (Ctrl+K)">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">{@html ICON.palette}</svg>
    </button>
  </div>
  </div>

  <div class="fc-body">
    {#if lock}
      {#if allDone}
        <div class="empty">All {lockedTasks.length} committed today — nicely done. Come back tomorrow, or reset to pick more.</div>
      {/if}
      {#each lockedTasks as t (t._id)}
        {@const done = isDone(t)}
        <div
          class="task-row"
          title={PRIO_LABEL[t.priority]}
          role="button"
          tabindex="0"
          on:click={() => openDetail(t)}
          on:keydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(t); } }}
        >
          <button class="circle" class:done on:click|stopPropagation={() => markDone(t)} title={done ? 'Mark not done' : 'Mark done'} aria-label={done ? 'Mark not done' : 'Mark done'}>
            {#if done}<svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6.5 5,9.5 10,3"/></svg>{/if}
          </button>
          <div class="task-body">
            <span class="task-title" class:done>{t.title}</span>
            <span class="proj-badge">{$projects.find(p => p._id === t.project_id)?.name ?? '—'}</span>
          </div>
          {#if t.priority >= 2 && PRIO_LABEL[t.priority]}<span class="row-prio" style:color={PRIO_COLOR[t.priority]}>{PRIO_LABEL[t.priority]}</span>{/if}
          <button class="remove-btn" on:click|stopPropagation={() => removeFromFocus(t)} title="Remove from focus" aria-label="Remove {t.title} from focus">
            <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2.5" y1="2.5" x2="9.5" y2="9.5"/><line x1="9.5" y1="2.5" x2="2.5" y2="9.5"/></svg>
          </button>
        </div>
      {/each}
      {#if !adding && room > 0}
        <button class="add-more-btn" on:click={startAdding}>+ Add {room === 1 ? 'one more task' : `up to ${room} more`}</button>
      {/if}
    {/if}
    {#if picking}
      <p class="picker-hint">Suggested tasks carry a Pinned, Overdue, Due soon or High priority label. Click up to three, then Let's focus.</p>
      {#if pickable.length === 0}
        <div class="empty">No open tasks to pick from.</div>
      {:else}
        <div class="board">
          {#each pickable as t (t._id)}
            <div
              class="note {noteSize(t)}"
              class:selected={selected.includes(t._id!)}
              class:suggested={suggestedReasons.has(t._id!)}
              style="--tilt: {noteTilt(t)}deg; --jitter: {noteJitter(t)}px"
              title={PRIO_LABEL[t.priority]}
              role="button"
              tabindex="0"
              on:click={() => toggleSelect(t._id!)}
              on:keydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSelect(t._id!); } }}
            >
              <span class="note-title">{t.title}</span>
              <div class="note-foot">
                <span class="proj-badge">{t.project_name ?? '—'}</span>
                <!-- The priority bucket holds every undated task, so it is labelled
                     only when the task really is high priority. -->
                {#if suggestedReasons.has(t._id!) && (suggestedReasons.get(t._id!) !== 'priority' || (t.priority ?? 1) >= 3)}
                  <span class="suggest-chip {suggestedReasons.get(t._id!)}">{SUGGEST_LABEL[suggestedReasons.get(t._id!)!]}</span>
                {/if}
              </div>
              <span class="check" class:checked={selected.includes(t._id!)} aria-label={selected.includes(t._id!) ? 'Selected' : 'Select for commitment'}>
                {#if selected.includes(t._id!)}<svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="var(--on-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6.5 5,9.5 10,3"/></svg>{/if}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  {#if picking}
    <div class="fc-footer">
      {#if adding}<button class="reset-btn" on:click={() => { adding = false; selected = []; }}>Cancel</button>{/if}
      <button class="commit-btn" disabled={!selected.length} on:click={commit}>
        {#if adding}{selected.length ? `Add ${selected.length} to focus` : 'Add to focus'}{:else}{selected.length ? `Let's focus on ${selected.length} task${selected.length > 1 ? 's' : ''}` : "Let's focus"}{/if}
      </button>
    </div>
  {/if}
</div>

{#if detailTask && detailProject}
  {#key detailTask._id + ':' + detailOpenSession}
    <CardDetail
      task={detailTask}
      project={detailProject}
      on:close={async () => { detailTask = null; detailProject = null; await refresh(); }}
      on:openRelated={(e) => openRelatedTask(e.detail)}
    />
  {/key}
{/if}

<style>
  .focus { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }

  .fc-header {
    /* flex-start, not center — see DashboardView.svelte's .dash-header
       comment: keeps the hamburger at the same position across pages with
       different numbers of subtitle lines. */
    display: flex; align-items: flex-start; gap: 10px;
    flex-shrink: 0;
  }
  .title-block { min-width: 0; flex: 1; }
  .fc-title { margin: 0 0 3px; font-size: var(--fs-t); font-weight: 700; letter-spacing: -.015em; }
  .fc-count { font-family: var(--mono); font-size: var(--fs-xs); color: var(--faint); }

  .hamburger {
    display: none;
    background: none; border: none; cursor: pointer;
    color: var(--text); padding: 4px; border-radius: var(--r-s); margin-top: 1px;
    flex-shrink: 0; align-items: center; justify-content: center;
    transition: background var(--dur-hover) var(--ease-hover);
  }
  .hamburger:hover { background: var(--hover); }

  /* Same shape family as .commit-btn (rounded, bold, outline instead of
     filled) but scaled down for a header button — matching the footer
     CTA's size exactly is too big for this spot. */
  .reset-btn {
    background: var(--field-bg); border: 1px solid transparent; color: var(--muted);
    font-size: var(--fs-m); font-weight: 700; padding: 8px 18px; border-radius: var(--r-m); cursor: pointer;
    flex-shrink: 0; transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover), border-color var(--dur-hover) var(--ease-hover);
    /* header is align-items:flex-start — this button sits centered
       against the row instead. */
    align-self: center;
  }
  .reset-btn:hover { background: var(--hover); color: var(--text); border-color: var(--accent); }

  .palette-btn {
    display: flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; flex-shrink: 0;
    background: var(--rail-bg); border: 0; border-radius: 11px;
    color: var(--muted); cursor: pointer; transition: color var(--dur-hover) var(--ease-hover), background var(--dur-hover) var(--ease-hover);
    align-self: center;
  }
  .palette-btn:hover { color: var(--text); background: color-mix(in srgb, var(--text) 12%, transparent); }

  .fc-body {
    flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable;
    padding: 20px 28px 40px;
    width: 100%; box-sizing: border-box;
  }

  .picker-hint { color: var(--faint); font-size: var(--fs-s); margin: 0 0 16px; max-width: 640px; }
  .empty { color: var(--faint); font-size: var(--fs-m); padding: 12px 0; }

  /* The corkboard. flex-wrap, not a grid with fixed tracks, so
     differently-sized notes can sit next to each other naturally instead
     of being forced into uniform cells. */
  .board {
    display: flex; flex-wrap: wrap; align-content: flex-start;
    gap: 18px 22px;
  }
  /* Priority is the thin colored top edge — same "color = priority"
     language as Board/List/Agenda, on top rather than the left since
     these notes tilt and sit in a scattered board. Selected/suggested
     state is communicated via border + accent color, never priority. */
  .note {
    position: relative;
    display: flex; flex-direction: column; gap: 10px;
    background: var(--surface);
    border: 1px solid transparent;
    border-radius: var(--r-s);
    padding: 14px 16px;
    cursor: pointer;
    box-shadow: var(--elev-1);
    transform: rotate(var(--tilt)) translateY(var(--jitter, 0px));
    transition: transform var(--dur-hover) var(--ease-hover), box-shadow var(--dur-hover) var(--ease-hover), border-color var(--dur-hover) var(--ease-hover), background var(--dur-hover) var(--ease-hover);
  }
  .note:hover { transform: rotate(0deg) translateY(-2px); box-shadow: var(--elev-2); }
  .note.selected {
    transform: rotate(0deg); border-color: var(--accent);
    box-shadow: var(--sel-ring);
  }
  .note.selected { border-color: transparent; }

  /* flex-grow (not a fixed width) so trailing space at the end of a row
     gets absorbed by the notes already in it instead of sitting empty --
     the board should look tiled edge to edge, not leave a gap where one
     more note almost fit. */
  .note-sm { flex: 1 1 160px; max-width: 220px; }
  .note-md { flex: 1 1 210px; max-width: 280px; }
  .note-lg { flex: 1 1 260px; max-width: 340px; padding: 18px 20px; }
  .note-lg .note-title { font-size: var(--fs-l); }

  .note-title {
    font-size: var(--fs-m); font-weight: 600; color: var(--text); line-height: 1.4;
    padding-right: 22px; /* clears the absolutely-positioned .check corner */
    /* standard `line-clamp` paired with the -webkit- prefix -- the prefixed
       property is still what most engines act on, but the unprefixed one is
       the shipping standard and is what newer engines will honour. */
    display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  }
  .note-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: auto; }

  .task-row {
    display: flex;
    align-items: center; gap: 12px;
    padding: 14px 16px; border-radius: var(--r-l);
    background: var(--surface); box-shadow: var(--elev-1);
    margin-bottom: 8px; cursor: pointer;
    transition: background var(--dur-hover) var(--ease-hover), box-shadow var(--dur-hover) var(--ease-hover);
  }
  .task-row:hover { box-shadow: var(--elev-2); }
  .task-row .task-body { flex: 1; }
  .row-prio { font-size: var(--fs-s); font-weight: 700; white-space: nowrap; }
  .remove-btn {
    background: none; border: none; padding: 6px; border-radius: var(--r-s); cursor: pointer;
    color: var(--faint); display: flex; align-items: center; justify-content: center;
    transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .remove-btn:hover { background: var(--hover); color: var(--text); }
  .add-more-btn {
    width: 100%; padding: 12px 16px; border-radius: var(--r-s); cursor: pointer;
    background: none; border: 1.5px dashed var(--border-strong); color: var(--muted);
    font-size: var(--fs-m); font-weight: 600; text-align: left;
    transition: border-color var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .add-more-btn:hover { border-color: var(--accent); color: var(--text); }

  /* The reason a note is suggested, as a word: only Overdue takes a colour. */
  .suggest-chip { font-size: var(--fs-xs); font-weight: 700; white-space: nowrap; color: var(--muted); }
  .suggest-chip.pinned   { color: var(--accent-ink); }
  .suggest-chip.overdue  { color: var(--overdue-ink); }

  /* Same minimal checkbox language as ListView/AgendaView's .circle:
     rounded square, no fill, border-only. */
  .circle {
    width: 18px; height: 18px; border-radius: 50%;
    background: none; padding: 0;
    display: flex; align-items: center; justify-content: center;
    border: 1.5px solid var(--border-strong); flex-shrink: 0; cursor: pointer;
    transition: border-color var(--dur-hover) var(--ease-hover);
  }
  .circle:hover { border-color: var(--accent); }
  .circle.done { border-color: var(--accent); }
  .task-title.done { text-decoration: line-through; color: var(--muted); }

  /* Select-for-commitment checkbox -- deliberately the *filled* checkbox
     language (like ListView's bulk-select .row-check), not the plain
     border-only "done" checkbox style used elsewhere: this one means
     "chosen", not "complete". Absolutely positioned in the note's own
     top-right corner rather than inline with the footer's badges, whose
     varying heights/widths would throw off its alignment. Solid
     background so it reads cleanly over however far the title wraps. */
  .check {
    position: absolute; top: 10px; right: 10px;
    width: 18px; height: 18px; border-radius: 5px;
    background: var(--surface);
    border: 1.6px solid var(--border-strong); flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    transition: border-color var(--dur-hover) var(--ease-hover), background var(--dur-hover) var(--ease-hover);
  }
  .check.checked { background: var(--accent); border-color: var(--accent); }

  /* Locked task-row's title + project stacked (same primary/secondary
     pattern as DashboardView/AgendaView's .task-body) so project
     context survives at every width, with no breakpoint needed. The
     corkboard note's own .proj-badge (in .note-foot below) keeps its chip
     look — it has room to spare and pairs visually with .suggest-chip. */
  .task-row .task-body { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .task-title {
    font-size: var(--fs-l); font-weight: 600; color: var(--text);
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Plain text, not a chip. The general .proj-badge rule below (used by
     the corkboard note's badge) sets a background/padding that only an
     explicit `none`/`0` clears — setting other properties here does not
     shadow them. */
  .task-row .proj-badge {
    font-family: var(--mono); font-size: var(--fs-2xs); color: var(--faint);
    background: none; padding: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .proj-badge {
    font-family: var(--mono); font-size: var(--fs-2xs); color: var(--faint);
    background: var(--col-bg); padding: 2px 8px; border-radius: var(--r-s);
    white-space: nowrap;
  }

  .fc-footer {
    flex-shrink: 0;
    display: flex; justify-content: center; gap: 10px;
    padding: 14px 28px; border-top: 1px solid var(--border);
    background: var(--surface);
  }

  .commit-btn {
    width: auto; min-width: 240px;
    background: var(--text); color: var(--bg); border: 1.5px solid var(--text);
    font-size: var(--fs-l); font-weight: 700; padding: 13px 32px; border-radius: var(--r-l);
    cursor: pointer; transition: opacity var(--dur-hover) var(--ease-hover);
  }
  .commit-btn:disabled { opacity: .4; cursor: not-allowed; }
  .commit-btn:not(:disabled):hover { opacity: .9; }

  @media (max-width: 768px), (max-height: 500px) and (orientation: landscape) {
    .hamburger { display: flex; }
  }

  @media (max-width: 700px) {
    .fc-header { padding: 14px 16px 10px; }
    .fc-body   { padding: 14px 14px 32px; }
    .fc-footer { padding: 12px 16px; }
    .fc-title  { font-size: var(--fs-xl); }
    .board { gap: 14px; }
    .note-sm, .note-md, .note-lg { flex-basis: calc(50% - 7px); max-width: none; }
  }
</style>
