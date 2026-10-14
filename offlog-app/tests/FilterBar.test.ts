import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { CustomFieldDef, ProjectDoc, SavedFilterDoc, TaskDoc } from '../src/lib/types';

// FilterBar's state is the bound filter props plus the project's saved
// filters, faked over an in-memory map of filter records (name → record),
// which the saved-filter tests read back. No test ever writes the project.
type Rec = { name: string; deleted: boolean; filter: SavedFilterDoc };
const db = vi.hoisted(() => ({ records: new Map<string, Rec>(), fail: false, projectWrites: 0 }));
vi.mock('../src/lib/db', () => ({
  getSavedFilterRecords: vi.fn(async () => [...db.records.values()]),
  putSavedFilterRecord: vi.fn(async (_id: string, filter: SavedFilterDoc, deleted = false) => {
    if (db.fail) throw new Error('write failed');
    db.records.set(filter.name, { name: filter.name, deleted, filter });
  }),
  updateProject: vi.fn(async () => { db.projectWrites++; }),
  subscribe: vi.fn(() => () => {}),
}));
const showError = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/store', () => ({ showError }));
import FilterBar from '../src/lib/desktop/FilterBar.svelte';

const COLUMNS = [
  { id: 'col:todo', name: 'To do' },
  { id: 'col:done', name: 'Done' },
];

function mkProject(id = 'project:1'): ProjectDoc {
  return {
    _id: id, type: 'project', space_id: 'space:unsorted', name: 'Test Project',
    position: 0, columns: COLUMNS, default_view: 'list',
    updated_at: '2026-01-01T00:00:00.000Z', source: 'PC',
  };
}

const FIELDS: CustomFieldDef[] = [
  { id: 'field:aaa', name: 'Client', type: 'text' },
  { id: 'field:bbb', name: 'Effort', type: 'text' },
];

function mkTask(custom: Record<string, string>, id = 'task:1'): TaskDoc {
  return {
    _id: id, type: 'task', project_id: 'project:1', space_id: 'space:unsorted',
    column_id: 'col:todo', title: 'A task', body: '', priority: 1,
    due_date: null, reminder_at: null, tags: [], position: 100, deleted: false,
    custom_values: custom,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    source: 'PC',
  };
}

const SAVED_KEY = 'offlog_saved_filters_project:1';

function mount(props: Record<string, unknown> = {}, project: ProjectDoc = mkProject()) {
  return render(FilterBar, { props: { project, ...props } });
}
function withSaved(saved: SavedFilterDoc[], deleted: string[] = []): ProjectDoc {
  for (const f of saved) db.records.set(f.name, { name: f.name, deleted: false, filter: f });
  for (const n of deleted) db.records.set(n, { name: n, deleted: true, filter: { name: n, search: '', filterCol: '', filterPrio: 0, filterTag: '' } });
  return mkProject();
}
const live = () => [...db.records.values()].filter(r => !r.deleted);
const savedNames = () => live().map(r => r.name);
const saved = (name: string) => db.records.get(name)?.filter;

const countBadge = (c: HTMLElement) => c.querySelector('.filter-count') as HTMLElement | null;
const filterButton = (c: HTMLElement) => c.querySelector('.action-btn') as HTMLButtonElement;

async function openMenu(c: HTMLElement) {
  await fireEvent.click(filterButton(c));
  await waitFor(() => {
    if (!c.querySelector('.filter-menu')) throw new Error('filter menu did not open');
  });
}

// CustomSelect renders a button trigger plus a popover of .cs-option
// buttons, so choosing a value is a two-click interaction.
async function chooseOption(select: Element, label: string) {
  await fireEvent.click(select.querySelector('.cs-trigger') as HTMLButtonElement);
  const option = [...select.querySelectorAll('.cs-option')].find(o => o.textContent?.trim() === label);
  if (!option) throw new Error(`no option "${label}"`);
  await fireEvent.click(option);
}

const selects = (c: HTMLElement) => [...c.querySelectorAll('.filter-menu .custom-select')];

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  db.fail = false;
  db.records.clear();
  db.projectWrites = 0;
});
afterEach(cleanup);

