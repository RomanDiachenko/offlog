import { fmtDay, fmtTime, dayOf } from '../utils';

// How the Resolve conflicts screen shows a field's value, on both shells.
// Values come from arbitrary doc types, so structured ones get a shape a
// person can read: raw JSON showed a status rename as 200 characters of
// column ids with the one changed word buried inside.
// `fieldNames` maps custom-field ids to names; values are keyed by id.
// `statusNames` maps status (column) ids to names, from statusNamesOf().
export function fmtConflictValue(field: string, v: unknown, fieldNames: Record<string, string>, statusNames: Record<string, string> = {}): string {
  if (v === undefined || v === null || v === '') return '—';

  if (field === 'due_date' && typeof v === 'string') return fmtDay(dayOf(v), { weekday: true });
  // Stored in UTC; shown on the local calendar and clock, like everywhere else.
  if (field === 'reminder_at' && typeof v === 'string' && !isNaN(Date.parse(v))) {
    const d = new Date(v);
    return `${fmtDay(d, { weekday: true })} ${fmtTime(d)}`;
  }
  if (field === 'column_id' && typeof v === 'string') return statusNames[v] ?? 'a removed status';
  if (field === 'saved_filters' && Array.isArray(v)) {
    return v.map(f => (f as { name?: string })?.name ?? '?').join(', ') || '—';
  }
  if (field === 'columns' && Array.isArray(v)) {
    return v.map(c => (c as { name?: string })?.name ?? '?').join(' → ') || '—';
  }
  if (field === 'checklist' && Array.isArray(v)) {
    if (!v.length) return '—';
    const done = v.filter(i => (i as { done?: boolean })?.done).length;
    const texts = v.map(i => (i as { text?: string })?.text ?? '').filter(Boolean);
    return `${v.length} item${v.length === 1 ? '' : 's'}, ${done} done — ${texts.join(', ')}`;
  }
  if (field === 'custom_values' && typeof v === 'object') {
    const pairs = Object.entries(v as Record<string, unknown>)
      .map(([id, val]) => `${fieldNames[id] ?? 'deleted field'}: ${val ?? '—'}`);
    return pairs.length ? pairs.join(', ') : '—';
  }
  // Task ids mean nothing to a reader, and resolving every one of them for
  // a screen this rare is not worth the round-trips -- the count is the
  // part that differs in practice.
  if ((field === 'related' || field === 'blocked_by') && Array.isArray(v)) {
    return v.length ? `${v.length} task${v.length === 1 ? '' : 's'}` : '—';
  }

  if (Array.isArray(v)) return v.length ? v.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  const str = String(v);
  return str.length > 120 ? str.slice(0, 120) + '…' : str;
}

export const statusNamesOf = (projects: { columns?: { id: string; name: string }[] }[]): Record<string, string> =>
  Object.fromEntries(projects.flatMap(p => (p.columns ?? []).map(c => [c.id, c.name])));

const CONFLICT_FIELD_LABELS: Record<string, string> = {
  title: 'Title', name: 'Name', body: 'Notes', priority: 'Priority',
  due_date: 'Due date', reminder_at: 'Reminder', tags: 'Tags',
  column_id: 'Status', checklist: 'Checklist', custom_values: 'Fields',
  related: 'Related', blocked_by: 'Blocked by', pinned: 'Pinned',
  archived: 'Archived', deleted: 'In Recycle bin', position: 'Order',
  columns: 'Statuses', saved_filters: 'Saved filters', color: 'Color', icon: 'Icon', default_view: 'Default view',
};
export const conflictFieldLabel = (f: string) => CONFLICT_FIELD_LABELS[f] ?? f;
