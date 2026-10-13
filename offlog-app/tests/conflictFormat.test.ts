import { describe, expect, it } from 'vitest';
import { fmtConflictValue, conflictFieldLabel, statusNamesOf } from '../src/lib/shared/conflictFormat';

describe('fmtConflictValue', () => {
  it('shows a due date as a day, not as the stored string', () => {
    expect(fmtConflictValue('due_date', '2030-10-09', {})).toBe('Wed 9 Oct 2030');
  });

  it('shows a reminder on the local calendar and clock', () => {
    const at = new Date(2030, 9, 9, 7, 0);
    const out = fmtConflictValue('reminder_at', at.toISOString(), {});
    expect(out).toMatch(/^Wed 9 Oct 2030 /);
    expect(out).not.toContain('T');
  });

  it('names custom fields and statuses', () => {
    expect(fmtConflictValue('custom_values', { 'field:a': 3 }, { 'field:a': 'Budget' })).toBe('Budget: 3');
    expect(fmtConflictValue('columns', [{ name: 'To do' }, { name: 'Done' }], {})).toBe('To do → Done');
    const names = statusNamesOf([{ columns: [{ id: 'col:a', name: 'Idea' }] }]);
    expect(fmtConflictValue('column_id', 'col:a', {}, names)).toBe('Idea');
    expect(fmtConflictValue('column_id', 'col:gone', {}, names)).toBe('a removed status');
  });

  it('uses the shared vocabulary for labels', () => {
    expect(conflictFieldLabel('deleted')).toBe('In Recycle bin');
    expect(conflictFieldLabel('column_id')).toBe('Status');
  });
});
