import { describe, it, expect, beforeAll, vi } from 'vitest';
import { importSyncKey, encryptId, encryptDoc, decryptDoc, type SyncKeys } from '../src/lib/syncCrypto';
import { encryptedFetch } from '../src/lib/db/encryptedFetch';

// The translator against a scripted server: what leaves is sealed, what comes
// back is opened, and every refused item is reported once.
const DB = 'http://pc:5984/offlog-e';
let k: SyncKeys;
beforeAll(async () => { k = await importSyncKey(btoa(String.fromCharCode(...new Uint8Array(32).fill(5)))); });
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('encryptedFetch', () => {
  it('seals documents on the way out', async () => {
    const inner = vi.fn(async (_u: string, init?: RequestInit) => json(JSON.parse(String(init!.body)).docs.map((d: { _id: string }) => ({ ok: true, id: d._id, rev: '1-a' }))));
    const f = encryptedFetch(DB, k, () => {}, inner);
    const res = await f(DB + '/_bulk_docs', { method: 'POST', body: JSON.stringify({ new_edits: false, docs: [{ _id: 'task:1', _rev: '1-a', title: 'Secret' }] }) });
    const sent = JSON.parse(String(inner.mock.calls[0][1]!.body));
    expect(JSON.stringify(sent)).not.toContain('Secret');
    expect(sent.docs[0]._id).toBe(await encryptId(k, 'task:1'));
    expect(await decryptDoc(k, sent.docs[0])).toEqual({ _id: 'task:1', _rev: '1-a', title: 'Secret' });
    expect((await res.json())[0].id).toBe('task:1');
  });

  it('a change row with a forged id is dropped and reported', async () => {
    const good = await encryptId(k, 'task:1');
    const onRejected = vi.fn();
    const f = encryptedFetch(DB, k, onRejected, async () => json({ results: [{ id: good, seq: 1, changes: [] }, { id: 'task:planted', seq: 2, changes: [] }], last_seq: 2 }));
    const out = await (await f(DB + '/_changes?since=0')).json();
    expect(out.results.map((r: { id: string }) => r.id)).toEqual(['task:1']);
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  it('a fetched document that does not open is dropped and reported', async () => {
    const sid = await encryptId(k, 'task:1');
    const sealed = await encryptDoc(k, { _id: 'task:1', _rev: '2-b', title: 'ok' });
    const onRejected = vi.fn();
    const f = encryptedFetch(DB, k, onRejected, async () => json({ results: [{ id: sid, docs: [{ ok: sealed }, { ok: { _id: sid, _rev: '3-c', _deleted: true } }] }] }));
    const out = await (await f(DB + '/_bulk_get?revs=true', { method: 'POST', body: JSON.stringify({ docs: [{ id: 'task:1', rev: '2-b' }, { id: 'task:1', rev: '3-c' }] }) })).json();
    expect(out.results[0].id).toBe('task:1');
    expect(out.results[0].docs).toEqual([{ ok: { _id: 'task:1', _rev: '2-b', title: 'ok' } }]);
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  it('checkpoints pass through untouched', async () => {
    const inner = vi.fn(async () => json({ _id: '_local/abc', last_seq: 5 }));
    const f = encryptedFetch(DB, k, () => {}, inner);
    await f(DB + '/_local/abc');
    expect(inner).toHaveBeenCalledWith(DB + '/_local/abc', {});
  });
});