describe('FilterBar menu', () => {
  it('Escape closes it', async () => {
    const { getByLabelText } = mount();
    const btn = getByLabelText('Filters');
    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('FilterBar active-filter count', () => {
  it('shows no badge when nothing is filtered', () => {
    const { container } = mount();
    expect(countBadge(container)).toBeNull();
  });

  it('counts search, status, tag and priority as one each and sums them', async () => {
    const { container } = mount({ search: 'draft', filterCol: 'col:todo', filterTag: 'urgent', filterPrio: 3 });
    await waitFor(() => expect(countBadge(container)?.textContent).toBe('4'));
  });

  // filterPrio 0 is the "All" chip, not a filter — counting it truthily
  // would leave the badge permanently stuck at 1.
  it('does not count priority "All"', async () => {
    const { container } = mount({ filterPrio: 0, search: 'draft' });
    await waitFor(() => expect(countBadge(container)?.textContent).toBe('1'));
  });

  it('counts only custom-field rows that have both a field and a value', async () => {
    const { container } = mount({
      customFields: FIELDS,
      customFieldFilters: [
        { fieldId: 'field:aaa', value: 'Acme' },
        { fieldId: 'field:bbb', value: '' },
        { fieldId: '', value: '' },
      ],
    });
    await waitFor(() => expect(countBadge(container)?.textContent).toBe('1'));
  });
});

describe('FilterBar filter selection', () => {
  it('choosing a status sets filterCol and raises the count', async () => {
    const { container } = mount();
    await openMenu(container);

    await chooseOption(selects(container)[0], 'Done');

    await waitFor(() => expect(countBadge(container)?.textContent).toBe('1'));
  });

  it('a priority chip toggles back off when clicked twice', async () => {
    const { container } = mount();
    await openMenu(container);

    const high = [...container.querySelectorAll('.prio-chip')].find(b => b.textContent?.includes('High')) as HTMLButtonElement;
    await fireEvent.click(high);
    await waitFor(() => expect(countBadge(container)?.textContent).toBe('1'));

    await fireEvent.click(high);
    await waitFor(() => expect(countBadge(container)).toBeNull());
  });

  it('Clear filters resets every dimension at once', async () => {
    const { container } = mount({
      search: 'draft', filterCol: 'col:todo', filterTag: 'urgent', filterPrio: 2,
      allTags: ['urgent'], customFields: FIELDS,
      customFieldFilters: [{ fieldId: 'field:aaa', value: 'Acme' }],
    });
    await openMenu(container);
    expect(countBadge(container)?.textContent).toBe('5');

    await fireEvent.click(container.querySelector('.clear-all') as HTMLButtonElement);

    await waitFor(() => expect(countBadge(container)).toBeNull());
  });

  it('offers no Tag select when the project has no tags', async () => {
    const { container } = mount({ allTags: [] });
    await openMenu(container);
    expect([...container.querySelectorAll('.menu-label')].map(l => l.textContent)).not.toContain('Tag');
  });
});

describe('FilterBar custom-field filter rows', () => {
  it('offers only values actually present on the project\'s tasks', async () => {
    const { container } = mount({
      customFields: FIELDS,
      tasks: [mkTask({ 'field:aaa': 'Acme' }), mkTask({ 'field:aaa': 'Globex' }, 'task:2'), mkTask({ 'field:bbb': 'Large' }, 'task:3')],
      customFieldFilters: [{ fieldId: 'field:aaa', value: '' }],
    });
    await openMenu(container);

    // Row 0 is the field select, row 1 the value select for that field.
    const valueSelect = container.querySelector('.field-filter-selects .custom-select:nth-child(2)') as HTMLElement;
    await fireEvent.click(valueSelect.querySelector('.cs-trigger') as HTMLButtonElement);

    const labels = [...valueSelect.querySelectorAll('.cs-option')].map(o => o.textContent?.trim());
    expect(labels).toEqual(['Any value', 'Acme', 'Globex']);
  });

  it('a field already used in another row is not offered again', async () => {
    const { container } = mount({
      customFields: FIELDS,
      customFieldFilters: [{ fieldId: 'field:aaa', value: 'Acme' }, { fieldId: '', value: '' }],
    });
    await openMenu(container);

    const secondRowField = container.querySelectorAll('.field-filter-row')[1].querySelector('.custom-select') as HTMLElement;
    await fireEvent.click(secondRowField.querySelector('.cs-trigger') as HTMLButtonElement);

    const labels = [...secondRowField.querySelectorAll('.cs-option')].map(o => o.textContent?.trim());
    expect(labels).toEqual(['Choose a field…', 'Effort']);
  });

  it('changing a row\'s field clears the value chosen under the previous one', async () => {
    const { container } = mount({
      customFields: FIELDS,
      tasks: [mkTask({ 'field:aaa': 'Acme' })],
      customFieldFilters: [{ fieldId: 'field:aaa', value: 'Acme' }],
    });
    await openMenu(container);
    expect(countBadge(container)?.textContent).toBe('1');

    const fieldSelect = container.querySelector('.field-filter-selects .custom-select') as HTMLElement;
    await chooseOption(fieldSelect, 'Effort');

    // A value carried over from the old field would still count, and would
    // filter against a field it never belonged to.
    await waitFor(() => expect(countBadge(container)).toBeNull());
  });

  it('adding and removing a row changes the row count', async () => {
    const { container } = mount({ customFields: FIELDS, customFieldFilters: [] });
    await openMenu(container);

    await fireEvent.click(container.querySelector('.add-field-filter-btn') as HTMLButtonElement);
    await waitFor(() => expect(container.querySelectorAll('.field-filter-row')).toHaveLength(1));

    await fireEvent.click(container.querySelector('.field-filter-remove') as HTMLButtonElement);
    await waitFor(() => expect(container.querySelectorAll('.field-filter-row')).toHaveLength(0));
  });

  it('stops offering new rows once every field is filtered', async () => {
    const { container } = mount({
      customFields: FIELDS,
      customFieldFilters: [{ fieldId: 'field:aaa', value: '' }, { fieldId: 'field:bbb', value: '' }],
    });
    await openMenu(container);
    expect(container.querySelector('.add-field-filter-btn')).toBeNull();
  });
});

describe('FilterBar saved filters', () => {
  it('saves the whole current filter set under the typed name, as its own record', async () => {
    const { container } = mount({
      search: 'draft', filterCol: 'col:done', filterTag: 'urgent', filterPrio: 3,
      allTags: ['urgent'], customFields: FIELDS,
      customFieldFilters: [{ fieldId: 'field:aaa', value: 'Acme' }],
    });
    await openMenu(container);

    await fireEvent.input(container.querySelector('.filter-name-input') as HTMLInputElement, { target: { value: '  Hot work  ' } });
    await fireEvent.click(container.querySelector('.filter-save-btn') as HTMLButtonElement);

    await waitFor(() => expect(live().map(r => r.filter)).toEqual([{
      name: 'Hot work', search: 'draft', filterCol: 'col:done', filterPrio: 3, filterTag: 'urgent',
      customFieldFilters: [{ fieldId: 'field:aaa', value: 'Acme' }],
    }]));
    expect(localStorage.getItem(SAVED_KEY)).toBeNull();
    // Never the project doc: a filter save must not collide with another
    // device's status or name edit.
    expect(db.projectWrites).toBe(0);
  });

  it('saving the same name again replaces it rather than duplicating', async () => {
    const { container } = mount({ search: 'new' }, withSaved([{ name: 'Hot work', search: 'old', filterCol: '', filterPrio: 0, filterTag: '' }]));
    await openMenu(container);

    await fireEvent.input(container.querySelector('.filter-name-input') as HTMLInputElement, { target: { value: 'Hot work' } });
    await fireEvent.click(container.querySelector('.filter-save-btn') as HTMLButtonElement);

    await waitFor(() => expect(saved('Hot work')?.search).toBe('new'));
    expect(live()).toHaveLength(1);
  });

  it('a failed save says so', async () => {
    db.fail = true;
    const { container } = mount({ search: 'x' });
    await openMenu(container);
    await fireEvent.input(container.querySelector('.filter-name-input') as HTMLInputElement, { target: { value: 'A' } });
    await fireEvent.click(container.querySelector('.filter-save-btn') as HTMLButtonElement);
    await waitFor(() => expect(showError).toHaveBeenCalledWith('Could not save the filter. Please try again.'));
  });

  it('applying a saved filter restores every dimension', async () => {
    const { container } = mount({ allTags: ['urgent'], customFields: FIELDS }, withSaved([{
      name: 'Hot work', search: 'draft', filterCol: 'col:done', filterPrio: 3, filterTag: 'urgent',
      customFieldFilters: [{ fieldId: 'field:aaa', value: 'Acme' }],
    }]));
    await openMenu(container);

    await fireEvent.click(container.querySelector('.filter-apply-btn') as HTMLButtonElement);

    await waitFor(() => expect(countBadge(container)?.textContent).toBe('5'));
  });

  // Filters saved before custom-field rows existed have no such key; an
  // undefined here would make .filter() on it throw at apply time.
  it('applying a pre-custom-field saved filter yields no custom-field rows', async () => {
    const { container } = mount({ customFields: FIELDS }, withSaved([
      { name: 'Legacy', search: 'draft', filterCol: '', filterPrio: 0, filterTag: '' },
    ]));
    await openMenu(container);

    await fireEvent.click(container.querySelector('.filter-apply-btn') as HTMLButtonElement);

    await waitFor(() => expect(countBadge(container)?.textContent).toBe('1'));
    await openMenu(container);
    expect(container.querySelectorAll('.field-filter-row')).toHaveLength(0);
  });

  it('deleting a saved filter marks it deleted; a failure says so', async () => {
    const { container } = mount({}, withSaved([
      { name: 'Keep', search: 'a', filterCol: '', filterPrio: 0, filterTag: '' },
      { name: 'Drop', search: 'b', filterCol: '', filterPrio: 0, filterTag: '' },
    ]));
    await openMenu(container);

    await fireEvent.click(container.querySelector('[aria-label="Delete filter Drop"]') as HTMLButtonElement);
    await waitFor(() => expect(savedNames()).toEqual(['Keep']));
    expect(db.records.get('Drop')?.deleted).toBe(true);

    db.fail = true;
    await fireEvent.click(container.querySelector('[aria-label="Delete filter Keep"]') as HTMLButtonElement);
    await waitFor(() => expect(showError).toHaveBeenCalledWith('Could not delete the filter. Please try again.'));
  });

  it('filters this device saved before they synced move into records once', async () => {
    localStorage.setItem(SAVED_KEY, JSON.stringify([
      { name: 'Local', search: 'l', filterCol: '', filterPrio: 0, filterTag: '' },
      { name: 'Both', search: 'local copy', filterCol: '', filterPrio: 0, filterTag: '' },
    ]));
    const { container } = mount({}, withSaved([{ name: 'Both', search: 'synced', filterCol: '', filterPrio: 0, filterTag: '' }]));
    await waitFor(() => expect(savedNames()).toEqual(['Both', 'Local']));
    expect(saved('Both')?.search).toBe('synced');
    expect(localStorage.getItem(SAVED_KEY)).toBeNull();
    await openMenu(container);
    expect(container.querySelector('[aria-label="Delete filter Local"]')).not.toBeNull();
  });

  it('a blank name saves nothing', async () => {
    const { container } = mount({ search: 'draft' });
    await openMenu(container);

    await fireEvent.input(container.querySelector('.filter-name-input') as HTMLInputElement, { target: { value: '   ' } });
    await fireEvent.keyDown(container.querySelector('.filter-name-input') as HTMLInputElement, { key: 'Enter' });

    expect(db.records.size).toBe(0);
  });

  // Another device deleted it; this device's copy from before filters
  // synced must not bring it back.
  it('a filter deleted elsewhere stays deleted when this device moves its old copy in', async () => {
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ name: 'Gone', search: 'old', filterCol: '', filterPrio: 0, filterTag: '' }]));
    const { container } = mount({}, withSaved([], ['Gone']));
    await waitFor(() => expect(localStorage.getItem(SAVED_KEY)).toBeNull());
    expect(savedNames()).toEqual([]);
    await openMenu(container);
    expect(container.querySelector('[aria-label="Delete filter Gone"]')).toBeNull();
  });

  // A corrupt leftover from before saved filters synced must not take the
  // whole popover down.
  it('survives a corrupt saved-filters value on this device', async () => {
    localStorage.setItem(SAVED_KEY, 'not json');
    const { container } = mount({}, mkProject());
    await openMenu(container);
    expect(container.querySelector('.filter-empty')).not.toBeNull();
  });
});
