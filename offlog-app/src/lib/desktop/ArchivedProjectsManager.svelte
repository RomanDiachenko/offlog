<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { panelIn, panelOut, panelScrimIn, panelScrimOut, exitMs } from '../motion';
  import { getProjects, getArchivedProjects, archiveProject, unarchiveProject, deleteProject, subscribe } from '../db';
  import { reloadTasks, showError, activeProjectId, spaces } from '../store';
  import { ICON } from '../shared/iconPaths';
  import { confirmAction } from '../confirm';
  import { closeOnBack, isTopLayer } from '../modalStack';
  import { trapFocus } from '../focusTrap';
  import CustomSelect from './CustomSelect.svelte';
  import type { ProjectDoc } from '../types';
  // Svelte does not run intro transitions on a component's own root elements
  // when the component itself is being created -- and every panel here is
  // created by a parent's {#if}. Without the gate below no modal animates,
  // however carefully its preset is tuned. Gating the
  // markup on a flag set in onMount() makes the elements the product of an
  // UPDATE inside this component, which is what Svelte animates.
  // See docs/motion.md.
  let __introReady = false;
  onMount(() => { __introReady = true; });

  const dispatch = createEventDispatcher<{ close: void }>();
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
    setTimeout(() => dispatch('close'), exitMs.panel(420));
  });

  let activeProjects: ProjectDoc[] = [];
  let archivedProjects: ProjectDoc[] = [];
  let pickerId = '';
  $: spaceName = (id: string) => $spaces.find(s => s._id === id)?.name ?? '';
  $: pickerOptions = [{ value: '', label: 'Choose a project…' }, ...activeProjects.map(p => ({ value: p._id!, label: p.name }))];

  async function load() {
    [activeProjects, archivedProjects] = await Promise.all([getProjects(), getArchivedProjects()]);
  }

  onMount(() => {
    load();
    const unsub = subscribe(() => load());
    return unsub;
  });

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !e.defaultPrevented && isTopLayer(requestClose)) requestClose();
  }

  async function doArchive() {
    if (!pickerId) return;
    const name = activeProjects.find(p => p._id === pickerId)?.name ?? 'this project';
    if (!(await confirmAction(`Archive project "${name}"? It'll be hidden until restored here.`, { confirmLabel: 'Archive' }))) return;
    try {
      await archiveProject(pickerId);
      // Same as Sidebar's doDeleteProject: archiving the project currently
      // open would otherwise leave activeProjectId pointing at a project
      // that's no longer in $projects, and the board goes silently blank.
      if ($activeProjectId === pickerId) activeProjectId.set('');
      pickerId = '';
      await load();
      await reloadTasks();
    } catch {
      showError('Could not archive project. Please try again.');
    }
  }

  async function doRestore(id: string) {
    try {
      await unarchiveProject(id);
      await load();
      await reloadTasks();
    } catch {
      showError('Could not restore project. Please try again.');
    }
  }

  async function doDelete(id: string, name: string) {
    if (!(await confirmAction(`Delete project "${name}" and all its tasks? This can't be undone.`, { danger: true, confirmLabel: 'Delete' }))) return;
    try {
      await deleteProject(id);
      await load();
      await reloadTasks();
    } catch {
      showError('Could not delete project. Please try again.');
    }
  }
</script>

<svelte:window on:keydown={onWindowKeydown}/>

