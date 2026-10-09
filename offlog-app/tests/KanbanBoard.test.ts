import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { tick } from 'svelte';
import type { ProjectDoc, TaskDoc } from '../src/lib/types';

// KanbanBoard reaches db.ts/store.ts for every mutation — mocked so this
// stays a component test (menu wiring and the move's arguments), not a
// round-trip through the real database, which db.test.ts already covers.
const updateTask = vi.fn().mockResolvedValue(undefined);
const createTask = vi.fn().mockResolvedValue(undefined);
const unarchiveTask = vi.fn().mockResolvedValue(undefined);
const archiveColumnTasks = vi.fn().mockResolvedValue(['task:1']);
// The real one returns a fractional position between two neighbours; a
// board with no cards in the target column appends, so a constant is
// enough to assert the value is threaded through unchanged.
const computeDropPosition = vi.fn().mockReturnValue(4242);
vi.mock('../src/lib/db', () => ({
  updateTask: (...args: unknown[]) => updateTask(...args),
  computeDropPosition: (...args: unknown[]) => computeDropPosition(...args),
  computeGroupDropPosition: (...args: unknown[]) => computeDropPosition(...args),
  createTask: (...args: unknown[]) => createTask(...args),
  ensureFreshTagColor: vi.fn().mockResolvedValue(undefined),
  addColumn: vi.fn().mockResolvedValue(undefined),
  renameColumn: vi.fn().mockResolvedValue(undefined),
  reorderColumns: vi.fn().mockResolvedValue(undefined),
  removeColumn: vi.fn().mockResolvedValue(undefined),
  archiveColumnTasks: (...args: unknown[]) => archiveColumnTasks(...args),
  archiveTask: vi.fn().mockResolvedValue(undefined),
  unarchiveTask: (...args: unknown[]) => unarchiveTask(...args),
  duplicateTask: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getTaskById: vi.fn().mockResolvedValue(null),
  // both resolve to a Set, not an array — the board calls .has() on them
  getTaskIdsWithRelatedLinks: vi.fn().mockResolvedValue(new Set<string>()),
  getTaskIdsBlocked: vi.fn().mockResolvedValue(new Set<string>()),
  getTagColorOverrides: vi.fn().mockResolvedValue({}),
  subscribe: vi.fn().mockReturnValue({ cancel: vi.fn() }),
  // reached only when a card is opened into CardDetail
  getAllTags: vi.fn().mockResolvedValue([]),
  getCustomFieldDefs: vi.fn().mockResolvedValue([]),
  findTasksByTitleInProject: vi.fn().mockResolvedValue([]),
  findSimilarNotes: vi.fn().mockResolvedValue([]),
  getRelatedTasks: vi.fn().mockResolvedValue([]),
  searchTasksForLinking: vi.fn().mockResolvedValue([]),
  linkRelatedTask: vi.fn().mockResolvedValue(undefined),
  unlinkRelatedTask: vi.fn().mockResolvedValue(undefined),
  getBlockingTasks: vi.fn().mockResolvedValue([]),
  linkBlockedBy: vi.fn().mockResolvedValue(undefined),
  unlinkBlockedBy: vi.fn().mockResolvedValue(undefined),
  isBlockerResolved: vi.fn().mockReturnValue(false),
}));

const reloadTasks = vi.fn().mockResolvedValue(undefined);
const showError = vi.fn();
vi.mock('../src/lib/store', () => ({
  reloadTasks: (...args: unknown[]) => reloadTasks(...args),
  showError: (...args: unknown[]) => showError(...args),
  modalOpen: writable(false),
  projects: writable([]),
}));

vi.mock('../src/lib/notifications', () => ({
  requestPermission: vi.fn(),
  permissionState: writable('default'),
}));

vi.mock('../src/lib/confirm', () => ({
  confirmAction: vi.fn().mockResolvedValue(true),
}));

import KanbanBoard from '../src/lib/desktop/KanbanBoard.svelte';
import { get } from 'svelte/store';
import { undoToasts, runUndo, dismissUndo } from '../src/lib/undoToast';

const COLUMNS = [
  { id: 'col:idea', name: 'Idea' },
  { id: 'col:doing', name: 'In Process' },
  { id: 'col:done', name: 'Completed' },
];

function mkProject(columns = COLUMNS): ProjectDoc {
  return {
    _id: 'project:1', type: 'project', space_id: 'space:unsorted', name: 'Test Project',
    position: 0, columns, default_view: 'kanban',
    updated_at: '2026-01-01T00:00:00.000Z', source: 'PC',
  };
}

function mkTask(): TaskDoc {
  return {
    _id: 'task:1', type: 'task', project_id: 'project:1', space_id: 'space:unsorted',
    column_id: 'col:idea', title: 'Movable task', body: '', priority: 2,
    due_date: null, reminder_at: null, tags: [], position: 100, deleted: false,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', source: 'PC',
  };
}

