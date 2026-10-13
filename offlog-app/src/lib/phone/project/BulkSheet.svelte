<script lang="ts">
  // Change status, priority or a tag on every selected task, or archive or
  // delete them all. Mount behind a {#key} bumped per open (Sheet rule).
  import { createEventDispatcher, onMount } from 'svelte';
  import type { ProjectDoc, TaskDoc } from '../../types';
  import { updateTask, getAllTags, archiveTask, unarchiveTask, undoDelete } from '../../db';
  import { reloadTasks, showError } from '../../store';
  import { PRIORITY_LABEL } from '../../constants';
  import { showToast } from '../nav';
  import { restore } from './actions';
  import Sheet from '../Sheet.svelte';

  export let kind: 'status' | 'prio' | 'tag' | 'more';
  export let project: ProjectDoc;
  export let tasks: TaskDoc[];

  // `done.clear`: status and priority end the selection, as on the desktop;
  // adding a tag keeps it for another change.
  const dispatch = createEventDispatcher<{ close: void; done: { clear: boolean } }>();
  let sheet: Sheet;
  let tags: string[] = [];
  let newTag = '';
  let busy = false;
  onMount(async () => {
    if (kind !== 'tag') return;
    try { tags = await getAllTags(); } catch { showError('Could not load tags. Please try again.'); }
  });

  const PRIOS: (1 | 2 | 3)[] = [3, 2, 1];
  const n = tasks.length;
  const noun = `${n} ${n === 1 ? 'task' : 'tasks'}`;
  const title = kind === 'status' ? `Move ${n} to` : kind === 'prio' ? `Priority for ${n}` : kind === 'tag' ? `Add a tag to ${n}` : noun;

  async function apply(changes: (t: TaskDoc) => Partial<TaskDoc> | null, undo: (t: TaskDoc) => Partial<TaskDoc>, clear: boolean) {
    if (busy) return;
    busy = true;
    const done: [string, Partial<TaskDoc>][] = [];
    try {
      for (const t of tasks) {
        const c = changes(t);
        if (!c) continue;
        await updateTask(t._id, c);
        done.push([t._id, undo(t)]);
      }
      await reloadTasks();
    } catch {
      showError('Could not update some tasks. Please try again.');
      await reloadTasks().catch(() => {});
      sheet?.close();
      return;
    }
    dispatch('done', { clear });
    sheet?.close();
    showToast(`Updated ${done.length} ${done.length === 1 ? 'task' : 'tasks'}`, () => restore(done));
  }
  // One Undo for the whole batch. Deletes go through updateTask, not
  // deleteTask: that one offers its own Undo per task.
  async function whole(each: (id: string) => Promise<unknown>, back: (id: string) => Promise<unknown>, verb: string, fail: string) {
    if (busy) return;
    busy = true;
    const done: string[] = [];
    try {
      for (const t of tasks) { await each(t._id); done.push(t._id); }
      await reloadTasks();
    } catch {
      showError(fail);
      await reloadTasks().catch(() => {});
      sheet?.close();
      return;
    }
    dispatch('done', { clear: true });
    sheet?.close();
    showToast(`${verb} ${done.length} ${done.length === 1 ? 'task' : 'tasks'}`, async () => {
      try { for (const id of done) await back(id); await reloadTasks(); }
      catch { showError('Could not undo. Please try again.'); }
    });
  }
  const archiveAll = () => whole(archiveTask, unarchiveTask, 'Archived', 'Could not archive some tasks. Please try again.');
  const deleteAll = () => whole(id => updateTask(id, { deleted: true }), undoDelete, 'Deleted', 'Could not delete some tasks. Please try again.');
  const toStatus = (id: string) => apply(() => ({ column_id: id }), t => ({ column_id: t.column_id, due_date: t.due_date, reminder_at: t.reminder_at, checklist: t.checklist }), true);
  const toPrio = (p: 1 | 2 | 3) => apply(() => ({ priority: p }), t => ({ priority: t.priority }), true);
  // Free text, normalised the way the desktop's bulk tag field does.
  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
    if (!tag) return;
    apply(t => (t.tags.includes(tag) ? null : { tags: [...t.tags, tag] }), t => ({ tags: t.tags }), false);
  }
</script>

<Sheet bind:this={sheet} {title} on:close={() => dispatch('close')}>
  {#if kind === 'status'}
    <div class="p-group">{#each project.columns as c (c.id)}<button class="p-row" on:click={() => toStatus(c.id)}>{c.name}</button>{/each}</div>
  {:else if kind === 'prio'}
    <div class="p-group">{#each PRIOS as p}<button class="p-row" on:click={() => toPrio(p)}>{PRIORITY_LABEL[p]}</button>{/each}</div>
  {:else if kind === 'more'}
    <div class="p-group">
      <button class="p-row" on:click={archiveAll}>Archive</button>
      <button class="p-row danger" on:click={deleteAll}>Delete</button>
    </div>
  {:else}
    <input class="p-fld" bind:value={newTag} placeholder="New tag, then Enter" aria-label="New tag" enterkeyhint="done" on:keydown={e => e.key === 'Enter' && addTag(newTag)} />
    {#if tags.length}
      <div class="p-group">{#each tags as g}<button class="p-row" on:click={() => addTag(g)}>#{g}</button>{/each}</div>
    {/if}
  {/if}
</Sheet>
