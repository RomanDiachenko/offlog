<script lang="ts">
  import { ICON } from '../shared/iconPaths';
  import { soften } from '../tagColors';
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { panelIn, panelOut, panelScrimIn, panelScrimOut, popIn, popOut, exitMs } from '../motion';
  import { createSpace, updateSpace, reorderSpaces, deleteSpace, getSpaces, subscribe, findSpacesByName } from '../db';
  import { showError } from '../store';
  import { confirmAction } from '../confirm';
  import { closeOnBack, isTopLayer } from '../modalStack';
  import { trapFocus } from '../focusTrap';
  import type { SpaceDoc } from '../types';
  import { SPACE_ICONS, DEFAULT_SPACE_ICON_KEY, getSpaceIconSvg } from '../spaceIcons';
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

  let items: SpaceDoc[] = [];
  let editingId: string | null = null;
  let editingName = '';
  let newName = '';
  let newColor = '#6366f1';
  let newIcon = DEFAULT_SPACE_ICON_KEY;
  let adding = false;
  // Duplicate-name nudge: a hint only, never blocking. See
  // findSpacesByName() in db.ts.
  let duplicateSpaceHint = '';
  async function checkSpaceNameDuplicate(name: string) {
    const trimmed = name.trim();
    if (!trimmed) { duplicateSpaceHint = ''; return; }
    const matches = await findSpacesByName(trimmed);
    duplicateSpaceHint = matches.length ? `A space named "${trimmed}" already exists.` : '';
  }

  // 'new' for the not-yet-created row, or a space's own _id — only one
  // icon picker open at a time, closed on any outside click.
  let iconPickerFor: string | null = null;
  function toggleIconPicker(id: string) { iconPickerFor = iconPickerFor === id ? null : id; }
  function onDocClick(e: MouseEvent) {
    if (iconPickerFor && !(e.target as HTMLElement).closest('.icon-picker-wrap')) iconPickerFor = null;
  }
  onMount(() => document.addEventListener('click', onDocClick, true));
  onDestroy(() => document.removeEventListener('click', onDocClick, true));

  async function setIcon(s: SpaceDoc, icon: string) {
    iconPickerFor = null;
    try {
      await updateSpace(s._id, { icon });
    } catch {
      showError('Could not change space icon. Please try again.');
    }
  }

  async function load() { items = await getSpaces(); }

  onMount(() => {
    load();
    const unsub = subscribe(() => load());
    return unsub;
  });

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented || !isTopLayer(requestClose)) return;
    if (editingId) editingId = null; else requestClose();
  }

  function startEdit(s: SpaceDoc) { editingId = s._id; editingName = s.name; }
  // Same nudge as adding: a rename can make a duplicate just as easily.
  let editDupHint = '', editDupSeq = 0;
  async function checkEditDuplicate(id: string, name: string, current: string) {
    const n = name.trim(), mine = ++editDupSeq;
    if (!n || n === current) { editDupHint = ''; return; }
    try {
      const matches = await findSpacesByName(n, id);
      if (mine === editDupSeq) editDupHint = matches.length ? `A space named "${n}" already exists.` : '';
    } catch { editDupHint = ''; }
  }
  $: editingSpace = items.find(s => s._id === editingId);
  $: if (editingSpace) checkEditDuplicate(editingSpace._id, editingName, editingSpace.name); else editDupHint = '';

  async function saveEdit(s: SpaceDoc) {
    const name = editingName.trim();
    editingId = null;
    if (!name || name === s.name) return;
    try {
      await updateSpace(s._id, { name });
    } catch {
      showError('Could not rename space. Please try again.');
    }
  }

  async function setColor(s: SpaceDoc, color: string) {
    try {
      await updateSpace(s._id, { color });
    } catch {
      showError('Could not recolor space. Please try again.');
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      await reorderSpaces(reordered.map(s => s._id));
    } catch {
      showError('Could not reorder spaces. Please try again.');
    }
  }

  async function remove(s: SpaceDoc) {
    if (!(await confirmAction(`Delete space "${s.name}"? Its projects will move to Unsorted.`, { danger: true, confirmLabel: 'Delete' }))) return;
    try {
      await deleteSpace(s._id);
    } catch (e) {
      showError('Could not delete space. Please try again.');
    }
  }

  // Escape also blurs the input, and blur fires its own submit independently
  // of the Escape keydown handler's cancel — whichever runs first, the other
  // still runs after. Set before cancelling so a real cancel beats the
  // same-tick blur-submit. Same race as Sidebar.svelte's project-add flow.
  let cancellingAddSpace = false;

  async function addSpace() {
    if (cancellingAddSpace) return;
    const name = newName.trim();
    if (!name) { adding = false; return; }
    try {
      await createSpace(name, newColor, newIcon);
      newName = '';
      newColor = '#6366f1';
      newIcon = DEFAULT_SPACE_ICON_KEY;
    } catch {
      showError('Could not create space. Please try again.');
    }
    adding = false;
    duplicateSpaceHint = '';
  }
