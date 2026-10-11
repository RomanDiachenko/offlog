import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { removePhantomConflicts } from '../src/lib/db';

// NyxDB before v0.1.7 never sent a doc's revision history, so a pulling
// device stored each incoming edit as a new root beside its copy: one
// "conflict" per edit, every leaf an older step of the same doc. The server
// itself kept the true tree. These run against real PouchDB databases: one
// stands in for the server, the other for a device holding the phantoms.
const PouchDB = (globalThis as { PouchDB?: PouchDB.Static }).PouchDB!;

let n = 0;
let server: PouchDB.Database, device: PouchDB.Database;
beforeEach(() => {
  server = new PouchDB(`server-${n}`, { adapter: 'memory' });
  device = new PouchDB(`device-${n++}`, { adapter: 'memory' });
});
afterEach(async () => { await server.destroy(); await device.destroy(); });

type Doc = { _id: string; _rev: string; title: string };

// Three edits on the server, then planted on the device the way the bug
// stored them: each revision alone, with no history linking it to the last.
async function phantomTask(id = 'task:a') {
  const revs: string[] = [];
  let r = await server.put({ _id: id, title: 'v1' });
  revs.push(r.rev);
  for (const title of ['v2', 'v3']) {
    r = await server.put({ ...(await server.get<Doc>(id)), title });
    revs.push(r.rev);
  }
  for (const [i, rev] of revs.entries()) {
    await device.bulkDocs([{ _id: id, _rev: rev, title: `v${i + 1}` }] as never, { new_edits: false });
  }
  return revs;
}
const conflictsOn = async (id: string) => (await device.get(id, { conflicts: true }))._conflicts ?? [];

describe('removePhantomConflicts', () => {
  it('removes losing versions the server shows are older steps of the winner', async () => {
    const revs = await phantomTask();
    expect(await conflictsOn('task:a')).toHaveLength(2);
    expect(await removePhantomConflicts(device, server)).toBe(true);
    expect(await conflictsOn('task:a')).toEqual([]);
    const shown = await device.get<Doc>('task:a');
    expect(shown._rev).toBe(revs[2]);
    expect(shown.title).toBe('v3');
  });

  it('keeps a genuine conflict: two edits made apart from each other', async () => {
    const r1 = await server.put({ _id: 'task:b', title: 'base' });
    const [, hash1] = r1.rev.split('-');
    await server.put({ _id: 'task:b', _rev: r1.rev, title: 'edited on the phone' });
    await server.bulkDocs([{ _id: 'task:b', _rev: '2-ffffffffffffffffffffffffffffffff', _revisions: { start: 2, ids: ['ffffffffffffffffffffffffffffffff', hash1] }, title: 'edited on the PC' }] as never, { new_edits: false });
    await device.replicate.from(server);
    expect(await conflictsOn('task:b')).toHaveLength(1);
    expect(await removePhantomConflicts(device, server)).toBe(true);
    expect(await conflictsOn('task:b')).toHaveLength(1);
  });

  it('removes nothing and is not done while the server cannot answer', async () => {
    await phantomTask();
    const offline = { get: () => Promise.reject(new Error('Failed to fetch')) } as unknown as PouchDB.Database;
    expect(await removePhantomConflicts(device, offline)).toBe(false);
    expect(await conflictsOn('task:a')).toHaveLength(2);
  });

  it('removes nothing and is not done when the server returns no history (NyxDB before v0.1.7)', async () => {
    await phantomTask();
    const noHistory = { get: (id: string, o: { rev: string }) => server.get(id, { rev: o.rev }) } as unknown as PouchDB.Database;
    expect(await removePhantomConflicts(device, noHistory)).toBe(false);
    expect(await conflictsOn('task:a')).toHaveLength(2);
  });

  it('waits when this device shows a version the server has not received yet', async () => {
    await phantomTask();
    await device.put({ ...(await device.get<Doc>('task:a')), title: 'not synced yet' });
    expect(await removePhantomConflicts(device, server)).toBe(false);
    expect(await conflictsOn('task:a')).toHaveLength(2);
  });

  it('a second run changes nothing', async () => {
    await phantomTask();
    await removePhantomConflicts(device, server);
    const before = await device.get('task:a', { revs_info: true });
    expect(await removePhantomConflicts(device, server)).toBe(true);
    expect(await device.get('task:a', { revs_info: true })).toEqual(before);
  });
});