<!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
{#if __introReady}
<div class="scrim" on:click|self={() => requestClose()} in:fade={panelScrimIn(420)} out:fade={panelScrimOut(420)}></div>

<div class="panel" role="dialog" aria-modal="true" aria-label="Archived projects" use:trapFocus in:fly={panelIn(420)} out:fly={panelOut(420)}>
  <div class="panel-head">
    <span class="panel-title">Archived projects</span>
    <button class="close-btn" on:click={() => requestClose()} aria-label="Close">✕</button>
  </div>

  <div class="ap-sub">Archiving hides a project and its open tasks — nothing is deleted.</div>

  <div class="item-list">
    <div class="section-label">Archive a project</div>
    <div class="picker-row">
      <div class="picker-select">
        <CustomSelect options={pickerOptions} bind:value={pickerId} />
      </div>
      <button class="archive-btn" on:click={doArchive} disabled={!pickerId}>Archive</button>
    </div>

    <div class="section-label">Archived{archivedProjects.length ? ` (${archivedProjects.length})` : ''}</div>
    {#if archivedProjects.length === 0}
      <div class="empty">No archived projects yet.</div>
    {:else}
      <div class="group glass">
        {#each archivedProjects as p (p._id)}
          <div class="row">
            <span class="name">{p.name}</span>
            {#if spaceName(p.space_id)}<span class="space">{spaceName(p.space_id)}</span>{/if}
            <button class="restore-btn" on:click={() => doRestore(p._id)}>Restore</button>
            <button class="delete-btn" title="Delete project" aria-label="Delete project {p.name}" on:click={() => doDelete(p._id, p.name)}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICON.trash}</svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
{/if}

<style>
  /* .scrim is defined globally in app.css */

  .panel {
    position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw);
    background: var(--bg); border-left: 1px solid var(--glass-edge);
    box-shadow: var(--elev-3-side); z-index: 402;
    display: flex; flex-direction: column;
    padding-top: env(safe-area-inset-top, 0px);
  }

  .panel-head {
    display: flex; align-items: center; gap: 8px;
    padding: 20px 24px 4px; flex-shrink: 0;
  }
  .panel-title { font-size: var(--fs-xl); font-weight: 700; flex: 1; letter-spacing: -.015em; }

  .ap-sub {
    padding: 0 24px 16px; font-size: var(--fs-s); color: var(--faint);
    flex-shrink: 0;
  }

  .close-btn {
    background: none; border: none; cursor: pointer; font-size: var(--fs-m);
    color: var(--faint); padding: 4px 6px; border-radius: var(--r-s);
    transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .close-btn:hover { background: var(--hover); color: var(--text); }

  .item-list { flex: 1; overflow-y: auto; padding: 12px 24px 24px; }
  .section-label { font-size: var(--fs-s); font-weight: 500; color: var(--faint); margin: 0 2px 8px; }
  /* The archived list: one glass panel of lined rows. */
  .group { border-radius: var(--r-l); padding: 0 8px 0 14px; }
  .group > .row + .row { border-top: 1px solid var(--line); }
  .empty { color: var(--faint); font-size: var(--fs-m); padding: 4px 2px; line-height: 1.5; }

  /* The task window's controls: a round outlined select and a pill button. */
  .picker-row {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 24px;
  }
  .picker-select { flex: 1; min-width: 0; }
  .picker-select :global(.custom-select .cs-trigger) { background: none; border-color: var(--glass-edge); border-radius: 999px; height: 32px; padding: 0 12px; font-size: var(--fs-s); }
  .picker-select :global(.custom-select .cs-trigger:hover) { border-color: var(--glass-edge-hover); }
  .archive-btn {
    flex-shrink: 0; background: var(--text); border: none; cursor: pointer;
    color: var(--bg); font-size: var(--fs-s); font-weight: 600; height: 32px; padding: 0 14px;
    border-radius: 999px; transition: opacity var(--dur-hover) var(--ease-hover);
  }
  .archive-btn:hover:not(:disabled) { opacity: .88; }
  .archive-btn:disabled { opacity: .45; cursor: default; }

  .row {
    display: flex; align-items: center; gap: 8px;
    min-height: 48px;
  }
  .name { font-size: var(--fs-m); font-weight: 500; color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .space { flex: 1; min-width: 0; font-size: var(--fs-s); color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .restore-btn {
    flex-shrink: 0; margin-left: auto; background: none; border: 1px solid var(--glass-edge); cursor: pointer;
    color: var(--text); font-size: var(--fs-s); font-weight: 600; height: 28px; padding: 0 12px;
    border-radius: 999px; transition: border-color var(--dur-hover) var(--ease-hover);
  }
  .restore-btn:hover { border-color: var(--glass-edge-hover); }

  .delete-btn {
    flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; background: none; border: none; cursor: pointer;
    color: var(--faint); padding: 0; border-radius: 999px;
    transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .delete-btn:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); color: color-mix(in srgb, var(--danger) 82%, var(--text)); }
</style>