</script>

<svelte:window on:keydown={onWindowKeydown}/>

<!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
{#if __introReady}
<div class="scrim" on:click|self={() => requestClose()} in:fade={panelScrimIn(420)} out:fade={panelScrimOut(420)}></div>

<div class="panel" role="dialog" aria-modal="true" aria-label="Spaces" use:trapFocus in:fly={panelIn(420)} out:fly={panelOut(420)}>
  <div class="panel-head">
    <span class="panel-title">Spaces</span>
    <button class="close-btn" on:click={() => requestClose()} aria-label="Close">✕</button>
  </div>

  <div class="item-list">
    <div class="group">
      {#each items as s, i (s._id)}
        <div class="row">
          <label class="swatch-wrap" title="Change color">
            <input type="color" aria-label="Color of {s.name}" value={s.color} on:change={(e) => setColor(s, (e.target as HTMLInputElement).value)} />
            <span class="swatch" style="background:{soften(s.color)}"></span>
          </label>
  
          <div class="icon-picker-wrap">
            <button type="button" class="icon-btn" title="Change icon" aria-label="Change icon" on:click={() => toggleIconPicker(s._id)}>
              {@html getSpaceIconSvg(s)}
            </button>
            {#if iconPickerFor === s._id}
              <div class="icon-picker" in:fly={popIn} out:fly={popOut}>
                {#each SPACE_ICONS as opt (opt.key)}
                  <button type="button" class="icon-opt" class:selected={(s.icon ?? DEFAULT_SPACE_ICON_KEY) === opt.key} title={opt.key} on:click={() => setIcon(s, opt.key)}>
                    {@html `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${opt.svg}</svg>`}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
  
          {#if editingId === s._id}
            <!-- svelte-ignore a11y-autofocus -->
            <input
              class="name-input"
              autofocus
              bind:value={editingName}
              on:keydown={(e) => { if (e.key === 'Enter') saveEdit(s); if (e.key === 'Escape') { e.stopPropagation(); editingId = null; } }}
              on:blur={() => saveEdit(s)}
            />
          {:else}
            <button class="name-btn" on:click={() => startEdit(s)}>{s.name}</button>
          {/if}
  
          <div class="reorder-btns">
            <button on:click={() => move(i, -1)} disabled={i === 0} aria-label="Move {s.name} up" title="Move up">↑</button>
            <button on:click={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move {s.name} down" title="Move down">↓</button>
          </div>
  
          {#if s._id !== 'space:unsorted'}
            <button class="delete-btn" on:click={() => remove(s)} title="Delete space" aria-label="Delete space"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICON.trash}</svg></button>
          {/if}
        </div>
        {#if editingId === s._id && editDupHint}<p class="dup-name-hint">{editDupHint}</p>{/if}
      {/each}
  
      {#if adding}
        <div class="row new-row">
          <label class="swatch-wrap" title="Pick a color">
            <input type="color" aria-label="Color of the new space" bind:value={newColor} />
            <span class="swatch" style="background:{soften(newColor)}"></span>
          </label>
          <div class="icon-picker-wrap">
            <button type="button" class="icon-btn" title="Change icon" aria-label="Change icon" on:click={() => toggleIconPicker('new')}>
              {@html `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${SPACE_ICONS.find(i => i.key === newIcon)!.svg}</svg>`}
            </button>
            {#if iconPickerFor === 'new'}
              <div class="icon-picker" in:fly={popIn} out:fly={popOut}>
                {#each SPACE_ICONS as opt (opt.key)}
                  <button type="button" class="icon-opt" class:selected={newIcon === opt.key} title={opt.key} on:click={() => { newIcon = opt.key; iconPickerFor = null; }}>
                    {@html `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${opt.svg}</svg>`}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
          <!-- svelte-ignore a11y-autofocus -->
          <input
            class="name-input"
            autofocus
            placeholder="Space name…"
            bind:value={newName}
            on:input={() => checkSpaceNameDuplicate(newName)}
            on:keydown={(e) => { if (e.key === 'Enter') addSpace(); if (e.key === 'Escape') { e.stopPropagation(); cancellingAddSpace = true; adding = false; duplicateSpaceHint = ''; } }}
            on:blur={addSpace}
          />
        </div>
        {#if duplicateSpaceHint}<p class="dup-name-hint">{duplicateSpaceHint}</p>{/if}
      {:else}
        <button class="add-btn" on:click={() => { adding = true; newName = ''; newColor = '#6366f1'; cancellingAddSpace = false; }}>+ New space</button>
      {/if}
    </div>
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
    padding: 20px 24px 16px; flex-shrink: 0;
  }
  .panel-title { font-size: var(--fs-xl); font-weight: 700; flex: 1; letter-spacing: -.015em; }

  .close-btn {
    background: none; border: none; cursor: pointer; font-size: var(--fs-m);
    color: var(--faint); padding: 4px 6px; border-radius: var(--r-s);
    transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .close-btn:hover { background: var(--hover); color: var(--text); }

  .item-list { flex: 1; overflow-y: auto; padding: 12px 24px 24px; }
  /* One white card of rows, like Settings; an inset line between rows. */
  /* One glass panel of lined rows, as in Archived projects. */
  .group { background: var(--glass-solid); border: 1px solid var(--glass-edge); border-radius: var(--r-l); box-shadow: inset 0 1px 0 var(--glass-hi), var(--glass-shadow); padding: 0 8px 0 14px; }
  .group > .row + .row { border-top: 1px solid var(--line); }

  .row {
    display: flex; align-items: center; gap: 10px;
    min-height: 48px; padding: 6px 0;
  }

  .swatch-wrap { position: relative; width: 20px; height: 20px; flex-shrink: 0; cursor: pointer; }
  .swatch-wrap input[type="color"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .swatch { display: block; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--border); }

  .icon-picker-wrap { position: relative; flex-shrink: 0; }
  .icon-btn {
    width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
    background: none; border: 1px solid var(--border); border-radius: var(--r-s); cursor: pointer;
    color: var(--faint); transition: border-color var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .icon-btn:hover { border-color: var(--accent); color: var(--text); }
  .icon-btn :global(svg) { width: 13px; height: 13px; }

  .icon-picker {
    position: absolute; top: calc(100% + 6px); left: 0; z-index: 220;
    display: grid; grid-template-columns: repeat(5, 32px); gap: 4px;
    background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
    box-shadow: var(--elev-3); padding: 8px;
  }
  .icon-opt {
    width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
    background: none; border: none; border-radius: var(--r-s); cursor: pointer;
    color: var(--muted); transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .icon-opt:hover { background: var(--hover); color: var(--text); }
  .icon-opt.selected { background: var(--sel-fill); color: var(--text); box-shadow: var(--sel-ring); }
  .icon-opt :global(svg) { width: 16px; height: 16px; }

  .name-btn {
    flex: 1; text-align: left; background: none; border: none; cursor: pointer;
    font-size: var(--fs-m); color: var(--text); padding: .3rem .4rem; border-radius: var(--r-s);
    transition: background var(--dur-hover) var(--ease-hover);
  }
  .name-btn:hover { background: var(--hover); }

  .name-input {
    flex: 1; font-size: var(--fs-m); height: 32px; padding: 0 12px; border-radius: 999px;
    border: 1px solid var(--accent); background: none; color: var(--text);
  }
  .dup-name-hint { font-size: var(--fs-xs); color: var(--due-soon-ink); margin: -4px 0 8px; line-height: 1.3; }

  .reorder-btns { display: flex; gap: 2px; flex-shrink: 0; }
  .reorder-btns button {
    background: none; border: none; cursor: pointer; color: var(--faint);
    padding: .25rem .4rem; border-radius: var(--r-s); font-size: var(--fs-m);
    transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .reorder-btns button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
  .reorder-btns button:disabled { opacity: .3; cursor: default; }

  .delete-btn {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; background: none; border: none; cursor: pointer;
    color: var(--faint); padding: 0; border-radius: 999px;
    flex-shrink: 0; transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .delete-btn:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); color: color-mix(in srgb, var(--danger) 82%, var(--text)); }

  .add-btn {
    align-self: flex-start; margin: 10px 0 14px; background: none; border: 1px solid var(--glass-edge); cursor: pointer; color: var(--text);
    font-size: var(--fs-s); font-weight: 600; height: 32px; padding: 0 14px; border-radius: 999px;
    transition: border-color var(--dur-hover) var(--ease-hover);
  }
  .add-btn:hover { border-color: var(--glass-edge-hover); }

  .new-row .swatch-wrap { margin-left: 0; }
</style>
