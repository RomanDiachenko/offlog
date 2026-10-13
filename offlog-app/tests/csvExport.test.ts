import { beforeEach, describe, expect, it } from 'vitest';
import db, { createProject, createTask, updateTask, archiveProject, exportTasksCSV, invalidateTaskCache } from '../src/lib/db';
import type { SpaceDoc } from '../src/lib/types';

beforeEach(async () => {
  const all = await db.allDocs({ include_docs: true });
  const dels = all.rows.map(r => ({ ...(r.doc as object), _deleted: true }));
  if (dels.length) await db.bulkDocs(dels);
  invalidateTaskCache();
  const space: SpaceDoc = { _id: 'space:home', type: 'space', name: 'Home', color: '#6B7280', position: 0, updated_at: '', source: 'pc' };
  await db.put(space);
});

const rows = (csv: string) => csv.replace(/^﻿/, '').split('\r\n');

describe('exportTasksCSV', () => {
  it('starts with a BOM so Excel reads UTF-8', async () => {
    expect((await exportTasksCSV()).charCodeAt(0)).toBe(0xFEFF);
  });

  it('keeps a formula-looking title as plain text', async () => {
    const p = await createProject('space:home', 'P');
    await createTask(p._id, 'space:home', p.columns[0].id, '=HYPERLINK("http://x","y")');
    await createTask(p._id, 'space:home', p.columns[0].id, '-5 kg');
    const csv = rows(await exportTasksCSV());
    expect(csv.some(r => r.startsWith(`"'=HYPERLINK(""http://x"",""y"")"`))).toBe(true);
    expect(csv.some(r => r.startsWith(`"'-5 kg"`))).toBe(true);
  });

  it('names the space, project and status of a task in an archived project, with its notes and reminder', async () => {
    const p = await createProject('space:home', 'Old');
    const t = await createTask(p._id, 'space:home', p.columns[0].id, 'Kept');
    await updateTask(t._id!, { body: 'some notes', reminder_at: '2030-01-01T09:00:00.000Z' });
    await archiveProject(p._id);
    const [header, row] = rows(await exportTasksCSV());
    expect(header).toBe('"Title","Space","Project","Status","Priority","Due Date","Reminder","Tags","Notes","Created","Updated"');
    expect(row).toContain(`"Kept","Home","Old","${p.columns[0].name}"`);
    expect(row).toContain('"2030-01-01T09:00:00.000Z"');
    expect(row).toContain('"some notes"');
  });
});
