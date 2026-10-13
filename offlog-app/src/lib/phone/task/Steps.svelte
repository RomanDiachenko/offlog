<script lang="ts">
  // A task's checklist, flat. The circle ticks a step; its text opens it for
  // editing; holding the text and dragging moves it (Alt+↑/↓ from a keyboard).
  import { createEventDispatcher, tick } from 'svelte';
  import { findDuplicateChecklistItems } from '../../utils';
  import { hapticToggle, hapticDragStart, hapticDragDrop } from '../../haptics';
  import { I } from '../icons';

  type Step = { text: string; done: boolean };
  export let items: Step[];

  const dispatch = createEventDispatcher<{ change: Step[] }>();
  let draft = '';

  $: doneCount = items.filter(s => s.done).length;
  $: dupes = findDuplicateChecklistItems(items);

  function toggle(i: number) {
    hapticToggle();
    dispatch('change', items.map((s, j) => (j === i ? { ...s, done: !s.done } : s)));
  }
  function remove(i: number) { dispatch('change', items.filter((_, j) => j !== i)); }
  function add() {
    const text = draft.trim();
    draft = '';
    if (text) dispatch('change', [...items, { text, done: false }]);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  }

  // ── Edit in place ──
  let editing: number | null = null, editText = '', editInput: HTMLInputElement | undefined;
  async function startEdit(i: number) {
    editing = i; editText = items[i].text;
    await tick();
    editInput?.focus();
  }
  // An emptied step keeps its old text; the × removes a step.
  function commitEdit() {
    if (editing === null) return;
    const i = editing, text = editText.trim();
    editing = null;
    if (text && text !== items[i]?.text) dispatch('change', items.map((s, j) => (j === i ? { ...s, text } : s)));
  }
  function onEditKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = null; }
  }

  // ── Reorder ──
  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || to === from) return;
    const next = [...items];
    next.splice(to, 0, ...next.splice(from, 1));
    dispatch('change', next);
  }
  function onLabelKey(e: KeyboardEvent, i: number) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    move(i, i + (e.key === 'ArrowUp' ? -1 : 1));
  }

  // A hold starts a drag only if the finger stayed put; moving first is a
  // scroll. While dragging, the page must not scroll (touchmove below).
  const HOLD_MS = 400, SLOP = 8;
  let rows: HTMLElement[] = [];
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let start = { x: 0, y: 0 }, dragging: number | null = null, target: number | null = null, dragged = false;
  function onDown(e: PointerEvent, i: number) {
    dragged = false;
    start = { x: e.clientX, y: e.clientY };
    const el = e.currentTarget as HTMLElement, id = e.pointerId;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (items.length < 2) return;
      dragging = i; target = i; dragged = true;
      try { el.setPointerCapture(id); } catch { /* the pointer already left */ }
      hapticDragStart();
    }, HOLD_MS);
  }
  function onMove(e: PointerEvent) {
    if (dragging === null) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) clearTimeout(holdTimer);
      return;
    }
    const y = e.clientY;
    let t = rows.findIndex(r => r && y < r.getBoundingClientRect().top + r.offsetHeight / 2);
    if (t < 0) t = items.length - 1;
    else if (t > dragging) t -= 1;
    target = t;
  }
  function onUp() {
    clearTimeout(holdTimer);
    if (dragging === null) return;
    const from = dragging, to = target ?? from;
    dragging = null; target = null;
    if (to !== from) { hapticDragDrop(); move(from, to); }
  }
  // A finished drag is not also a tap that opens the editor.
  function onLabelClick(i: number) {
    if (dragged) { dragged = false; return; }
    startEdit(i);
  }
</script>

