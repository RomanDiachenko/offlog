import { describe, expect, it, beforeAll } from 'vitest';
import { importSyncKey, encryptId, decryptId, encryptDoc, decryptDoc, encryptAttachment, decryptAttachment, encryptedDbName, sealLocal, openLocal, type SyncKeys } from '../src/lib/syncCrypto';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const OTHER = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
let k: SyncKeys, other: SyncKeys;
beforeAll(async () => { k = await importSyncKey(KEY); other = await importSyncKey(OTHER); });

const task = { _id: 'task:abc', _rev: '2-aaa', type: 'task', title: 'Call the plumber', tags: ['urgent'], body: 'Kitchen sink' };

describe('sync ids', () => {
  it('are opaque, deterministic, and turn back into the real id', async () => {
    const a = await encryptId(k, 'tag:urgent');
    expect(a).toBe(await encryptId(k, 'tag:urgent'));
    expect(a).not.toContain('urgent');
    expect(a).not.toBe(await encryptId(k, 'tag:other'));
    expect(await decryptId(k, a)).toBe('tag:urgent');
  });
  it('a forged or foreign id does not decrypt', async () => {
    expect(await decryptId(k, 'task:plain')).toBeNull();
    expect(await decryptId(other, await encryptId(k, 'task:abc'))).toBeNull();
    expect(await decryptId(k, 'x:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
  });
  it('replication checkpoints keep their ids; design docs and x: ids are encrypted like any other', async () => {
    expect(await encryptId(k, '_local/abc')).toBe('_local/abc');
    for (const id of ['_design/idx', 'x:looks-encrypted']) {
      const sid = await encryptId(k, id);
      expect(sid).not.toContain(id);
      expect(await decryptId(k, sid)).toBe(id);
    }
  });
  it('only the exact spelling of a server id opens', async () => {
    const sid = await encryptId(k, 'task:1');
    const last = sid.at(-1)!;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const twin = sid.slice(0, -1) + alphabet[alphabet.indexOf(last) ^ 1];
    expect(await decryptId(k, twin)).toBeNull();
    expect(await decryptId(k, sid + ' ')).toBeNull();
  });
});

describe('the server database', () => {
  it('is named from a one-way hash of the key, the same way sync_host.rs names it', async () => {
    expect(await encryptedDbName('a2V5LWE=')).toBe('offlog-e-e153e859bc5ce847');
    expect(await encryptedDbName('a2V5LWI=')).not.toBe('offlog-e-e153e859bc5ce847');
  });
});

describe('sync attachments', () => {
  it('seal to the same bytes while unchanged, so the server stores them once', async () => {
    const a = await encryptAttachment(k, 'x:a', 'att:1', new Uint8Array([1, 2, 3]), 'image/png');
    expect(await encryptAttachment(k, 'x:a', 'att:1', new Uint8Array([1, 2, 3]), 'image/png')).toEqual(a);
    expect(await encryptAttachment(k, 'x:a', 'att:1', new Uint8Array([1, 2, 4]), 'image/png')).not.toEqual(a);
    expect((await encryptAttachment(k, 'x:a', 'att:1', new Uint8Array([1, 2, 4]), 'image/png')).subarray(0, 12)).not.toEqual(a.subarray(0, 12));
  });

  it('come back with the type they were stored as', async () => {
    const sealed = await encryptAttachment(k, 'x:a', 'att:1', new Uint8Array([1, 2, 3]), 'image/svg+xml');
    expect(await decryptAttachment(k, 'x:a', 'att:1', sealed)).toEqual({ type: 'image/svg+xml', bytes: new Uint8Array([1, 2, 3]) });
    expect(await decryptAttachment(k, 'x:a', 'att:2', sealed)).toBeNull();
  });
});

describe('sync documents', () => {
  it('a server that strips an attachment, or swaps the sealed history, is refused', async () => {
    const withPhoto = await encryptDoc(k, { ...task, _attachments: { 'att:1': { content_type: 'image/png', data: btoa('png') } } });
    const { _attachments, ...stripped } = withPhoto;
    expect(_attachments).toBeDefined();
    expect(await decryptDoc(k, stripped)).toBeNull();
    const sealed = await encryptDoc(k, { ...task, _revisions: { start: 2, ids: ['bbb', 'root'] } });
    expect(await decryptDoc(k, sealed)).toBeNull();
  });
  it('checkpoints open only as sealed, under their own id', async () => {
    const cp = await sealLocal(k, { _id: '_local/r1', _rev: '0-3', last_seq: 'seq-marker-42', session_id: 's' });
    expect(JSON.stringify(cp)).not.toContain('seq-marker');
    expect(await openLocal(k, cp)).toEqual({ _id: '_local/r1', _rev: '0-3', last_seq: 'seq-marker-42', session_id: 's' });
    expect(await openLocal(k, { ...cp, _id: '_local/r2' })).toBeNull();
    expect(await openLocal(k, { _id: '_local/r1', last_seq: '999' })).toBeNull();
  });
  it('carry the history their device sealed, not one the server swaps in', async () => {
    const sealed = await encryptDoc(k, { ...task, _revisions: { start: 2, ids: ['aaa', 'root'] } });
    const forged = { ...sealed, _revisions: { start: 2, ids: ['aaa', 'mine-in-conflict'] } };
    expect((await decryptDoc(k, forged))!._revisions).toEqual({ start: 2, ids: ['aaa', 'root'] });
  });
  it('round-trip, and the server copy holds none of the content', async () => {
    const sealed = await encryptDoc(k, task);
    const json = JSON.stringify(sealed);
    for (const secret of ['plumber', 'urgent', 'Kitchen', 'task:abc', '"title"']) expect(json).not.toContain(secret);
    expect(sealed._rev).toBe('2-aaa');
    expect(await decryptDoc(k, sealed)).toEqual(task);
  });
  it('a different key cannot read it', async () => {
    expect(await decryptDoc(other, await encryptDoc(k, task))).toBeNull();
  });
  it('a changed body, revision, id or deleted flag is rejected', async () => {
    const sealed = await encryptDoc(k, task);
    const flipped = { ...sealed, e: (sealed.e as string).slice(0, -6) + (((sealed.e as string).slice(-6, -5) === 'A') ? 'B' : 'A') + (sealed.e as string).slice(-5) };
    expect(await decryptDoc(k, flipped)).toBeNull();
    expect(await decryptDoc(k, { ...sealed, _rev: '3-replayed' })).toBeNull();
    expect(await decryptDoc(k, { ...sealed, _id: await encryptId(k, 'task:other') })).toBeNull();
    expect(await decryptDoc(k, { ...sealed, _deleted: true })).toBeNull();
  });
  it('a deletion is sealed too: a bare tombstone from the server is rejected', async () => {
    const tomb = await encryptDoc(k, { _id: 'task:abc', _rev: '3-bbb', _deleted: true });
    expect(await decryptDoc(k, tomb)).toEqual({ _id: 'task:abc', _rev: '3-bbb', _deleted: true });
    expect(await decryptDoc(k, { _id: await encryptId(k, 'task:abc'), _rev: '3-ccc', _deleted: true })).toBeNull();
  });
  it('attachments are encrypted and come back with their real type and digest', async () => {
    const data = btoa('fake jpeg bytes');
    const withPhoto = { ...task, _attachments: { 'att:1': { content_type: 'image/jpeg', digest: 'md5-xyz', data } } };
    const sealed = await encryptDoc(k, withPhoto);
    const att = sealed._attachments!['att:1'];
    expect(att.content_type).toBe('application/octet-stream');
    expect(att.data).not.toBe(data);
    expect(JSON.stringify(sealed)).not.toContain('image/jpeg');
    expect((await decryptDoc(k, sealed))!._attachments!['att:1']).toEqual({ content_type: 'image/jpeg', digest: 'md5-xyz', data });
    const stubbed = { ...sealed, _attachments: { 'att:1': { stub: true, revpos: 2, digest: 'md5-ciphertext' } } };
    expect((await decryptDoc(k, stubbed))!._attachments!['att:1']).toEqual({ content_type: 'image/jpeg', digest: 'md5-xyz', stub: true, revpos: 2 });
  });
  it('a document stored without encryption is rejected', async () => {
    expect(await decryptDoc(k, { _id: 'task:abc', _rev: '1-a', title: 'plain' })).toBeNull();
  });
});
