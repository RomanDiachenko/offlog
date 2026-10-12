// End-to-end encrypted sync against a real NyxDB server: two devices sync
// through it with encryptedFetch, and the server's own copy is read raw to
// prove it holds nothing readable. Needs the NyxDB binary: NYXDB_BIN, or the
// vendored one offlog-desktop/scripts/fetch-nyxdb-win.ps1 builds. Desktop CI
// runs it; elsewhere it skips.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import net from 'node:net';
import { importSyncKey, encryptId, type SyncKeys } from '../src/lib/syncCrypto';
import { encryptedFetch } from '../src/lib/db/encryptedFetch';

const PouchDB = (globalThis as { PouchDB?: PouchDB.Static }).PouchDB!;
const BIN = process.env.NYXDB_BIN || path.resolve(__dirname, '../../offlog-desktop/vendor/nyxdb-win/nyxdb.exe');
// Named explicitly (CI does), a missing binary is a failure, never a skip.
if (process.env.NYXDB_BIN && !fs.existsSync(BIN)) throw new Error('NYXDB_BIN does not exist: ' + BIN);
const USER = 'e2e', PASS = 'e2e-pass-' + process.pid;
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7 % 256)).toString('base64');
const WRONG = Buffer.from(new Uint8Array(32).fill(3)).toString('base64');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(what: string, check: () => Promise<boolean>, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) { try { if (await check()) return; } catch {} if (Date.now() > end) throw new Error('timed out waiting for ' + what); await sleep(150); }
}

