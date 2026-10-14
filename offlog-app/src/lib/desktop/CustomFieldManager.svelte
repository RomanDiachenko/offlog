<script lang="ts">
  import { ICON } from '../shared/iconPaths';
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { panelIn, panelOut, panelScrimIn, panelScrimOut, exitMs } from '../motion';
  import { getCustomFieldDefs, addCustomFieldDef, removeCustomFieldDef, updateCustomFieldDef, getCustomFieldUsageCount } from '../db';
  import { showError } from '../store';
  import { confirmAction } from '../confirm';
  import { closeOnBack, isTopLayer } from '../modalStack';
  import { trapFocus } from '../focusTrap';
  import CustomSelect from './CustomSelect.svelte';
  import type { CustomFieldDef } from '../types';
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

  let fields: CustomFieldDef[] = [];
  let newName = '';
  let newType: CustomFieldDef['type'] = 'text';
  let newOptions = '';
  // A Select field with no options offers nothing to pick.
  const hasOptions = (s: string) => s.split(',').some(o => o.trim());
  const typeLabel = (t: CustomFieldDef['type']) => typeOptions.find(o => o.value === t)?.label ?? t;

  const typeOptions = [
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'select', label: 'Select' },
  ];

  async function load() { fields = await getCustomFieldDefs(); }
  onMount(load);

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !e.defaultPrevented && isTopLayer(requestClose)) requestClose();
  }

  async function add() {
    const name = newName.trim();
    if (!name || (newType === 'select' && !hasOptions(newOptions))) return;
    const options = newType === 'select' ? newOptions.split(',').map(o => o.trim()).filter(Boolean) : undefined;
    try {
      fields = await addCustomFieldDef(name, newType, options);
      newName = ''; newOptions = ''; newType = 'text';
    } catch {
      showError('Could not add field. Please try again.');
    }
  }

  async function remove(field: CustomFieldDef) {
    const count = await getCustomFieldUsageCount(field.id);
    const usage = count > 0 ? ` Its value will be permanently erased from ${count} task${count === 1 ? '' : 's'}.` : '';
    if (!(await confirmAction(`Remove the "${field.name}" field?${usage}`, { danger: true, confirmLabel: 'Remove' }))) return;
    try {
      fields = await removeCustomFieldDef(field.id);
    } catch {
      showError('Could not remove field. Please try again.');
    }
  }

  // Renaming a field or changing its type/options edits inline in the same
  // row rather than in a separate modal — the list is small by design (see
  // the panel's own hint text).
  let editingId: string | null = null;
  let editName = '';
  let editType: CustomFieldDef['type'] = 'text';
  let editOptions = '';

  function startEdit(field: CustomFieldDef) {
    editingId = field.id;
    editName = field.name;
    editType = field.type;
    editOptions = (field.options ?? []).join(', ');
  }
  function cancelEdit() { editingId = null; }

  async function saveEdit(field: CustomFieldDef) {
    const name = editName.trim();
    if (!name || (editType === 'select' && !hasOptions(editOptions))) return;
    const options = editType === 'select' ? editOptions.split(',').map(o => o.trim()).filter(Boolean) : undefined;
    try {
      fields = await updateCustomFieldDef(field.id, { name, type: editType, options });
      editingId = null;
    } catch {
      showError('Could not update field. Please try again.');
    }
  }
</script>

<svelte:window on:keydown={onWindowKeydown}/>

