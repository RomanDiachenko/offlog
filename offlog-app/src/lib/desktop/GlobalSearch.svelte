<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { scrimIn, scrimOut, searchIn, searchOut, exitMs } from '../motion';
  import { searchAllTasks, type TaskSearchMatch } from '../db';
  import { projects } from '../store';
  import type { TaskDoc, ProjectDoc } from '../types';
  import type { Command } from './commands';
  import { PRIORITY_LABEL } from '../constants';
  import { ICON } from '../shared/iconPaths';
  import { closeOnBack, discardTop, isTopLayer } from '../modalStack';
  import { trapFocus } from '../focusTrap';
  import { localDateStr, escapeHtml, fmtDay, dayOf } from '../utils';
  import { showError } from '../store';
  // Svelte does not run intro transitions on a component's own root elements
  // when the component itself is being created -- and every panel here is
  // created by a parent's {#if}. Without the gate below no modal animates,
  // however carefully its preset is tuned. Gating the
  // markup on a flag set in onMount() makes the elements the product of an
  // UPDATE inside this component, which is what Svelte animates.
  // See docs/motion.md.
  let __introReady = false;
  onMount(() => { __introReady = true; });

  export let commands: Command[] = [];

  const dispatch = createEventDispatcher<{ open: { task: TaskDoc; project: ProjectDoc }; close: void }>();
    // Closing hides the markup first and only tells the parent once the outro
  // has played -- the parent's {#if} destroys this component the instant it
  // hears, which would cut the exit off before its first frame.
  //
  // modalStack is deliberately untouched: closeOnBack() still runs
  // history.back() immediately and unwinds its own entry, so back-button
  // behaviour is identical. Only the parent notification waits.
  //
  // The duration is read HERE, at close time, so Reduce Motion is honoured
  // even if it was switched on after this modal opened.
  const requestClose = closeOnBack(() => {
    __introReady = false;
    setTimeout(() => dispatch('close'), exitMs.medium);
  });

  let query = '';
  let results: (TaskDoc & { project_name: string; matchedIn: TaskSearchMatch })[] = [];
  let searching = false;
  let inputEl: HTMLInputElement;
  let selectedIdx = 0;

  onMount(() => { inputEl?.focus(); });

  // Plain substring matching, same as searchAllTasks() in db.ts — no fuzzy
  // library, so command and task matching stay consistent.
  $: matchingCommands = query.trim()
    ? commands.filter(c => (c.label + ' ' + c.keywords).toLowerCase().includes(query.trim().toLowerCase()))
    : commands.filter(c => !c.onlyWhenSearched);
  // Commands and task results share one keyboard-navigable index —
  // commands first, tasks below.
  $: combinedLength = matchingCommands.length + results.length;

  let debounce: ReturnType<typeof setTimeout> | undefined;
  $: {
    clearTimeout(debounce);
    if (query.trim().length >= 1) {
      searching = true;
      debounce = setTimeout(async () => {
        try {
          results = await searchAllTasks(query);
          selectedIdx = 0;
        } catch {
          results = [];
          showError('Could not search. Please try again.');
        } finally {
          searching = false;
        }
      }, 180);
    } else {
      results = [];
      selectedIdx = 0;
      searching = false;
    }
  }

  function openResult(r: TaskDoc & { project_name: string }) {
    const proj = $projects.find(p => p._id === r.project_id);
    if (!proj) return;
    // discardTop(), not requestClose(): this panel is immediately replaced
    // by the task's CardDetail rather than dismissed. requestClose()'s real
    // history.back() would race the CardDetail's own pushState — see
    // modalStack.ts's discardTop().
    discardTop();
    dispatch('open', { task: r, project: proj });
  }

  function runCommand(c: Command) {
    // Commands that open another closeOnBack()-tracked overlay
    // (QuickAdd/Settings/History/Recycle bin) must use discardTop() — same
    // reasoning as openResult() above. Everything else (navigation,
    // toggles, Sync Now) opens nothing and needs a real close.
    //
    // discardTop() alone isn't enough here: it only does the stack/history
    // bookkeeping. openResult() relies on App.svelte's on:open handler to
    // clear showSearch, but commands carry no such payload, so 'close' must
    // be dispatched explicitly or the palette stays mounted over the
    // overlay it just opened.
    if (c.opensOverlay) { discardTop(); dispatch('close'); }
    else requestClose();
    c.run();
  }

  function selectAt(i: number) {
    if (i < matchingCommands.length) runCommand(matchingCommands[i]);
    else if (results[i - matchingCommands.length]) openResult(results[i - matchingCommands.length]);
  }

  let resultsEl: HTMLDivElement;
  async function moveSelection(next: number) {
    selectedIdx = next;
    await tick();
    resultsEl?.querySelector('.result-row.selected')?.scrollIntoView({ block: 'nearest' });
  }

  // Window-level so Escape closes the palette wherever focus is.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !e.defaultPrevented && isTopLayer(requestClose)) requestClose();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(Math.min(selectedIdx + 1, combinedLength - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveSelection(Math.max(selectedIdx - 1, 0)); }
    if (e.key === 'Enter' && combinedLength > 0) selectAt(selectedIdx);
  }

  // Referenced by the input's aria-activedescendant so a screen reader
  // announces which row arrow keys have moved to — role="option" rows alone
  // only expose aria-selected, which nothing reads without this pointer.
  $: activeDescendantId = combinedLength > 0 ? `search-option-${selectedIdx}` : undefined;

  // r.title is sync-derived, untrusted data (can arrive from another
  // device) and this string is rendered via {@html}, so every piece is
  // HTML-escaped. Match against the RAW text and escape each piece after
  // splitting: matching against escaped text lets a query hit inside an
  // entity ("amp" in "&amp;") and break it.
  function highlight(text: string, q: string): string {
    if (!q.trim()) return escapeHtml(text);
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    // split() with one capturing group puts the matches at odd indices.
    return text.split(re).map((part, i) => i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join('');
  }

  const today = localDateStr(new Date());

  // Only for matches that would otherwise be invisible in the row: the
  // title is already highlighted and tags get their own row (result-tags),
  // so neither needs a hint.
  const MATCH_HINT: Partial<Record<string, string>> = { body: 'Matched in Notes', checklist: 'Matched in Checklist', attachments: 'Matched in an attachment name' };
</script>

<svelte:window on:keydown={onWindowKeydown}/>

<!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
{#if __introReady}
<div class="scrim" on:click={() => requestClose()} in:fade={scrimIn} out:fade={scrimOut}></div>

<div class="search-panel" role="dialog" aria-modal="true" aria-label="Search" use:trapFocus in:searchIn out:searchOut>
  <div class="search-bar">
    <svg class="search-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <circle cx="6.5" cy="6.5" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
    </svg>
    <input
      bind:this={inputEl}
      bind:value={query}
      class="search-input"
      placeholder="Search tasks or run a command…"
      role="combobox"
      aria-expanded={combinedLength > 0}
      aria-controls="search-results-listbox"
      aria-activedescendant={activeDescendantId}
      on:keydown={onKey}
    />
    {#if query}
      <button class="clear-btn" on:click={() => { query = ''; inputEl.focus(); }} aria-label="Clear search">✕</button>
    {/if}
  </div>

  <!-- Keyboard interaction (arrows + Enter) is handled by the search input
       above, listbox-style — rows themselves are mouse targets only.
       Commands and task results share one combined index (commands first)
       so arrow keys move through both as a single list. -->
  <div class="results" role="listbox" aria-label="Commands and search results" id="search-results-listbox" bind:this={resultsEl}>
    {#if matchingCommands.length > 0}
      <div class="section-label">Commands</div>
      {#each matchingCommands as c, i (c.id)}
        <div
          class="result-row"
          id="search-option-{i}"
          role="option"
          aria-selected={i === selectedIdx}
          tabindex="-1"
          class:selected={i === selectedIdx}
          on:click={() => runCommand(c)}
          on:mouseenter={() => selectedIdx = i}
        >
          <span class="cmd-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{@html ICON[c.icon]}</svg></span>
          <div class="result-body">
            <span class="result-title">{@html highlight(c.label, query)}</span>
          </div>
        </div>
      {/each}
    {/if}

    {#if results.length > 0}
      {#if matchingCommands.length > 0}<div class="section-label">Tasks</div>{/if}
      {#each results as r, ri (r._id)}
        {@const i = matchingCommands.length + ri}
        <div
          class="result-row"
          id="search-option-{i}"
          role="option"
          aria-selected={i === selectedIdx}
          tabindex="-1"
          class:selected={i === selectedIdx}
          on:click={() => openResult(r)}
          on:mouseenter={() => selectedIdx = i}
        >
          <span class="task-dot" aria-hidden="true"></span>
          <div class="result-body">
            <span class="result-title">{@html highlight(r.title, query)}</span>
            {#if r.tags?.length}
              <span class="result-tags">{r.tags.join(' · ')}</span>
            {/if}
            {#if MATCH_HINT[r.matchedIn]}
              <span class="result-match-hint">{MATCH_HINT[r.matchedIn]}</span>
            {/if}
          </div>
          <div class="result-meta">
            <span class="result-proj">{#if r.archived}<span class="result-archived">Archived · </span>{/if}{r.project_name}{#if r.priority >= 2}<span class="result-prio" class:high={r.priority === 3}>{' · '}{PRIORITY_LABEL[r.priority]}</span>{/if}</span>
            {#if r.due_date}
              <span class="result-due" class:overdue={r.due_date < today}>{fmtDay(dayOf(r.due_date))}</span>
            {/if}
          </div>
        </div>
      {/each}
    {/if}

    {#if searching}
      <div class="hint"><span class="spinner"></span>Searching…</div>
    {:else if query.trim() && combinedLength === 0}
      <div class="hint hint-empty">No results for "{query}"</div>
    {/if}
  </div>

  <div class="footer">
    <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
    <span><kbd>↵</kbd> open</span>
    <span><kbd>Esc</kbd> close</span>
  </div>
</div>
{/if}

<style>
  /* .scrim is defined globally in app.css */

  .search-panel {
    position: fixed; top: 15vh; left: 50%; transform: translateX(-50%);
    width: min(580px, 95vw); z-index: 401;
    background: var(--surface); border: 1px solid var(--glass-edge);
    border-radius: var(--r-l); box-shadow: var(--elev-3);
    display: flex; flex-direction: column; overflow: hidden;
  }

  .search-bar {
    display: flex; align-items: center; gap: 10px;
    padding: 16px 18px 12px;
  }
  .search-icon { color: var(--faint); flex-shrink: 0; }
  .search-input {
    flex: 1; border: none; background: none; outline: none;
    font-size: var(--fs-xl); color: var(--text); font-family: inherit;
  }
  .search-input::placeholder { color: var(--faint); }
  .clear-btn {
    background: none; border: none; cursor: pointer;
    color: var(--faint); font-size: var(--fs-m); padding: 2px 5px;
    border-radius: 4px; transition: color var(--dur-hover) var(--ease-hover);
  }
  .clear-btn:hover { color: var(--text); }

  .results { max-height: 55vh; overflow-y: auto; padding: 0 6px 6px; }

  .section-label { padding: 10px 12px 4px; font-size: var(--fs-xs); font-weight: 600; color: var(--faint); }

  .cmd-icon {
    width: 16px; flex-shrink: 0; display: flex; justify-content: center; color: var(--faint);
  }

  .result-row {
    display: flex; align-items: center; gap: 12px;
    padding: 9px 12px; cursor: pointer;
    border-radius: var(--r-m); transition: background var(--dur-hover) var(--ease-hover), box-shadow var(--dur-hover) var(--ease-hover);
  }
  .result-row.selected { background: var(--sel-fill); box-shadow: var(--sel-ring); }
  .result-row.selected .cmd-icon { color: var(--text); }

  /* A task reads as the open done-circle it has everywhere else. */
  .task-dot { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--border-strong); flex-shrink: 0; margin: 0 1px; }

  .result-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .result-title { font-size: var(--fs-m); font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .result-title :global(mark) { background: color-mix(in srgb, var(--accent) 25%, transparent); color: var(--accent-ink); border-radius: 2px; padding: 0 1px; }
  .result-tags { font-size: var(--fs-xs); color: var(--faint); font-family: var(--mono); }
  .result-match-hint { font-size: var(--fs-xs); color: var(--faint); font-style: italic; }

  .result-archived { color: var(--muted); }
  .result-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
  .result-proj { font-family: var(--mono); font-size: var(--fs-2xs); color: var(--faint); white-space: nowrap; }
  .result-prio { color: var(--muted); }
  .result-prio.high { color: var(--danger); }
  /* --faint misses 4.5:1 on the selected fill in dark mode. */
  .result-row.selected .result-proj, .result-row.selected .result-tags { color: var(--muted); }
  .result-due { font-family: var(--mono); font-size: var(--fs-2xs); color: var(--muted); }
  .result-due.overdue { color: var(--danger); }

  .hint { display: flex; align-items: center; justify-content: center; gap: 9px; padding: 24px 16px; text-align: center; color: var(--faint); font-size: var(--fs-m); }
  /* Styled as a terminal empty state, matching every other view's, so it
     doesn't read as search still being in progress. */
  .hint-empty { font-size: var(--fs-l); color: var(--muted); padding: 32px 16px; }

  .footer {
    display: flex; gap: 16px; padding: 9px 18px; background: var(--field-bg);
    font-size: var(--fs-xs); color: var(--muted);
  }
  .footer kbd {
    font: inherit; font-size: var(--fs-2xs); font-weight: 600; color: var(--muted);
    background: var(--surface); box-shadow: var(--elev-1); border-radius: 5px;
    padding: 1px 5px; margin-right: 3px; min-width: 1.2em; display: inline-block; text-align: center;
  }
</style>
