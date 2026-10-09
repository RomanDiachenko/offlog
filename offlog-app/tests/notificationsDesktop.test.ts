import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

// The Windows reminder path, against the real in-memory database with the
// Tauri bridge faked: config's isTauri() is forced on and invokeTauri is a mock.
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../src/config', async (orig) => ({
  ...(await orig<typeof import('../src/config')>()),
  isTauri: () => true,
  invokeTauri: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

import db, { createProject, createTask, updateTask, getTaskById, invalidateTaskCache } from '../src/lib/db';
import { rescheduleAll, permissionState } from '../src/lib/notifications';
import type { SpaceDoc } from '../src/lib/types';

beforeEach(async () => {
  localStorage.clear();
  invoke.mockReset();
  const all = await db.allDocs({ include_docs: true });
  const dels = all.rows.map(r => ({ ...(r.doc as any), _deleted: true }));
  if (dels.length) await db.bulkDocs(dels);
  invalidateTaskCache();
  const space: SpaceDoc = { _id: 'space:unsorted', type: 'space', name: 'Unsorted', color: '#6B7280', position: 0, updated_at: new Date().toISOString(), source: 'pc' };
  await db.put(space);
});

// A reminder ten minutes in the past: the catch-up path fires it at once.
async function dueReminder(title: string) {
  const project = await createProject('space:unsorted', 'P');
  const task = await createTask(project._id, 'space:unsorted', project.columns[0].id, title);
  const at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await updateTask(task._id!, { reminder_at: at, due_date: '2026-10-07' });
  return { id: task._id!, at };
}

const sends = () => invoke.mock.calls.filter(c => c[0] === 'send_task_notification');

describe('desktop reminders', () => {
  it('fires a toast with the app-style date and then clears the reminder', async () => {
    invoke.mockImplementation(async (cmd: string) => cmd === 'check_desktop_notification_setting' ? true : undefined);
    const { id } = await dueReminder('Call plumber');
    await rescheduleAll();
    await vi.waitFor(async () => expect((await getTaskById(id))!.reminder_at).toBeFalsy());
    expect(sends()).toHaveLength(1);
    expect(sends()[0][1]).toMatchObject({ title: 'Call plumber', taskId: id });
    expect(sends()[0][1].body).toMatch(/^Due Wed 7 Oct( \d{4})?$/);
  });

  it('keeps the reminder when Windows has Offlog notifications switched off', async () => {
    invoke.mockImplementation(async (cmd: string) => cmd === 'check_desktop_notification_setting' ? false : undefined);
    const { id, at } = await dueReminder('Blocked');
    await rescheduleAll();
    await vi.waitFor(() => expect(get(permissionState)).toBe('denied'));
    expect(sends()).toHaveLength(0);
    expect((await getTaskById(id))!.reminder_at).toBe(at);
  });

  it('keeps the reminder when the toast could not be sent', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'check_desktop_notification_setting') return true;
      if (cmd === 'send_task_notification') throw new Error('toast failed');
    });
    const { id, at } = await dueReminder('Send fails');
    await rescheduleAll();
    await vi.waitFor(() => expect(sends()).toHaveLength(1));
    await new Promise(r => setTimeout(r, 50));
    expect((await getTaskById(id))!.reminder_at).toBe(at);
  });

  it('two re-arm passes during the settings check send one toast', async () => {
    invoke.mockImplementation((cmd: string) => cmd === 'check_desktop_notification_setting'
      ? new Promise(r => setTimeout(() => r(true), 30)) : Promise.resolve());
    await dueReminder('Once');
    await rescheduleAll();
    await rescheduleAll();
    await new Promise(r => setTimeout(r, 120));
    expect(sends()).toHaveLength(1);
  });

  it('fires once notifications are switched back on', async () => {
    let allowed = false;
    invoke.mockImplementation(async (cmd: string) => cmd === 'check_desktop_notification_setting' ? allowed : undefined);
    await dueReminder('Later');
    await rescheduleAll();
    await vi.waitFor(() => expect(get(permissionState)).toBe('denied'));
    allowed = true;
    await rescheduleAll();
    await vi.waitFor(() => expect(sends()).toHaveLength(1));
  });
});