<!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
{#if __introReady}
<div class="scrim" on:click|self={() => requestClose()} in:fade={panelScrimIn(420)} out:fade={panelScrimOut(420)}></div>

<div class="panel" role="dialog" aria-modal="true" aria-label="Fields" use:trapFocus in:fly={panelIn(420)} out:fly={panelOut(420)}>
  <div class="panel-head">
    <span class="panel-title">Fields</span>
    <button class="close-btn" on:click={() => requestClose()} aria-label="Close">✕</button>
  </div>

  <div class="cf-sub">Fields apply to every task in every project — keep the list short so cards stay readable.</div>

  <div class="item-list">
    <div class="group">
      {#if fields.length === 0}
        <div class="empty">No fields yet.</div>
      {:else}
        {#each fields as field (field.id)}
          {#if editingId === field.id}
            <div class="row row-editing">
              <input class="name-input" bind:value={editName} placeholder="Field name" enterkeyhint="done" on:keydown={(e) => e.key === 'Enter' && saveEdit(field)} />
              <div class="type-select">
                <CustomSelect options={typeOptions} value={editType} placement="up" on:change={(e) => editType = e.detail as CustomFieldDef['type']} />
              </div>
              {#if editType === 'select'}
                <input class="name-input" bind:value={editOptions} placeholder="Options, comma-separated" />
              {/if}
              <div class="row-edit-actions">
                <button class="edit-cancel-btn" on:click={cancelEdit}>Cancel</button>
                <button class="edit-save-btn" on:click={() => saveEdit(field)} disabled={!editName.trim() || (editType === 'select' && !hasOptions(editOptions))}>Save</button>
              </div>
            </div>
          {:else}
            <div class="row">
              <button class="row-text row-edit-trigger" on:click={() => startEdit(field)} title="Edit field" aria-label="Edit field {field.name}">
                <span class="name">{field.name}</span>
                <span class="type">{typeLabel(field.type)}{#if field.type === 'select' && field.options?.length} · {field.options.join(', ')}{/if}</span>
              </button>
              <button class="delete-btn" on:click={() => remove(field)} title="Remove field" aria-label="Remove field {field.name}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICON.trash}</svg></button>
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  </div>

  <div class="add-form">
    <input class="name-input" bind:value={newName} placeholder="Field name" enterkeyhint="done" on:keydown={(e) => e.key === 'Enter' && add()} />
    <div class="type-select">
      <CustomSelect options={typeOptions} value={newType} placement="up" on:change={(e) => newType = e.detail as CustomFieldDef['type']} />
    </div>
    {#if newType === 'select'}
      <input class="name-input" bind:value={newOptions} placeholder="Options, comma-separated" />
    {/if}
    <button class="add-btn" on:click={add} disabled={!newName.trim() || (newType === 'select' && !hasOptions(newOptions))}>+ Add field</button>
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

  .cf-sub {
    padding: 0 24px 16px; font-size: var(--fs-s); color: var(--faint);
    flex-shrink: 0; line-height: 1.5;
  }

  .close-btn {
    background: none; border: none; cursor: pointer; font-size: var(--fs-m);
    color: var(--faint); padding: 4px 6px; border-radius: var(--r-s);
    transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .close-btn:hover { background: var(--hover); color: var(--text); }

  .item-list { flex: 1; overflow-y: auto; padding: 12px 24px; }
  /* One white card of rows, like Settings; an inset line between rows. */
  /* One glass panel of lined rows, as in Archived projects. */
  .group { background: var(--glass-solid); border: 1px solid var(--glass-edge); border-radius: var(--r-l); box-shadow: inset 0 1px 0 var(--glass-hi), var(--glass-shadow); padding: 0 8px 0 14px; }
  .group > .row + .row { border-top: 1px solid var(--line); }
  .empty { color: var(--faint); font-size: var(--fs-m); padding: 12px 0; line-height: 1.5; }

  .row {
    display: flex; align-items: center; gap: 10px;
    min-height: 48px; padding: 6px 0;
  }
  .row-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .name { font-size: var(--fs-m); color: var(--text); font-weight: 500; }
  .type { font-size: var(--fs-s); color: var(--faint); }

  .row-edit-trigger {
    background: none; border: none; padding: 2px 4px; margin: -2px -4px; border-radius: var(--r-s);
    text-align: left; cursor: pointer; transition: background var(--dur-hover) var(--ease-hover);
  }
  .row-edit-trigger:hover { background: var(--hover); }

  .row-editing { flex-wrap: wrap; gap: 6px; align-items: center; padding: 10px 0; }
  .row-edit-actions { display: flex; gap: 6px; width: 100%; justify-content: flex-end; }
  .edit-cancel-btn, .edit-save-btn {
    height: 32px; padding: 0 14px; border-radius: 999px; font-size: var(--fs-s); font-weight: 600; cursor: pointer;
    border: 1px solid var(--glass-edge); background: none; color: var(--text);
  }
  .edit-save-btn { background: var(--text); border-color: var(--text); color: var(--bg); }
  .edit-save-btn:disabled { opacity: .5; cursor: not-allowed; }

  .delete-btn {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; background: none; border: none; cursor: pointer;
    color: var(--faint); padding: 0; border-radius: 999px;
    flex-shrink: 0; transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .delete-btn:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); color: color-mix(in srgb, var(--danger) 82%, var(--text)); }

  .add-form {
    display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
    padding: 14px 24px 24px; border-top: 1px solid var(--line); flex-shrink: 0;
  }
  .name-input {
    height: 34px; padding: 0 14px; border: 1px solid var(--glass-edge); border-radius: 999px;
    background: none; color: var(--text); font-size: var(--fs-m); flex: 1; min-width: 90px;
  }
  .type-select { flex: 1; min-width: 90px; }
  .add-form :global(.custom-select .cs-trigger), .row-editing :global(.custom-select .cs-trigger) { background: none; border-color: var(--glass-edge); border-radius: 999px; min-height: 34px; padding: 0 14px; }
  .add-btn {
    height: 34px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--text);
    background: var(--text); color: var(--bg); font-size: var(--fs-s); font-weight: 600; cursor: pointer;
    white-space: nowrap;
  }
  .add-btn:disabled { opacity: .5; cursor: not-allowed; }
</style>
