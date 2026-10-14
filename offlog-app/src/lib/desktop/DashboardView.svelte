<script lang="ts">
  import { ICON } from '../shared/iconPaths';
  import PinStar from './PinStar.svelte';
  import { soften } from '../tagColors';
  import { onMount, createEventDispatcher } from 'svelte';
  import { getDashboardData, getStorageBreakdown, getTaskById, subscribe } from '../db';
  import { reloadTasks, showError } from '../store';
  import { PRIORITY_COLOR } from '../constants';
  import { dueLabelLong, fmtDay, dayOf, daysDiff } from '../utils';
  import { today, onNewDay } from '../today';
  import type { TaskDoc, ProjectDoc } from '../types';
  import CardDetail from './CardDetail.svelte';
  import { loadFocusLock, type FocusLock } from '../focusLock';

  // Today and tomorrow by name; anything later by its day.
  function nextDueLabel(due: string, day: string): string {
    const days = daysDiff(due, day);
    return days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Next due ${fmtDay(dayOf(due), { weekday: true })}`;
  }

  const dispatch = createEventDispatcher<{ openProject: string; menu: void; focus: void; search: void; agenda: void }>();

  // Dashboard is a glanceable overview, not a second task browser (that's
  // List/Agenda's job), so Today/Pinned/Overdue are capped. Today/Overdue
  // "View all" links out to Agenda; Pinned has no cross-project view
  // anywhere else, so its "View all" expands the list in place.
  const TASK_CAP = 6;
  let pinnedExpanded = false;

  let data: Awaited<ReturnType<typeof getDashboardData>> | null = null;
  // A task shows once, in its most pressing list: Pinned leaves out what
  // Today and Overdue above already show.
  $: shownAbove = new Set(data ? [...data.todayTasks.slice(0, TASK_CAP), ...data.overdueTasks.slice(0, TASK_CAP)].map(t => t._id) : []);
  $: pinnedRest = data ? data.pinnedAll.filter(t => !shownAbove.has(t._id)) : [];
  let detailTask: TaskDoc | null = null;
  let detailProject: ProjectDoc | null = null;
  // See KanbanBoard.svelte's identical detailOpenSession for why this
  // exists -- {#key detailTask._id} alone doesn't change value on a fast
  // close-then-reopen of the same task.
  let detailOpenSession = 0;
  // Glance-level count only; the full archived-task browser stays in List view.
  let archivedCount = 0;

  // "Daily Brief" card: surfaces Focus's daily commitment lock, the one
  // piece of state only Focus otherwise has. Deliberately doesn't re-show
  // Today/Pinned/Overdue — those are their own sections below.
  let focusLock: FocusLock | null = null;
  let focusLockedTasks: TaskDoc[] = [];

  function isFocusTaskDone(t: TaskDoc): boolean {
    const proj = data?.allProjects.find(p => p._id === t.project_id);
    return !!proj && t.column_id === proj.columns.at(-1)?.id;
  }

  async function loadFocusSummary() {
    focusLock = loadFocusLock();
    if (!focusLock) { focusLockedTasks = []; return; }
    const fetched = await Promise.all(focusLock.taskIds.map(id => getTaskById(id)));
    // Same !deleted/!archived filter as FocusView.svelte's loadLockedTasks():
    // a task removed elsewhere while locked as one of today's 3 must not
    // still count here.
    focusLockedTasks = fetched.filter((t): t is TaskDoc => !!t && !t.deleted && !t.archived);
  }

  async function load() {
    data = await getDashboardData();
    archivedCount = (await getStorageBreakdown()).archivedTasks;
    await loadFocusSummary();
  }

  // Reload at midnight: the Today/Overdue groups come from getDashboardData()
  // and loadFocusLock() discards a stale lock, but neither re-runs on the
  // clock, so a tray-resident session left open past midnight would keep
  // yesterday's groups and Focus picks.
  onMount(() => {
    load();
    const unsub = subscribe(() => load());
    const unsubDay = onNewDay(() => load());
    window.addEventListener('focus', loadFocusSummary);
    document.addEventListener('visibilitychange', loadFocusSummary);
    return () => {
      unsub();
      unsubDay();
      window.removeEventListener('focus', loadFocusSummary);
      document.removeEventListener('visibilitychange', loadFocusSummary);
    };
  });

  function openTask(t: TaskDoc) {
    detailOpenSession++;
    detailTask = t;
    detailProject = data?.allProjects.find(p => p._id === t.project_id) ?? null;
  }

  async function openRelatedTask(id: string) {
    const t = await getTaskById(id);
    if (!t) { showError('This task no longer exists.'); return; }
    const proj = data?.allProjects.find(p => p._id === t.project_id) ?? null;
    if (!proj) { showError('Could not open this task right now.'); return; }
    detailOpenSession++;
    detailTask = t;
    detailProject = proj;
  }
</script>

<div class="dash">
  <div class="fluid-stage over-scroll">
  <div class="dash-header fluid-panel glass">
    <button class="hamburger" on:click={() => dispatch('menu')} aria-label="Menu">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">{@html ICON.menu}</svg>
    </button>
    <div class="title-block">
      <h1 class="dash-title">Dashboard</h1>
      {#if data}
        <span class="dash-sub">
          {data.totalTasks} active task{data.totalTasks === 1 ? '' : 's'} across {data.allProjects.length} project{data.allProjects.length === 1 ? '' : 's'}
          {#if archivedCount > 0}· {archivedCount} archived{/if}
        </span>
        <span class="dash-sub dash-week">
          {#if data.completedLast7Days > 0}
            {data.completedLast7Days} completed this past week {#if data.busiestProjectName}· busiest: {data.busiestProjectName}{/if}
          {:else}
            Nothing completed in the past week yet
          {/if}
        </span>
      {/if}
    </div>
    <!-- Every full-page view needs a visible Command Palette entry point,
         not just the Ctrl+K shortcut — unreachable on mobile with no
         physical keyboard. -->
    <button class="palette-btn" on:click={() => dispatch('search')} title="Commands and search (Ctrl+K)" aria-label="Commands and search (Ctrl+K)">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">{@html ICON.palette}</svg>
    </button>
  </div>
  </div>

  {#if !data}
    <div class="loading"><span class="spinner"></span>Loading…</div>
  {:else}
    <div class="dash-body">
      <div class="brief glass" role="button" tabindex="0" on:click={() => dispatch('focus')} on:keydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); dispatch('focus'); } }}>
        {#if focusLock}
          {@const doneCount = focusLockedTasks.filter(isFocusTaskDone).length}
          <div class="brief-head">
            <span class="brief-label">Today's Focus</span>
            <span class="brief-count">{doneCount} of {focusLockedTasks.length} done</span>
          </div>
          <div class="brief-tasks">
            {#each focusLockedTasks as t (t._id)}
              <span class="brief-task" class:done={isFocusTaskDone(t)}>{t.title}</span>
            {/each}
          </div>
        {:else}
          <div class="brief-row">
            <span class="brief-label">Today's Focus</span>
            <span class="brief-empty">No tasks picked for today yet.</span>
            <span class="brief-go">Choose in Focus ›</span>
          </div>
        {/if}
      </div>

      <div class="dash-cols">

        <!-- Left: Project cards -->
        <div class="col-projects">
          <div class="section-title">Projects</div>
          <div class="project-grid">
            {#each data.allProjects as proj (proj._id)}
              {@const stats = data.byProject[proj._id] ?? { total: 0, open: 0, pinned: 0, overdue: 0, nextDue: null }}
              {@const done = stats.total - stats.open}
              {@const space = data.allSpaces.find(s => s._id === proj.space_id)}
              <div
                class="proj-card glass"
                role="button"
                tabindex="0"
                on:click={() => dispatch('openProject', proj._id)}
                on:keydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); dispatch('openProject', proj._id); } }}
              >
                <div class="proj-card-top">
                  {#if space}
                    <span class="space-dot" style="background:{soften(space.color)}"></span>
                    <span class="space-name">{space.name}</span>
                  {/if}
                  {#if stats.pinned}<span class="stat pinned-stat" title="{stats.pinned} pinned" role="img" aria-label="{stats.pinned} pinned"><PinStar size={11} filled={false} stroked />{stats.pinned}</span>{/if}
                </div>
                <div class="proj-name">{proj.name}</div>
                {#if stats.total}
                  <div class="proj-meta">
                    <span>{done}/{stats.total} done</span>
                    {#if stats.overdue}<span class="overdue-stat">{stats.overdue} overdue</span>
                    {:else if stats.nextDue}<span>{nextDueLabel(stats.nextDue, $today)}</span>{/if}
                  </div>
                  <div class="progress" aria-hidden="true"><span style="width:{Math.round(done / stats.total * 100)}%"></span></div>
                {:else}
                  <div class="proj-meta"><span>No tasks yet</span></div>
                {/if}
              </div>
            {/each}
            {#if data.allProjects.length === 0}
              <div class="no-projects">No projects yet — use "+ New project" in the sidebar to create your first one.</div>
            {/if}
          </div>
        </div>

        <!-- Right: Pinned + Overdue -->
        <div class="col-tasks">
          {#if data.todayTasks.length > 0}
            <section class="section">
              <div class="section-title">Today</div>
              <div class="task-list">
                {#each data.todayTasks.slice(0, TASK_CAP) as t (t._id)}
                  <div
                    class="task-row glass"
                    role="button"
                    tabindex="0"
                    on:click={() => openTask(t)}
                    on:keydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTask(t); } }}
                  >
                    <span class="prio-bar" style="background:{PRIORITY_COLOR[t.priority]}"></span>
                    <div class="task-body">
                      <span class="task-title">{t.title}</span>
                      <span class="task-proj">{data.projCache[t.project_id] ?? '—'}</span>
                    </div>
                  </div>
                {/each}
              </div>
              {#if data.todayTasks.length > TASK_CAP}
                <button class="view-all" on:click={() => dispatch('agenda')}>View all {data.todayTasks.length} in Agenda</button>
              {/if}
            </section>
          {/if}

          {#if pinnedRest.length > 0}
            <section class="section">
              <div class="section-title pinned-title">Pinned</div>
              <div class="task-list">
                {#each (pinnedExpanded ? pinnedRest : pinnedRest.slice(0, TASK_CAP)) as t (t._id)}
                  <div
                    class="task-row glass"
                    role="button"
                    tabindex="0"
                    on:click={() => openTask(t)}
                    on:keydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTask(t); } }}
                  >
                    <span class="prio-bar" style="background:{PRIORITY_COLOR[t.priority]}"></span>
                    <div class="task-body">
                      <span class="task-title">{t.title}</span>
                      <span class="task-proj">{data.projCache[t.project_id] ?? '—'}</span>
                    </div>
                  </div>
                {/each}
              </div>
              {#if pinnedRest.length > TASK_CAP}
                <button class="view-all" on:click={() => pinnedExpanded = !pinnedExpanded}>
                  {pinnedExpanded ? 'Show less' : `View all ${pinnedRest.length}`}
                </button>
              {/if}
            </section>
          {/if}

          {#if data.overdueTasks.length > 0}
            <section class="section">
              <div class="section-title overdue-title">Overdue</div>
              <div class="task-list">
                {#each data.overdueTasks.slice(0, TASK_CAP) as t (t._id)}
                  <div
                    class="task-row glass"
                    role="button"
                    tabindex="0"
                    on:click={() => openTask(t)}
                    on:keydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTask(t); } }}
                  >
                    <span class="prio-bar" style="background:{PRIORITY_COLOR[t.priority]}"></span>
                    <div class="task-body">
                      <span class="task-title">{t.title}</span>
                      <span class="task-proj">{data.projCache[t.project_id] ?? '—'} <span class="task-due overdue">· {dueLabelLong(t.due_date!, $today)}</span></span>
                    </div>
                  </div>
                {/each}
              </div>
              {#if data.overdueTasks.length > TASK_CAP}
                <button class="view-all" on:click={() => dispatch('agenda')}>View all {data.overdueTasks.length} in Agenda</button>
              {/if}
            </section>
          {/if}

          {#if data.todayTasks.length === 0 && pinnedRest.length === 0 && data.overdueTasks.length === 0}
            <div class="all-good">All caught up — nothing due today, pinned, or overdue.</div>
          {/if}
        </div>

      </div>
    </div>
  {/if}
</div>

{#if detailTask && detailProject}
  {#key detailTask._id + ':' + detailOpenSession}
    <CardDetail
      task={detailTask}
      project={detailProject}
      on:close={async () => { detailTask = null; detailProject = null; await reloadTasks(); await load(); }}
      on:openRelated={(e) => openRelatedTask(e.detail)}
    />
  {/key}
{/if}

<style>
  .dash { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }

  .dash-header {
    /* flex-start, not center: centering against the whole title-block puts
       the hamburger at a different vertical spot depending on how many
       subtitle lines a page has (Dashboard's 3 vs Agenda/Focus's 1). Top
       alignment plus the hamburger's own small top margin lines it up with
       the title's first line on every page. */
    display: flex; align-items: flex-start; gap: 10px;
    flex-shrink: 0;
  }
  .title-block { min-width: 0; }
  .dash-title { margin: 0 0 3px; font-size: var(--fs-t); font-weight: 700; letter-spacing: -.015em; }
  .dash-sub { font-family: var(--mono); font-size: var(--fs-xs); color: var(--faint); display: block; }
  .dash-week { margin-top: 2px; }

  .hamburger {
    display: none;
    background: none; border: none; cursor: pointer;
    color: var(--text); padding: 4px; border-radius: var(--r-s); margin-top: 1px;
    flex-shrink: 0; align-items: center; justify-content: center;
    transition: background var(--dur-hover) var(--ease-hover);
  }
  .hamburger:hover { background: var(--hover); }

  .palette-btn {
    display: flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; flex-shrink: 0;
    background: var(--rail-bg); border: 0; border-radius: 11px;
    margin-left: auto;
    color: var(--muted); cursor: pointer; transition: color var(--dur-hover) var(--ease-hover), background var(--dur-hover) var(--ease-hover);
    /* header is align-items:flex-start, but this button sits centered
       against the row rather than pinned to the top like the (multi-line)
       title block. */
    align-self: center;
  }
  .palette-btn:hover { color: var(--text); background: color-mix(in srgb, var(--text) 12%, transparent); }

  .dash-body {
    flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable;
    padding: 20px 28px 32px;
    display: flex; flex-direction: column;
  }

  /* "Daily Brief" card, full-width above the two-column layout. */
  /* .brief, .proj-card and .task-row are .glass (app.css): fill, edge and
     highlight come from there, with its solid fallbacks. Hover brightens the
     edge, never a shadow or a solid fill. */
  .brief {
    border-radius: var(--r-l);
    padding: 12px 18px; margin-bottom: 22px; cursor: pointer;
    display: flex; flex-direction: column; gap: 8px;
    transition: border-color var(--dur-hover) var(--ease-hover);
  }
  .brief:hover { border-color: var(--glass-edge-hover); }
  .brief-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .brief-label {
    font-family: var(--mono); font-size: var(--fs-2xs); text-transform: uppercase;
    letter-spacing: .08em; font-weight: 700; color: var(--faint);
  }
  .brief-count { font-family: var(--mono); font-size: var(--fs-xs); color: var(--accent); font-weight: 700; font-variant-numeric: tabular-nums; }
  .brief-empty { font-size: var(--fs-m); color: var(--muted); }
  .brief-row { display: flex; align-items: center; gap: 14px; }
  .brief-go { margin-left: auto; font-size: var(--fs-s); font-weight: 600; color: var(--accent-ink); white-space: nowrap; }
  .brief-tasks { display: flex; flex-wrap: wrap; gap: 8px 16px; }
  .brief-task {
    font-size: var(--fs-m); color: var(--text); position: relative; padding-left: 16px;
  }
  .brief-task::before {
    content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
    width: 8px; height: 8px; border-radius: 50%; border: 1.6px solid var(--border-strong);
  }
  .brief-task.done { color: var(--faint); text-decoration: line-through; }
  .brief-task.done::before { background: var(--success); border-color: var(--success); }

  /* Two-column layout: projects left, tasks right */
  .dash-cols {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 24px;
    flex: 1;
  }

  .col-projects { display: flex; flex-direction: column; }
  .col-tasks { display: flex; flex-direction: column; gap: 20px; }

  .section { display: flex; flex-direction: column; }

  /* Deliberately understated: a secondary "there's more" affordance, not a
     call to action competing with the task rows themselves. */
  .view-all {
    background: none; border: none; cursor: pointer;
    color: var(--faint);
    font-size: var(--fs-xs); padding: 8px 12px 0; text-align: left;
    transition: opacity var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .view-all:hover { opacity: 1; color: var(--muted); }

  .section-title {
    font-family: var(--mono); font-size: var(--fs-2xs); text-transform: uppercase;
    letter-spacing: .08em; font-weight: 700; color: var(--faint);
    margin-bottom: 10px;
  }
  /* Pinned/overdue are signalled through color alone here, matching every
     other view — no ★/⚠ glyphs. */
  .pinned-title { color: var(--accent); }
  .overdue-title { color: var(--danger); }

  .project-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    align-content: start;
    /* Don't add align-items:start here. Cards must keep the default
       stretch so each row's cards match its tallest sibling — with an
       uneven number of stat badges per card, start-alignment gives a
       ragged grid. Title-height variance is already handled by
       .proj-name's min-height below. */
  }
  .proj-card {
    border-radius: var(--r-l);
    padding: 14px 16px 16px; cursor: pointer;
    transition: border-color var(--dur-hover) var(--ease-hover), box-shadow var(--dur-hover) var(--ease-hover), transform var(--dur-hover) var(--ease-hover);
    display: flex; flex-direction: column; gap: 6px;
  }
  .proj-card:hover { border-color: var(--glass-edge-hover); transform: translateY(-1px); }

  /* Fixed height: a pin count must not push the title down on some cards. */
  .proj-card-top { display: flex; align-items: center; gap: 6px; height: 16px; }
  .space-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  /* Wrap, never truncate. min-width:0 is required for a flex child to wrap
     instead of overflowing its row (flex items default to a content-based
     min-width). The grid's grid-auto-rows: minmax(130px, auto) absorbs the
     resulting variable heights. */
  .space-name { font-family: var(--mono); font-size: var(--fs-2xs); color: var(--faint); text-transform: uppercase; letter-spacing: .05em; min-width: 0; overflow-wrap: break-word; }
  /* min-height reserves 2 lines' worth of title height unconditionally, so
     every card budgets the same space whether or not its title wraps and
     the grid stays uniform without truncating 2-line titles. */
  .proj-name { font-size: var(--fs-l); font-weight: 700; line-height: 1.3; color: var(--text); overflow-wrap: break-word; margin-bottom: auto; padding-bottom: 6px; }
  /* Chips, not bare wrapped text — at narrow card widths plain text runs
     wrap onto separate lines with uneven spacing. Pill chips still wrap,
     but each reads as one self-contained unit. */
  .stat {
    font-family: var(--mono); font-size: var(--fs-xs); color: var(--muted);
    display: inline-flex; align-items: center; gap: 3px;
    padding: 2px 7px; border-radius: var(--r-xl); background: var(--hover);
    white-space: nowrap;
  }
  .progress { height: 3px; border-radius: 3px; background: color-mix(in srgb, var(--text) 7%, transparent); overflow: hidden; }
  .progress span { display: block; height: 100%; border-radius: 4px; background: var(--success); }
  .proj-meta { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: var(--fs-s); color: var(--faint); }
  .pinned-stat { margin-left: auto; color: var(--accent-ink); background: none; padding: 0; font-family: inherit; line-height: 1; }
  .overdue-stat { color: var(--overdue-ink); font-weight: 600; }

  .task-list { display: flex; flex-direction: column; gap: 6px; }
  .task-row {
    display: flex; align-items: stretch; gap: 9px;
    padding: 10px 12px; border-radius: var(--r-l);
    cursor: pointer; transition: border-color var(--dur-hover) var(--ease-hover);
  }
  .task-row:hover { border-color: var(--glass-edge-hover); }
  /* align-self:stretch, not a fixed height — titles wrap rather than
     truncate, so row height varies; stretching keeps this a full edge
     accent at any row height. */
  .prio-bar { width: 3px; align-self: stretch; border-radius: 2px; flex-shrink: 0; }
  /* Title on one line, project/date on a second (primary/secondary list-row
     pattern) — cramming all three onto one line inside the 320px right
     column forces heavy truncation. */
  .task-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .task-title { font-size: var(--fs-m); font-weight: 500; color: var(--text); overflow-wrap: break-word; }
  .task-proj {
    font-family: var(--mono); font-size: var(--fs-2xs); color: var(--faint);
    overflow-wrap: break-word;
  }
  .task-due { color: var(--muted); }
  .task-due.overdue { color: var(--danger); }

  .all-good { color: var(--faint); font-size: var(--fs-m); padding: 6px 0; }
  .no-projects { grid-column: 1 / -1; color: var(--faint); font-size: var(--fs-m); padding: 6px 0; }
  .loading { display: flex; align-items: center; justify-content: center; gap: 9px; padding: 3rem; color: var(--faint); font-family: var(--mono); font-size: var(--fs-s); }

  /* ── Responsive ── */
  @media (max-width: 900px) {
    /* minmax(0, 1fr), not bare 1fr — a bare fr track's implicit minimum
       is auto (= its content's max-content size), so it doesn't actually
       clamp to the container width — at a 375px viewport a bare 1fr track
       grows past its own container and clips the second card column with
       no way to reach it. */
    .dash-cols { grid-template-columns: minmax(0, 1fr); }
    .col-tasks { gap: 16px; }
  }
  @media (max-width: 768px), (max-height: 500px) and (orientation: landscape) {
    .hamburger { display: flex; }
  }
  @media (max-width: 600px) {
    .dash-header { padding: 14px 16px 10px; }
    .dash-body { padding: 14px 14px 32px; }
    .project-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
  }
</style>