async function openCardMenu(container: HTMLElement) {
  const trigger = container.querySelector('.card-menu-trigger') as HTMLButtonElement;
  await fireEvent.click(trigger);
  return container.querySelector('.card-menu') as HTMLElement;
}

const itemsIn = (menu: HTMLElement) =>
  [...menu.querySelectorAll('.card-menu-item')].map(b => (b as HTMLElement).textContent!.trim());

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

// The card menu is the only keyboard/touch route to a column change —
// drag-and-drop cannot be driven without a pointer.
describe('KanbanBoard "Move to" status', () => {
  it('offers every status except the one the task is already in', async () => {
    const { container } = render(KanbanBoard, { project: mkProject(), tasks: [mkTask()] });
    const menu = await openCardMenu(container);

    const labels = itemsIn(menu);
    expect(labels).toContain('In Process');
    expect(labels).toContain('Completed');
    expect(labels).not.toContain('Idea'); // the task's current status
  });

  it('moves the task to the chosen status and reloads', async () => {
    const { container } = render(KanbanBoard, { project: mkProject(), tasks: [mkTask()] });
    const menu = await openCardMenu(container);

    const target = [...menu.querySelectorAll('.card-menu-item')]
      .find(b => b.textContent!.trim() === 'Completed') as HTMLButtonElement;
    await fireEvent.click(target);

    expect(updateTask).toHaveBeenCalledWith('task:1', {
      column_id: 'col:done',
      position: 4242,
    });
    expect(reloadTasks).toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it('surfaces an error and does not swallow a failed move', async () => {
    updateTask.mockRejectedValueOnce(new Error('write failed'));
    const { container } = render(KanbanBoard, { project: mkProject(), tasks: [mkTask()] });
    const menu = await openCardMenu(container);

    const target = [...menu.querySelectorAll('.card-menu-item')]
      .find(b => b.textContent!.trim() === 'In Process') as HTMLButtonElement;
    await fireEvent.click(target);

    expect(showError).toHaveBeenCalled();
  });

  it('omits the move section when the project has a single status', async () => {
    const oneCol = mkProject([{ id: 'col:only', name: 'Only' }]);
    // the task has to live in that column: a card whose column_id matches
    // no column renders nowhere, so the board would come up empty
    const task = { ...mkTask(), column_id: 'col:only' };
    const { container } = render(KanbanBoard, { project: oneCol, tasks: [task] });
    const menu = await openCardMenu(container);

    expect(menu.querySelector('.card-menu-label')).toBeNull();
    expect(itemsIn(menu)).toEqual(['Pin', 'Archive', 'Duplicate', 'Delete']);
  });
});

// Submitting either form empty used to close it as if Cancel had been
// clicked -- silently discarding the "+ Add card"/"+ Status" affordance the
// user had just opened. Both now just stay open and do nothing.
//
// Under jsdom, Element.animate() is stubbed with a finish callback that
// never fires (tests/setup.ts), so the quick-add-form/add-col-form's own
// {#if} branch never actually unmounts once its outro starts -- checking
// its continued presence would pass whether or not the fix is really there
// (see docs/motion.md's own note on this). The {:else} branch's button is
// NOT gated on that outro finishing, so checking it reappear is the
// reliable signal instead.
describe('KanbanBoard empty-submit forms', () => {
  // Single column: with the default 3-column project, the other columns'
  // own untouched "+ Add card" buttons stay visible the whole time, making
  // container-wide presence checks pass regardless of this column's state.
  const oneCol = mkProject([{ id: 'col:only', name: 'Only' }]);

  it('does not fall back to the "+ Add card" button when "Add" is clicked with no title typed', async () => {
    const { container, getByPlaceholderText } = render(KanbanBoard, { project: oneCol, tasks: [] });

    await fireEvent.click(container.querySelector('.add-card-btn') as HTMLButtonElement);
    expect(getByPlaceholderText('Task title…')).toBeTruthy();

    const addBtn = [...container.querySelectorAll('.quick-add-actions .add-btn')][0] as HTMLButtonElement;
    await fireEvent.click(addBtn);

    expect(container.querySelector('.add-card-btn')).toBeNull();
  });

  it('does not fall back to the "+ Status" button when "Add" is clicked with no status name typed', async () => {
    const { container, getByPlaceholderText } = render(KanbanBoard, { project: oneCol, tasks: [] });

    await fireEvent.click(container.querySelector('.add-col-btn') as HTMLButtonElement);
    expect(getByPlaceholderText('Status name…')).toBeTruthy();

    await fireEvent.click(container.querySelector('.add-col-form .add-btn') as HTMLButtonElement);

    expect(container.querySelector('.add-col-btn')).toBeNull();
  });
});

describe('KanbanBoard due badge', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-03-11T10:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  const badge = (container: HTMLElement) => container.querySelector('.due-badge') as HTMLElement;
  const withDue = (column_id: string, due_date: string): TaskDoc => ({ ...mkTask(), column_id, due_date });

  it('flags an open task past its date as overdue', () => {
    const { container } = render(KanbanBoard, { project: mkProject(), tasks: [withDue('col:idea', '2026-03-09')] });

    expect(badge(container).classList.contains('overdue')).toBe(true);
    expect(badge(container).textContent!.trim()).toBe('Overdue · 9 Mar');
  });

  // A finished task has no deadline left. Flagging it red was a false
  // alarm on every completed card whose date had passed.
  it('never flags a task in the last status, however old its date', () => {
    const { container } = render(KanbanBoard, { project: mkProject(), tasks: [withDue('col:done', '2026-03-09')] });

    expect(badge(container).classList.contains('overdue')).toBe(false);
    expect(badge(container).classList.contains('soon')).toBe(false);
    expect(badge(container).textContent!.trim()).toBe('9 Mar');
  });

  // Same wording as List view, not the raw stored "2026-03-11".
  it('shows a readable date, not the stored ISO string', () => {
    const { container } = render(KanbanBoard, { project: mkProject(), tasks: [withDue('col:idea', '2026-03-11')] });

    expect(badge(container).textContent!.trim()).toBe('Today');
  });

  // The board can stay mounted across midnight with no write to re-render it.
  it('relabels at local midnight without any task change', async () => {
    vi.setSystemTime(new Date('2026-03-11T23:59:00'));
    const { container } = render(KanbanBoard, { project: mkProject(), tasks: [withDue('col:idea', '2026-03-12')] });
    expect(badge(container).textContent!.trim()).toBe('Tomorrow');

    await vi.advanceTimersByTimeAsync(61_000);
    await tick();
    expect(badge(container).textContent!.trim()).toBe('Today');
    expect(badge(container).classList.contains('soon')).toBe(true);

    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    await tick();
    expect(badge(container).textContent!.trim()).toBe('Overdue · 12 Mar');
    expect(badge(container).classList.contains('overdue')).toBe(true);
  });
});

describe('KanbanBoard per-status Add task', () => {
  it('reads date, priority and tag words like Quick Add', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-11T10:00:00'));
    try {
      const r = render(KanbanBoard, { project: mkProject(), tasks: [] });
      await fireEvent.click(r.getAllByText('+ Add task')[0]);
      await fireEvent.input(r.getByPlaceholderText('Task title…'), { target: { value: 'Call Bob tomorrow #work !high' } });
      await fireEvent.click(r.getByText('Add'));
      expect(createTask).toHaveBeenCalledWith('project:1', 'space:unsorted', 'col:idea', 'Call Bob', expect.objectContaining({
        due_date: '2026-03-12', priority: 3, tags: ['work'],
      }));
    } finally { vi.useRealTimers(); }
  });

  it('is not offered on the done status', () => {
    const r = render(KanbanBoard, { project: mkProject(), tasks: [] });
    expect(r.getAllByText('+ Add task')).toHaveLength(COLUMNS.length - 1);
  });
});

