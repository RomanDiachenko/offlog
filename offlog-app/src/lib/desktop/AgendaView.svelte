<script lang="ts">
  import { ICON } from '../shared/iconPaths';
  import { onMount, createEventDispatcher } from 'svelte';
  import { slide } from 'svelte/transition';
  import { revealIn, revealOut } from '../motion';
  import { getAllTasksDue, updateTask, subscribe, getTaskById } from '../db';
  import { projects, showError } from '../store';
  import { PRIORITY_COLOR as PRIO_COLOR, PRIORITY_LABEL as PRIO_LABEL } from '../constants';
  import { dueLabelLong, dueRelative, dueDateShort, daysSinceWeekStart, localDateStr, fmtDay, dayOf } from '../utils';
  import { today as todayStore } from '../today';
  import { getWeekStartsMonday, WEEK_START_CHANGED } from '../../config';
  import CardDetail from './CardDetail.svelte';
  import type { TaskDoc, ProjectDoc } from '../types';
  import { hapticToggle } from '../haptics';
  import { offerUndo, shortTitle } from '../undoToast';

  const dispatch = createEventDispatcher<{ menu: void; search: void; addTask: string }>();

  type DueTask = TaskDoc & { project_name?: string };

  let all: DueTask[] = [];
  let detailTask: DueTask | null = null;
  let detailProject: ProjectDoc | null = null;
  // See KanbanBoard.svelte's identical detailOpenSession for why this
  // exists — {#key detailTask._id} alone doesn't change value on a fast
  // close-then-reopen of the same task.
  let detailOpenSession = 0;

  // Reactive, not a one-shot const: the desktop app is tray-resident, so
  // this view can stay mounted across midnight. Captured once, it would
  // keep yesterday's date and silently mis-group Overdue/Today/This week.
  $: today = $todayStore;

  // Agenda's second view mode alongside the flat list. Same underlying
  // getAllTasksDue() query, just re-laid out. Per-device preference
  // (localStorage), same as every other view-mode toggle.
  const VIEW_KEY = 'offlog_agenda_view';
  const storedMode = typeof localStorage !== 'undefined' ? localStorage.getItem(VIEW_KEY) : null;
  let mode: 'list' | 'month' = storedMode === 'month' ? 'month' : 'list';
  function setMode(m: 'list' | 'month') { mode = m; localStorage.setItem(VIEW_KEY, m); }

  let weekStartsMonday = getWeekStartsMonday();
  onMount(() => {
    const sync = () => (weekStartsMonday = getWeekStartsMonday());
    window.addEventListener(WEEK_START_CHANGED, sync);
    return () => window.removeEventListener(WEEK_START_CHANGED, sync);
  });
  function toDateStr(d: Date): string {
    return localDateStr(d);
  }
  // A reactive lookup, not a plain function called from the template: a
  // `tasksOnDay(day)` call inside {#each monthGridDays as day} references
  // only `tasksOnDay` and `day` as far as the compiler is concerned, not
  // `all` (hidden in the function body), so the grid never re-renders once
  // `all` loads async. `$:` makes the `all` dependency explicit.
  $: tasksByDate = all.reduce<Record<string, DueTask[]>>((acc, t) => {
    if (t.due_date) (acc[t.due_date] ??= []).push(t);
    return acc;
  }, {});

  // Month grid. Each cell shows a priority-colored dot per task always,
  // plus a short title chip on wider viewports only (see .month-titles
  // media query below) — real titles don't survive a narrow column at
  // this density, so month cells never try to fit titles below 700px;
  // tapping a day opens its tasks in the panel below the grid instead,
  // same interaction on every platform.
  let monthOffset = 0;
  let selectedDay: string | null = null;
  const DOW_MONDAY_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DOW_SUNDAY_FIRST = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  $: orderedDayNames = weekStartsMonday ? DOW_MONDAY_FIRST : DOW_SUNDAY_FIRST;
  $: monthAnchor = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  })();
  $: monthLabel = monthAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  $: monthLeadDays = daysSinceWeekStart(monthAnchor, weekStartsMonday);
  $: monthDaysInMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0).getDate();
  $: monthGridLength = Math.ceil((monthLeadDays + monthDaysInMonth) / 7) * 7;
  $: monthGridStart = (() => {
    const d = new Date(monthAnchor);
    d.setDate(d.getDate() - monthLeadDays);
    return d;
  })();
  $: monthGridDays = Array.from({ length: monthGridLength }, (_, i) => {
    const d = new Date(monthGridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  function inCurrentMonth(d: Date): boolean { return d.getMonth() === monthAnchor.getMonth(); }
  function monthPrev() { monthOffset -= 1; }
  function monthNext() { monthOffset += 1; }
  function goToTodayMonth() { monthOffset = 0; selectedDay = today; }
  function toggleSelectedDay(dStr: string) { selectedDay = selectedDay === dStr ? null : dStr; }
  // "Add task" in the day panel — QuickAdd (opened at the App level)
  // prefills its due date from this, same as any other Quick Add open.
  // Accepts null because the call site reads `selectedDay` inside an
  // {#if selectedDay} block -- true at runtime, but Svelte can't narrow a
  // template guard into an event-handler closure, so the type stays
  // string|null there. Guarding here is honest; asserting non-null at the
  // call site would just be hiding it.
  function addCardOnDay(dStr: string | null) { if (dStr) dispatch('addTask', dStr); }

  // From `today`, not the clock, so a view left open into a new week moves on with it.
  function endOfWeek(monday: boolean, day: string): string {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + (6 - daysSinceWeekStart(d, monday)));
    return localDateStr(d);
  }
  $: weekEnd = endOfWeek(weekStartsMonday, today);

  async function load() { all = await getAllTasksDue(); }

  onMount(() => {
    load();
    const unsub = subscribe(() => load());
    return unsub;
  });

  $: overdue   = all.filter(t => t.due_date! < today);
  $: dueToday  = all.filter(t => t.due_date === today);
  $: thisWeek  = all.filter(t => t.due_date! > today && t.due_date! <= weekEnd);
  $: later     = all.filter(t => t.due_date! > weekEnd);

  function openDetail(t: DueTask) {
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

  async function markDone(t: DueTask) {
    const proj = $projects.find(p => p._id === t.project_id);
    if (!proj) return;
    const lastCol = proj.columns.at(-1)?.id;
    if (!lastCol || t.column_id === lastCol) return;
    // Finishing a repeating task also moves its date and resets its steps,
    // so Undo restores all of them, not just the status.
    const { _id: id, column_id, due_date, reminder_at, checklist } = t;
    try {
      await updateTask(id!, { column_id: lastCol });
      await load();
      hapticToggle();
    } catch {
      showError('Could not update task. Please try again.');
      return;
    }
    offerUndo(`done:${id}`, `Finished "${shortTitle(t.title)}"`, async () => { await updateTask(id!, { column_id, due_date, reminder_at, checklist }); await load(); });
  }
</script>

<div class="agenda">
  <div class="fluid-stage over-scroll">
  <div class="agenda-header fluid-panel glass flat">
    <button class="hamburger" on:click={() => dispatch('menu')} aria-label="Menu">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">{@html ICON.menu}</svg>
    </button>
    <div class="title-block">
      <h1 class="agenda-title">Agenda</h1>
      <span class="agenda-count">{all.length} task{all.length === 1 ? '' : 's'} with due dates</span>
    </div>
    <div class="agenda-header-actions">
      <!-- Same Command Palette button/icon as List view's top bar; Agenda
           has its own header rather than the shared board-header. -->
      <button class="palette-btn" on:click={() => dispatch('search')} title="Commands and search (Ctrl+K)" aria-label="Commands and search (Ctrl+K)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">{@html ICON.palette}</svg>
      </button>
      <div class="mode-toggle">
        <button class="mode-btn" class:active={mode === 'list'} class:is-selected={mode === 'list'} aria-pressed={mode === 'list'} on:click={() => setMode('list')}>List</button>
        <button class="mode-btn" class:active={mode === 'month'} class:is-selected={mode === 'month'} aria-pressed={mode === 'month'} on:click={() => setMode('month')}>Month</button>
      </div>
    </div>
  </div>
  </div>

  {#if mode === 'month'}
    <div class="month-nav">
      <div class="month-nav-center">
        <button class="cal-nav-btn" on:click={monthPrev} aria-label="Previous month">‹</button>
        <span class="cal-label">{monthLabel}</span>
        <button class="cal-nav-btn" on:click={monthNext} aria-label="Next month">›</button>
      </div>
      {#if monthOffset !== 0}
        <button class="month-today-btn" on:click={goToTodayMonth}>Today</button>
      {/if}
    </div>
    <div class="month-scroll" class:fill={!selectedDay}>
      <div class="month-grid glass flat">
        {#each orderedDayNames as dow}<div class="month-dow">{dow}</div>{/each}
        {#each monthGridDays as day (day.toISOString())}
          {@const dStr = toDateStr(day)}
          {@const dayTasks = tasksByDate[dStr] ?? []}
          <button
            class="month-cell"
            class:today={dStr === today}
            class:out-month={!inCurrentMonth(day)}
            class:selected={dStr === selectedDay}
            on:click={() => toggleSelectedDay(dStr)}
          >
            <div class="month-daynum-row">
              <span class="month-daynum">{day.getDate()}</span>
              {#if dayTasks.length}
                <span class="month-dots">
                  {#each dayTasks.slice(0, 4) as t (t._id)}
                    <span class="month-dot" style="background:{PRIO_COLOR[t.priority]}"></span>
                  {/each}
                </span>
              {/if}
            </div>
            {#if dayTasks.length}
              <span class="month-titles">
                {#each dayTasks.slice(0, 2) as t (t._id)}
                  <span class="month-title-chip">{t.title}</span>
                {/each}
                {#if dayTasks.length > 2}<span class="month-more">+{dayTasks.length - 2} more</span>{/if}
              </span>
            {/if}
          </button>
        {/each}
      </div>
      {#if selectedDay}
        <div class="month-day-panel glass flat" in:slide={revealIn} out:slide={revealOut}>
          <div class="month-day-panel-head">
            <span>{fmtDay(dayOf(selectedDay), { weekday: true })}</span>
            <button class="month-day-close" on:click={() => selectedDay = null} aria-label="Close">×</button>
          </div>
          {#if (tasksByDate[selectedDay] ?? []).length === 0}
            <div class="empty">No tasks due this day.</div>
          {:else}
            {#each tasksByDate[selectedDay] as t (t._id)}
              <div
                class="task-row"
                title={PRIO_LABEL[t.priority]}
                role="button"
                tabindex="0"
                on:click={() => openDetail(t)}
                on:keydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(t); } }}
              >
                <button class="circle" on:click|stopPropagation={() => markDone(t)} title="Mark done" aria-label="Mark done"></button>
                <div class="task-body">
                  <span class="task-title">{t.title}</span>
                  <span class="proj-badge">{t.project_name ?? '—'}</span>
                </div>
                {#if t.priority >= 2 && PRIO_LABEL[t.priority]}<span class="row-prio" style:color={PRIO_COLOR[t.priority]}>{PRIO_LABEL[t.priority]}</span>{/if}
              </div>
            {/each}
          {/if}
          <button class="month-add-card-btn" on:click={() => addCardOnDay(selectedDay)}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/>
            </svg>
            Add task
          </button>
        </div>
      {/if}
    </div>
  {:else}
  <div class="agenda-body">
    {#if all.length === 0}
      <div class="empty">No tasks with due dates across any project.</div>
    {:else}

      {#if overdue.length}
        <section class="glass flat">
          <div class="group-label overdue-label">Overdue <span class="badge-count">{overdue.length}</span></div>
          {#each overdue as t (t._id)}
            <div
              class="task-row"
              title={PRIO_LABEL[t.priority]}
              role="button"
              tabindex="0"
              on:click={() => openDetail(t)}
              on:keydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(t); } }}
            >
              <button class="circle" on:click|stopPropagation={() => markDone(t)} title="Mark done" aria-label="Mark done"></button>
              <div class="task-body">
                <span class="task-title">{t.title}</span>
                <span class="proj-badge">{t.project_name ?? '—'}</span>
              </div>
              {#if t.priority >= 2 && PRIO_LABEL[t.priority]}<span class="row-prio" style:color={PRIO_COLOR[t.priority]}>{PRIO_LABEL[t.priority]}</span>{/if}
              <span class="due-chip overdue">{dueLabelLong(t.due_date!, today)}</span>
            </div>
          {/each}
        </section>
      {/if}

      {#if dueToday.length}
        <section class="glass flat">
          <div class="group-label today-label">Today <span class="badge-count">{dueToday.length}</span></div>
          {#each dueToday as t (t._id)}
            <div
              class="task-row"
              title={PRIO_LABEL[t.priority]}
              role="button"
              tabindex="0"
              on:click={() => openDetail(t)}
              on:keydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(t); } }}
            >
              <button class="circle" on:click|stopPropagation={() => markDone(t)} title="Mark done" aria-label="Mark done"></button>
              <div class="task-body">
                <span class="task-title">{t.title}</span>
                <span class="proj-badge">{t.project_name ?? '—'}</span>
              </div>
              {#if t.priority >= 2 && PRIO_LABEL[t.priority]}<span class="row-prio" style:color={PRIO_COLOR[t.priority]}>{PRIO_LABEL[t.priority]}</span>{/if}
            </div>
          {/each}
        </section>
      {/if}

      {#if thisWeek.length}
        <section class="glass flat">
          <div class="group-label week-label">This week <span class="badge-count">{thisWeek.length}</span></div>
          {#each thisWeek as t (t._id)}
            <div
              class="task-row"
              title={PRIO_LABEL[t.priority]}
              role="button"
              tabindex="0"
              on:click={() => openDetail(t)}
              on:keydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(t); } }}
            >
              <button class="circle" on:click|stopPropagation={() => markDone(t)} title="Mark done" aria-label="Mark done"></button>
              <div class="task-body">
                <span class="task-title">{t.title}</span>
                <span class="proj-badge">{t.project_name ?? '—'}</span>
              </div>
              {#if t.priority >= 2 && PRIO_LABEL[t.priority]}<span class="row-prio" style:color={PRIO_COLOR[t.priority]}>{PRIO_LABEL[t.priority]}</span>{/if}
              <span class="due-chip week">{dueRelative(t.due_date!, today)} · {dueDateShort(t.due_date!)}</span>
            </div>
          {/each}
        </section>
      {/if}

      {#if later.length}
        <section class="glass flat">
          <div class="group-label later-label">Later <span class="badge-count">{later.length}</span></div>
          {#each later as t (t._id)}
            <div
              class="task-row"
              title={PRIO_LABEL[t.priority]}
              role="button"
              tabindex="0"
              on:click={() => openDetail(t)}
              on:keydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(t); } }}
            >
              <button class="circle" on:click|stopPropagation={() => markDone(t)} title="Mark done" aria-label="Mark done"></button>
              <div class="task-body">
                <span class="task-title">{t.title}</span>
                <span class="proj-badge">{t.project_name ?? '—'}</span>
              </div>
              {#if t.priority >= 2 && PRIO_LABEL[t.priority]}<span class="row-prio" style:color={PRIO_COLOR[t.priority]}>{PRIO_LABEL[t.priority]}</span>{/if}
              <span class="due-chip later">{dueLabelLong(t.due_date!, today)}</span>
            </div>
          {/each}
        </section>
      {/if}

    {/if}
  </div>
  {/if}
</div>

{#if detailTask && detailProject}
  {#key detailTask._id + ':' + detailOpenSession}
    <CardDetail
      task={detailTask}
      project={detailProject}
      on:close={async () => { detailTask = null; detailProject = null; await load(); }}
      on:openRelated={(e) => openRelatedTask(e.detail)}
    />
  {/key}
{/if}

<style>
  .agenda { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }

  .agenda-header {
    /* flex-start, not center — see DashboardView.svelte's .dash-header
       comment: keeps the hamburger at the same position across pages with
       different numbers of subtitle lines. */
    display: flex; align-items: flex-start; gap: 10px;
    flex-shrink: 0;
  }
  .title-block { min-width: 0; }
  .agenda-title { margin: 0 0 3px; font-size: var(--fs-t); font-weight: 700; letter-spacing: -.015em; }
  .agenda-count { font-family: var(--mono); font-size: var(--fs-xs); color: var(--faint); }

  .hamburger {
    display: none;
    background: none; border: none; cursor: pointer;
    color: var(--text); padding: 4px; border-radius: var(--r-s); margin-top: 1px;
    flex-shrink: 0; align-items: center; justify-content: center;
    transition: background var(--dur-hover) var(--ease-hover);
  }
  .hamburger:hover { background: var(--hover); }

  .agenda-header-actions {
    display: flex; align-items: center; gap: 8px;
    flex-shrink: 0; margin-left: auto;
    /* header is align-items:flex-start — this control cluster sits
       centered against the row, not pinned to the top like the title
       block. */
    align-self: center;
  }
  .palette-btn {
    display: flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; flex-shrink: 0;
    background: var(--rail-bg); border: 0; border-radius: 11px;
    color: var(--muted); cursor: pointer; transition: color var(--dur-hover) var(--ease-hover), background var(--dur-hover) var(--ease-hover);
  }
  .palette-btn:hover { color: var(--text); background: color-mix(in srgb, var(--text) 12%, transparent); }
  /* Same rail as the board header's Board/List; no overflow clip, which
     would cut off the selected button's glow. */
  .mode-toggle { display: inline-flex; align-items: center; height: 34px; box-sizing: border-box; padding: 3px; gap: 2px; border-radius: 11px; background: var(--rail-bg); flex-shrink: 0; }
  .mode-btn {
    display: flex; align-items: center; justify-content: center;
    height: 26px; box-sizing: border-box; padding: 0 12px;
    border: none; border-radius: 8px; background: transparent; color: var(--muted);
    font-size: var(--fs-s); font-weight: 600; cursor: pointer; transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .mode-btn:hover { background: var(--rail-hover); color: var(--text); }
  .mode-btn.active, .mode-btn.active:hover { background: var(--surface); color: var(--text); }

  /* Shared by any calendar-style nav bar (currently just Month's) --
     prev/next arrows plus a centered period label. */
  .cal-nav-btn {
    background: none; border: 1px solid var(--glass-edge); border-radius: 999px; cursor: pointer;
    color: var(--muted); font-size: var(--fs-xl); line-height: 1; padding: 3px 10px;
    transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .cal-nav-btn:hover { background: var(--hover); color: var(--text); }
  .cal-label { font-size: var(--fs-m); font-weight: 700; color: var(--text); }

  .month-nav {
    display: flex; align-items: center; justify-content: center; position: relative;
    padding: 12px 28px 4px; flex-shrink: 0;
  }
  .month-nav-center { display: flex; align-items: center; gap: 14px; }
  /* A real button pinned to the nav bar's right edge, out of the centered
     prev/label/next group. Only rendered once you've navigated away from
     the current month — no point offering a jump to where you already are. */
  .month-today-btn {
    /* An explicit `top` is required: as the only absolutely-positioned
       child pulled out of a `justify-content: center` flex row, omitting
       it leaves the browser to use the ambiguous "static position"
       fallback and the button can drift out of .month-nav entirely.
       right: 38px is .month-scroll's right padding plus its 10px scrollbar
       gutter, so this button's right edge lines up with the grid's.
       top is 50% + 4px, not plain 50%: .month-nav's padding is asymmetric
       (12px top, 4px bottom) and `top` percentages resolve against the
       full padded box, so plain 50% sits 4px above where
       .month-nav-center's flex-centered content actually falls. */
    position: absolute; top: calc(50% + 4px); right: 38px; transform: translateY(-50%);
    background: var(--field-bg); border: 1px solid transparent; border-radius: var(--r-s);
    color: var(--accent); font-size: var(--fs-s); font-weight: 600;
    padding: 4px 12px; cursor: pointer; transition: background var(--dur-hover) var(--ease-hover);
  }
  .month-today-btn:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }

  /* flex:1 + overflow-y:auto belong on this scroll container, not the grid
     itself — the grid sizes to its own content (6 rows max), and
     stretching a short grid to fill leftover flex space leaves a blank gap
     before the day panel below it. With no day open (.fill) the weeks
     share the whole height instead. Same side edges as the header; the
     stable gutter keeps the right edge still when the day panel scrolls. */
  .month-scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 0 28px 16px; }
  .month-scroll.fill { display: flex; flex-direction: column; }
  .month-scroll.fill .month-grid { flex: 1; grid-auto-rows: minmax(78px, 1fr); }
  /* grid-auto-rows keeps every week row the same fixed height regardless
     of content — with normal grid "stretch to tallest cell" behavior the
     whole calendar appears to resize while browsing between months. A
     day's content is capped by construction (day number + up to 4 dots +
     2 title chips + one "+N more" line), so the fixed height fits the
     busiest real case; overflow:hidden on the cell is a safety net. */
  .month-grid {
    /* grid-template-rows: auto covers ONLY the explicit first row (the
       day-of-week header, .month-dow x7); grid-auto-rows then sizes every
       row after it (the day cells). grid-auto-rows alone would size the
       header row too, forcing MON/TUE/... into a tall band instead of
       hugging its own small content. */
    display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));
    grid-template-rows: auto; grid-auto-rows: 78px;
    border-radius: var(--r-l); overflow: hidden;
    margin: 12px 0;
  }
  .month-dow {
    font-family: var(--mono); font-size: var(--fs-2xs); text-transform: uppercase; letter-spacing: .06em;
    color: var(--faint); text-align: center; padding: 6px 4px;
    border-bottom: 1px solid var(--line);
  }
  .month-cell {
    display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
    height: 100%; overflow: hidden; padding: 5px 6px; text-align: left;
    background: none; border: none; cursor: pointer;
    border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);
    transition: background var(--dur-hover) var(--ease-hover);
  }
  .month-cell:hover { background: var(--hover); }
  .month-cell:nth-child(7n) { border-right: none; }
  .month-cell.out-month { background: color-mix(in srgb, var(--text) 2.5%, transparent); color: var(--faint); }
  .month-cell.out-month .month-daynum { color: var(--faint); }
  /* Same markers as the phone's Month: today is a ring on the number, the
     selected day a solid dot, its cell the Fluid selected fill. */
  .month-cell.selected { background: var(--sel-fill); }
  /* min-height:20px (and the flex centering) must apply to EVERY day, not
     just "today": the fixed-size circle badge below only changes today's
     cell, so without it every other day's plain-text number is shorter and
     dots align against a different height depending on the day — on both
     the desktop row layout and the mobile column layout. */
  .month-daynum {
    display: flex; align-items: center; justify-content: center;
    min-height: 20px; font-size: var(--fs-s); font-weight: 700; color: var(--text);
  }
  .month-cell.today .month-daynum, .month-cell.selected .month-daynum { border-radius: 50%; width: 20px; height: 20px; font-size: var(--fs-xs); }
  .month-cell.today .month-daynum { color: var(--accent-ink); box-shadow: inset 0 0 0 1.5px var(--accent); }
  .month-cell.selected .month-daynum { color: var(--on-accent); background: var(--accent); box-shadow: none; }
  /* Desktop: day number top-left, dots pinned to the cell's top-right
     corner. Mobile stacks them — overridden back to column in the 700px
     media query below.
     min-height:20px matches .month-cell.today .month-daynum's fixed 20x20
     circle badge: without it "today"'s row is taller than every other
     day's (plain text has no fixed box), so align-items:center centers
     each day's dots within a different row height and they land at
     different y-coordinates across the week. */
  .month-daynum-row { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 20px; }
  .month-dots { display: flex; gap: 3px; flex-wrap: wrap; }
  .month-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  /* Title chips are a desktop-only enhancement — real titles don't
     survive a narrow column, so below 700px cells fall back to
     dots-only + tap-to-open, same interaction everywhere, just less
     crammed into the cell itself. */
  .month-titles { display: flex; flex-direction: column; gap: 1px; width: 100%; }
  .month-title-chip {
    font-size: var(--fs-xs); color: var(--text); width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .month-more { font-size: var(--fs-2xs); color: var(--faint); }

  .month-day-panel { border-radius: var(--r-l); padding: 12px 16px; margin-top: 4px; }
  .month-day-panel-head {
    display: flex; align-items: center; justify-content: space-between;
    font-size: var(--fs-m); font-weight: 700; color: var(--text); margin-bottom: 10px;
  }
  .month-day-close {
    background: none; border: none; color: var(--faint); font-size: var(--fs-xl);
    line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: var(--r-s);
  }
  .month-day-close:hover { background: var(--hover); color: var(--text); }

  .month-add-card-btn {
    display: flex; align-items: center; gap: 6px;
    width: 100%; margin-top: 6px; padding: 9px 10px;
    border: 1px solid var(--border-strong); border-radius: var(--r-m);
    background: none; color: var(--muted); font-size: var(--fs-m); font-weight: 500;
    cursor: pointer; transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover), border-color var(--dur-hover) var(--ease-hover);
  }
  .month-add-card-btn:hover { background: var(--hover); color: var(--accent); border-color: var(--accent); }

  @media (max-width: 700px) {
    .month-titles { display: none; }
    /* Dots stay left-aligned directly under the day number rather than
       centered against the full cell width, which visually disconnects
       them from the number they belong to. */
    .month-daynum-row { flex-direction: column; align-items: flex-start; gap: 6px; width: 100%; }
    .month-grid { grid-auto-rows: 60px; }
    .month-cell { padding: 4px 3px; }
    .month-scroll { padding: 0 12px 12px; }
    .month-nav { padding: 10px 12px 4px; }
    .month-today-btn { right: 12px; font-size: var(--fs-xs); padding: 4px 9px; }
  }

  .agenda-body {
    flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable;
    padding: 20px 28px 40px;
    width: 100%; box-sizing: border-box;
  }

  .empty { color: var(--faint); font-size: var(--fs-m); padding: 12px 0; }

  /* One glass panel per group, its tasks lined rows inside. */
  section { border-radius: var(--r-l); padding: 12px 16px 4px; margin-bottom: 16px; }

  .group-label {
    font-family: var(--mono); font-size: var(--fs-2xs); text-transform: uppercase;
    letter-spacing: .08em; font-weight: 700;
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 4px;
  }
  .overdue-label { color: var(--overdue-ink); }
  .today-label   { color: var(--accent); }
  .week-label    { color: var(--success-ink); }
  .later-label   { color: var(--faint); }

  .badge-count {
    /* --on-accent, not a hardcoded #fff, which fails contrast badly on
       most of these backgrounds in dark mode. --on-accent's white/dark
       split matches --overdue-ink/--accent/--faint's per-theme lightness
       swap; --success needs its own override below since it stays bright
       in both themes rather than swapping. */
    color: var(--on-accent); opacity: .9;
    font-size: var(--fs-2xs); padding: 1px 5px; border-radius: 8px; font-weight: 700;
  }
  /* background can't use currentColor here — that would read the badge's
     own `color` (white) rather than the parent label's color, so each
     variant gets an explicit background matching its label */
  .overdue-label .badge-count { background: var(--overdue-ink); }
  .today-label   .badge-count { background: var(--accent); }
  .week-label    .badge-count { background: var(--success); color: var(--ink-fixed-dark); }
  .later-label   .badge-count { background: var(--faint); }

  .task-row {
    /* Flex, not a grid: rows without a date keep priority at the right edge. */
    display: flex;
    align-items: center; gap: 12px;
    min-height: 44px; padding: 0 2px; border-top: 1px solid var(--line);
    cursor: pointer; transition: background var(--dur-hover) var(--ease-hover);
  }
  .task-row:hover { background: var(--hover); }
  .row-prio { font-size: var(--fs-s); font-weight: 700; white-space: nowrap; }

  /* Same round done circle as ListView.svelte's. */
  .circle {
    width: 18px; height: 18px; border-radius: 50%;
    background: none; padding: 0;
    border: 1.5px solid var(--border-strong); flex-shrink: 0; cursor: pointer;
    transition: border-color var(--dur-hover) var(--ease-hover); display: block;
  }
  .circle:hover { border-color: var(--accent); }

  /* Title, then the project on the same line: one short row per task. */
  .task-body { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; }
  .task-title {
    font-size: var(--fs-m); font-weight: 500; color: var(--text);
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .proj-badge {
    flex-shrink: 1; min-width: 0; font-size: var(--fs-s); color: var(--faint);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* Dates as text, like a card's footer: only overdue takes a colour. */
  .due-chip { font-size: var(--fs-s); font-weight: 600; color: var(--muted); white-space: nowrap; }
  .due-chip.overdue { color: var(--overdue-ink); }

  @media (max-width: 768px), (max-height: 500px) and (orientation: landscape) {
    .hamburger { display: flex; }
  }

  @media (max-width: 700px) {
    .agenda-header { padding: 14px 16px 10px; }
    .agenda-body   { padding: 14px 14px 32px; }
    .agenda-title  { font-size: var(--fs-xl); }
  }

  /* Small — collapse chip to short form */
  @media (max-width: 440px) {
    .task-row  { gap: 8px; }
    .task-title { font-size: var(--fs-m); }
    .due-chip  { font-size: var(--fs-2xs); padding: 2px 6px; }
  }
</style>