<div class="p-sec" role="heading" aria-level="2">Steps{#if items.length}<span class="p-n">{doneCount} of {items.length}</span>{/if}</div>
<div class="p-group">
  {#each items as s, i}
    <div class="step" class:done={s.done} class:lifted={dragging === i} class:gap-above={target === i && dragging !== null && dragging > i} class:gap-below={target === i && dragging !== null && dragging < i} bind:this={rows[i]}>
      <button class="tog" on:click={() => toggle(i)} aria-pressed={s.done} aria-label="{s.done ? 'Mark not done' : 'Mark done'}: {s.text}">
        <span class="chk" class:on={s.done}></span>
      </button>
      {#if editing === i}
        <input class="edit" bind:this={editInput} bind:value={editText} on:keydown={onEditKey} on:blur={commitEdit} enterkeyhint="done" aria-label="Edit step" />
      {:else}
        <button class="lbl" aria-label="Edit step: {s.text}" title="Tap to edit, hold to move"
          on:click={() => onLabelClick(i)} on:keydown={e => onLabelKey(e, i)}
          on:pointerdown={e => onDown(e, i)} on:pointermove={onMove} on:pointerup={onUp} on:pointercancel={onUp}
          on:touchmove|nonpassive={e => { if (dragging !== null) e.preventDefault(); }}
          on:contextmenu|preventDefault>{s.text}</button>
      {/if}
      <button class="x" on:click={() => remove(i)} aria-label="Remove step: {s.text}">{@html I.x}</button>
    </div>
  {/each}
  <div class="addrow" class:first={!items.length}>
    <span class="plus" aria-hidden="true">{@html I.plus}</span>
    <input class="add" bind:value={draft} on:keydown={onKey} on:blur={add} placeholder="Add a step" enterkeyhint="done" aria-label="Add a step" />
  </div>
</div>
{#if dupes.length}<p class="p-say warn">Repeated step{dupes.length > 1 ? 's' : ''}: {dupes.join(', ')}</p>{/if}

<style>
  .step { display: flex; align-items: center; padding: 0 6px 0 0; transition: box-shadow var(--dur-small) var(--ease-decelerate); }
  .step + .step { background-image: linear-gradient(var(--line), var(--line)); background-size: calc(100% - 50px) 1px; background-position: 50px 0; background-repeat: no-repeat; }
  .tog { transition: background var(--dur-hover) var(--ease-hover); flex-shrink: 0; display: flex; align-items: center; padding: 12px 12px 12px 16px; min-height: 48px; background: none; border: 0; cursor: pointer; }
  .tog:active, .lbl:active { background: var(--col-bg); }
  .lbl { transition: background var(--dur-hover) var(--ease-hover); flex: 1; min-width: 0; min-height: 48px; padding: 12px 0; overflow-wrap: anywhere; font: inherit; font-size: var(--p-fs-l); color: var(--text); background: none; border: 0; text-align: left; cursor: pointer; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .edit { flex: 1; min-width: 0; min-height: 48px; box-sizing: border-box; border: 0; background: none; color: var(--text); outline: none; font: inherit; font-size: var(--p-fs-l); padding: 12px 0; box-shadow: inset 0 -2px 0 var(--accent); }
  .done .lbl { color: var(--faint); text-decoration: line-through; }
  /* The step being moved lifts; a line marks where it will land. */
  .lifted { background: var(--surface); box-shadow: var(--elev-2); border-radius: 12px; position: relative; z-index: 1; }
  .gap-above { box-shadow: inset 0 2px 0 var(--accent); }
  .gap-below { box-shadow: inset 0 -2px 0 var(--accent); }
  .chk { width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0; position: relative; box-sizing: border-box; border: 2px solid var(--check-ring); }
  /* The fill and tick pop in (decelerate) and leave faster (accelerate). */
  .chk { transition: background var(--dur-small-out) var(--ease-accelerate), border-color var(--dur-small-out) var(--ease-accelerate); }
  .chk::after { content: ''; position: absolute; left: 5px; top: 1.5px; width: 4.5px; height: 9px; border: solid var(--on-accent); border-width: 0 2px 2px 0; transform: rotate(45deg) scale(.4); opacity: 0; transition: transform var(--dur-small-out) var(--ease-accelerate), opacity var(--dur-small-out) var(--ease-accelerate); }
  .chk.on { background: var(--accent); border-color: var(--accent); transition: background var(--dur-small) var(--ease-decelerate), border-color var(--dur-small) var(--ease-decelerate); }
  .chk.on::after { transform: rotate(45deg) scale(1); opacity: 1; transition: transform var(--dur-small) var(--ease-decelerate), opacity var(--dur-small) var(--ease-decelerate); }
  .x { transition: background var(--dur-hover) var(--ease-hover); width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--faint); border-radius: 50%; flex-shrink: 0; background: none; border: 0; padding: 0; cursor: pointer; }
  .x :global(svg.i) { width: 16px; height: 16px; }
  .x:active { background: var(--col-bg); }
  /* The + sits where a step's check circle does, so typed text lines up with the step labels. */
  .addrow { position: relative; background-image: linear-gradient(var(--line), var(--line)); background-size: calc(100% - 50px) 1px; background-position: 50px 0; background-repeat: no-repeat; }
  .addrow.first { background-image: none; }
  .plus { position: absolute; left: 16px; top: 50%; width: 20px; height: 20px; margin-top: -10px; display: flex; align-items: center; justify-content: center; color: var(--faint); pointer-events: none; }
  .plus :global(svg.i) { width: 18px; height: 18px; }
  .add { width: 100%; box-sizing: border-box; border: 0; background: none; color: var(--text); outline: none; font: inherit; font-size: var(--p-fs-l); padding: 13px 14px 13px 48px; }
  .add::placeholder { color: var(--faint); }
  .add:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
  .warn { color: var(--overdue-ink); margin-top: -6px; }
</style>