describe('KanbanBoard archive Undo', () => {
  afterEach(() => { for (const t of get(undoToasts)) dismissUndo(t.key); });

  it('archiving a card offers Undo, which restores it', async () => {
    const { container } = render(KanbanBoard, { project: mkProject(), tasks: [mkTask()] });
    const menu = await openCardMenu(container);
    const archive = [...menu.querySelectorAll('.card-menu-item')].find(b => b.textContent!.trim() === 'Archive') as HTMLButtonElement;
    await fireEvent.click(archive);
    await vi.waitFor(() => expect(get(undoToasts).map(t => t.msg)).toEqual(['Archived "Movable task"']));
    await runUndo(get(undoToasts)[0].key);
    expect(unarchiveTask).toHaveBeenCalledWith('task:1');
  });

  it('Archive all offers Undo for exactly the tasks it archived', async () => {
    archiveColumnTasks.mockResolvedValueOnce(['task:1', 'task:9']);
    const { getByLabelText } = render(KanbanBoard, { project: mkProject(), tasks: [mkTask()] });
    await fireEvent.click(getByLabelText('Archive all tasks in Idea'));
    await vi.waitFor(() => expect(get(undoToasts).map(t => t.msg)).toEqual(['Archived 2 tasks from "Idea"']));
    await runUndo(get(undoToasts)[0].key);
    expect(unarchiveTask.mock.calls.map(c => c[0]).sort()).toEqual(['task:1', 'task:9']);
  });
});