describe.skipIf(!fs.existsSync(BIN))('encrypted sync through a real NyxDB', () => {
  let child: ChildProcess, data: string, base: string, keys: SyncKeys;
  const syncs: { cancel(): void }[] = [];
  let rejected = 0;

  beforeAll(async () => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-enc-'));
    const port = await new Promise<number>(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
    base = `http://127.0.0.1:${port}`;
    child = spawn(BIN, [], { env: { ...process.env, NYXDB_ADDR: `127.0.0.1:${port}`, NYXDB_DATA: data, NYXDB_USER: USER, NYXDB_PASSWORD: PASS }, stdio: 'ignore' });
    await until('NyxDB', async () => (await fetch(base + '/')).ok);
    await fetch(base + '/offlog-e', { method: 'PUT', headers: { Authorization: AUTH } });
    keys = await importSyncKey(KEY);
  }, 30000);

  afterAll(async () => {
    for (const s of syncs) s.cancel();
    child?.kill();
    await new Promise(r => (child?.exitCode !== null ? r(null) : child.once('exit', r)));
    fs.rmSync(data, { recursive: true, force: true });
  });

  const remote = (k: SyncKeys, onRejected = (n: number) => { rejected += n; }) => new PouchDB(base + '/offlog-e', {
    adapter: 'http', auth: { username: USER, password: PASS }, fetch: encryptedFetch(base + '/offlog-e', k, onRejected),
  } as PouchDB.Configuration.RemoteDatabaseConfiguration);
  const device = (name: string) => new PouchDB(name + '-' + Date.now(), { adapter: 'memory' });
  const raw = async (p: string) => (await fetch(`${base}/offlog-e/${p}`, { headers: { Authorization: AUTH } })).json();

  it('two devices stay in step, and the server holds nothing readable', async () => {
    const phone = device('phone'), pc = device('pc');
    for (const db of [phone, pc]) syncs.push(db.sync(remote(keys), { live: true, retry: true }));

    const photo = Buffer.from('JPEG-SECRET-BYTES').toString('base64');
    await phone.put({ _id: 'tag:urgent', type: 'tag_color', color: '#e35868' });
    const created = await phone.put({
      _id: 'task:plumber', type: 'task', title: 'Call the plumber', body: 'Kitchen sink leaks', tags: ['urgent'],
      checklist: [{ text: 'Find number', done: false }],
      _attachments: { 'att:1': { content_type: 'image/jpeg', data: photo } },
    });
    await until('the PC to get the task', async () => (await pc.get('task:plumber'))._rev === created.rev);
    const edited = await phone.put({ ...(await phone.get('task:plumber')), title: 'Call the plumber today' });
    await until('the PC to get the edit', async () => (await pc.get('task:plumber'))._rev === edited.rev);
    const fromPc = await pc.put({ ...(await pc.get('task:plumber')), done_note: 'booked' });
    await until('the phone to get the PC edit', async () => (await phone.get('task:plumber'))._rev === fromPc.rev);

    const onPc = await pc.get('task:plumber', { conflicts: true, attachments: true }) as unknown as Record<string, any>;
    expect(onPc.title).toBe('Call the plumber today');
    expect(onPc.tags).toEqual(['urgent']);
    expect(onPc._conflicts ?? []).toEqual([]);
    expect(onPc._attachments['att:1'].content_type).toBe('image/jpeg');
    expect(onPc._attachments['att:1'].data).toBe(photo);
    expect((await pc.get('tag:urgent') as unknown as Record<string, unknown>).color).toBe('#e35868');

    const del = await phone.remove(await phone.get('tag:urgent'));
    await until('the PC to get the delete', async () => { try { await pc.get('tag:urgent'); return false; } catch (e) { return (e as { status?: number }).status === 404; } });
    expect(del.ok).toBe(true);

    const all = JSON.stringify(await raw('_all_docs?include_docs=true'));
    const changes = JSON.stringify(await raw('_changes?include_docs=true&style=all_docs'));
    const attachmentRaw = await (await fetch(`${base}/offlog-e/${encodeURIComponent(await encryptId(keys, 'task:plumber'))}/att%3A1`, { headers: { Authorization: AUTH } })).text();
    for (const leak of ['plumber', 'Kitchen', 'urgent', 'Find number', 'task:', 'tag:', 'image/jpeg', 'booked']) {
      expect(all, `_all_docs shows "${leak}"`).not.toContain(leak);
      expect(changes, `_changes shows "${leak}"`).not.toContain(leak);
    }
    expect(attachmentRaw).not.toContain('JPEG-SECRET');
    expect(rejected).toBe(0);
  }, 60000);

  it('forged documents and an unsealed delete are refused; a wrong key reads nothing', async () => {
    const pc = device('pc2');
    rejected = 0;
    await pc.replicate.from(remote(keys));
    const sid = await encryptId(keys, 'task:plumber');
    const before = await pc.get('task:plumber');
    // Someone with the sync password, but not the key.
    await fetch(`${base}/offlog-e/_bulk_docs`, {
      method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_edits: false, docs: [
        { _id: 'task:planted', _rev: '1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', type: 'task', title: 'Planted' },
        { _id: 'x:forgedforgedforgedforgedforgedforged', _rev: '1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', e: 'AAAA' },
        { _id: sid, _rev: '99-cccccccccccccccccccccccccccccccc', _deleted: true, _revisions: { start: 99, ids: ['cccccccccccccccccccccccccccccccc'] } },
      ] }),
    });
    await pc.replicate.from(remote(keys));
    await expect(pc.get('task:planted')).rejects.toMatchObject({ status: 404 });
    const after = await pc.get('task:plumber', { conflicts: true }) as unknown as Record<string, any>;
    expect(after._rev).toBe(before._rev);
    expect(after._conflicts ?? []).toEqual([]);
    expect(rejected).toBeGreaterThanOrEqual(3);

    let wrong = 0;
    const stranger = device('stranger');
    await stranger.replicate.from(remote(await importSyncKey(WRONG), n => { wrong += n; }));
    expect((await stranger.allDocs()).rows.filter(r => !r.id.startsWith('_design/'))).toEqual([]);
    expect(wrong).toBeGreaterThan(0);
  }, 60000);
});
