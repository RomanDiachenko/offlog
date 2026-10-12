import { describe, expect, it, beforeEach } from 'vitest';
import db, { retirePlainServer } from '../src/lib/db';

// After the update, a desktop's readable sync database is pulled from once
// and then deleted, so no task stays on the server in the clear. A memory
// database stands in for the old server.
const PouchDB = (globalThis as { PouchDB?: PouchDB.Static }).PouchDB!;
let n = 0;
let name: string;
beforeEach(() => { localStorage.clear(); name = `plain-${n++}`; });

describe('retirePlainServer', () => {
  it('pulls what only the old readable database held, then deletes it', async () => {
    await new PouchDB(name).put({ _id: 'task:only-on-server', type: 'task', title: 'Kept' });
    localStorage.setItem('offlog_sync_key', 'a2V5');
    localStorage.setItem('offlog_plain_server_to_retire', name);
    await retirePlainServer();
    expect((await db.get<{ title: string }>('task:only-on-server')).title).toBe('Kept');
    expect((await new PouchDB(name).info()).doc_count).toBe(0);
    expect(localStorage.getItem('offlog_plain_server_to_retire')).toBeNull();
  });

  it('does nothing without a sync key', async () => {
    await new PouchDB(name).put({ _id: 'task:stays', type: 'task', title: 'x' });
    localStorage.setItem('offlog_plain_server_to_retire', name);
    await retirePlainServer();
    expect((await new PouchDB(name).info()).doc_count).toBe(1);
    expect(localStorage.getItem('offlog_plain_server_to_retire')).toBe(name);
  });
});
