// The fetch a remote PouchDB uses when sync is end-to-end encrypted. It sits
// between the replicator and the server: requests leave with ids and documents
// sealed (syncCrypto.ts), responses come back opened. Every other part of the
// app, and the replicator itself, only ever sees real ids and readable docs.
//
// Anything from the server that does not open under this key (forged,
// altered, replayed, or written by a device without the key) is dropped and
// counted once through onRejected; the replicator never sees it, so it is
// never stored. _local/ checkpoints keep their ids but are sealed too. Only
// the server root (its uuid) and the database's own info and create request
// pass through untouched.
//
// Fails closed: a request for any other address, any endpoint not listed
// here, and any write that is not the replicator's own (_bulk_docs with
// new_edits:false, checkpoint PUTs) is refused rather than sent. Such a
// write would leave the server a readable document, or one sealed under a
// revision the server then replaces, which no device can open.
import { encryptId, decryptId, encryptDoc, decryptDoc, decryptAttachment, sealLocal, openLocal, type SyncKeys } from '../syncCrypto';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
// Its own name, never TypeError: PouchDB passes it through, and a TypeError
// reads as "cannot reach the server" (describeSyncError) with advice about
// Wi-Fi and firewalls that has nothing to do with it.
export class EncryptedSyncError extends Error {
  override name = 'EncryptedSyncError';
  constructor(message: string, readonly detail = '') { super(message); }
}
const refuse = (what: string) => Promise.reject(new EncryptedSyncError('Could not sync securely: this device held back something it could not encrypt. Please update Offlog and try again.', what));
type Json = Record<string, unknown>;
type Doc = Json & { _id: string };

// Content-Type must be right when the Response is built: Chromium fixes a
// response's blob() type then, and a header changed afterwards is ignored
// (a pulled photo would be stored as a typeless blob).
function rebuild(res: Response, body: BodyInit, contentType?: string): Response {
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  if (contentType !== undefined) headers.set('Content-Type', contentType);
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}
const asJson = (res: Response, value: unknown) => rebuild(res, JSON.stringify(value));

export function encryptedFetch(dbUrl: string, keys: SyncKeys, onRejected: (count: number) => void, inner: FetchFn = (u, i) => fetch(u, i)): FetchFn {
  const baseUrl = new URL(dbUrl.replace(/\/+$/, ''));
  const base = baseUrl.origin + baseUrl.pathname;

  // Each refused server revision counted once: PouchDB re-reads a partly
  // kept page, and a restart before the checkpoint passes reads it again.
  const refused = new Set<string>();
  const reject = (serverId: string, revs: unknown[] = ['']) => {
    let n = 0;
    for (const rev of revs.length ? revs : ['']) { const key = `${serverId} ${String(rev)}`; if (!refused.has(key)) { refused.add(key); n++; } }
    if (n) onRejected(n);
  };
  async function openDoc(doc: Doc): Promise<Doc | null> {
    const opened = await decryptDoc(keys, doc);
    if (!opened) reject(doc._id, [doc._rev]);
    return opened as Doc | null;
  }
  const notFound = (reason: string) => new Response(JSON.stringify({ error: 'not_found', reason }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  return async function (url: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(url);
    const at = target.origin + target.pathname;
    // The server root holds only its uuid, which PouchDB folds into the
    // replication id; refused, that id would fall back to the address and
    // every address change would compare everything again.
    if (target.origin === baseUrl.origin && target.pathname === '/' && (init.method ?? 'GET').toUpperCase() === 'GET') return inner(url, init);
    if (at !== base && !at.startsWith(base + '/')) return refuse('a request outside its database');
    const rawPath = at.slice(base.length + 1);
    const qs = target.search;
    const method = (init.method ?? 'GET').toUpperCase();
    let body: any;
    try { body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
    const send = (path: string, newBody?: unknown) =>
      inner(`${base}/${path}${qs}`, newBody === undefined ? init : { ...init, body: JSON.stringify(newBody) });

    // The database itself: PouchDB's info() and its create-if-missing setup.
    if (rawPath === '') return method === 'GET' || method === 'HEAD' || (method === 'PUT' && !init.body) ? inner(url, init) : refuse('a write to the database itself');

    if (rawPath.startsWith('_local/')) {
      if (method === 'PUT' && body) return send(rawPath, await sealLocal(keys, { ...body, _id: decodeURIComponent(rawPath) }));
      if (method !== 'GET') return refuse('this checkpoint request');
      const res = await inner(url, init);
      if (!res.ok) return res;
      const opened = await openLocal(keys, await res.json() as Doc);
      return opened ? asJson(res, opened) : notFound('Checkpoint could not be read.');
    }

    switch (rawPath) {
      case '_bulk_docs': {
        if (body?.new_edits !== false) return refuse('a write that is not a replication');
        // One at a time: a batch with photos would otherwise hold every
        // copy of every attachment at once, which a phone may not survive.
        const docs = [];
        for (const d of body.docs as Doc[]) docs.push(await encryptDoc(keys, d));
        const res = await send(rawPath, { ...body, docs });
        if (!res.ok) return res;
        const out = await res.json() as Json[];
        return asJson(res, await Promise.all(out.map(async r => ({ ...r, id: typeof r.id === 'string' ? (await decryptId(keys, r.id)) ?? r.id : r.id }))));
      }
      case '_revs_diff': {
        const back = new Map<string, string>();
        const sealed: Json = {};
        for (const [id, revs] of Object.entries(body as Json)) { const sid = await encryptId(keys, id); back.set(sid, id); sealed[sid] = revs; }
        const res = await send(rawPath, sealed);
        if (!res.ok) return res;
        const out = await res.json() as Json;
        return asJson(res, Object.fromEntries(Object.entries(out).map(([sid, v]) => [back.get(sid) ?? sid, v])));
      }
      case '_bulk_get': {
        const docs = await Promise.all((body.docs as Json[]).map(async d => ({ ...d, id: await encryptId(keys, d.id as string) })));
        const res = await send(rawPath, { ...body, docs });
        if (!res.ok) return res;
        const out = await res.json() as { results: { id: string; docs: Json[] }[] };
        const results = [];
        for (const r of out.results) {
          const id = await decryptId(keys, r.id);
          if (id === null) { reject(r.id, r.docs.map(d => (d.ok as Doc | undefined)?._rev)); continue; }
          const opened = [];
          for (const d of r.docs) {
            if (!d.ok) { opened.push(d); continue; }
            const doc = await openDoc(d.ok as Doc);
            if (doc) opened.push({ ok: doc });
          }
          results.push({ ...r, id, docs: opened });
        }
        return asJson(res, { ...out, results });
      }
      case '_changes': {
        // A POST carries real ids or a selector to filter by; never sent.
        if (method !== 'GET') return refuse('a filtered changes feed');
        const res = await inner(url, init);
        if (!res.ok) return res;
        const out = await res.json() as { results: (Json & { id: string; doc?: Doc; changes?: { rev: string }[] })[] };
        const results = [];
        for (const row of out.results ?? []) {
          const id = await decryptId(keys, row.id);
          if (id === null) { reject(row.id, (row.changes ?? []).map(c => c.rev)); continue; }
          const next = { ...row, id };
          if (row.doc) { const doc = await openDoc(row.doc); if (!doc) continue; next.doc = doc; }
          results.push(next);
        }
        return asJson(res, { ...out, results });
      }
      case '_all_docs': {
        // Keys and ranges would go out as real ids, and ranges mean nothing
        // over encrypted ones.
        if (method !== 'GET' || ['key', 'keys', 'startkey', 'endkey', 'start_key', 'end_key'].some(p => target.searchParams.has(p))) return refuse('a keyed document listing');
        const res = await inner(url, init);
        if (!res.ok) return res;
        const out = await res.json() as { rows: (Json & { id: string; doc?: Doc })[] };
        const rows = [];
        for (const row of out.rows ?? []) {
          const id = await decryptId(keys, row.id);
          if (id === null) { reject(row.id); continue; }
          const next = { ...row, id, key: id };
          if (row.doc) { const doc = await openDoc(row.doc); if (!doc) continue; next.doc = doc; }
          rows.push(next);
        }
        return asJson(res, { ...out, rows });
      }
    }
    if (rawPath.startsWith('_') && !rawPath.startsWith('_design/')) return refuse(`the ${rawPath.split('/')[0]} endpoint`);

    // A document, or one of its attachments: /{id} or /{id}/{attachment}.
    // A design doc's id has a slash of its own (_design/name).
    const slash = rawPath.indexOf('/', rawPath.startsWith('_design/') ? 8 : 0);
    const id = decodeURIComponent(slash < 0 ? rawPath : rawPath.slice(0, slash));
    const sid = await encryptId(keys, id);
    const attachment = slash < 0 ? null : rawPath.slice(slash + 1);
    const path = encodeURIComponent(sid) + (attachment === null ? '' : '/' + attachment);

    if (method !== 'GET' && method !== 'HEAD') return refuse('a write that is not a replication');

    if (attachment !== null) {
      const res = await send(path);
      if (!res.ok || method !== 'GET') return res;
      const plain = await decryptAttachment(keys, sid, decodeURIComponent(attachment), new Uint8Array(await res.arrayBuffer()));
      if (!plain) {
        reject(`${sid}/${attachment}`, [target.searchParams.get('rev') ?? '']);
        return notFound('Attachment could not be read.');
      }
      const type = plain.type || 'application/octet-stream';
      const opened = rebuild(res, new Blob([plain.bytes as BlobPart], { type }), type);
      // PouchDB's Node build reads attachments through response.buffer()
      // (node-fetch); browsers and WebViews read the Blob.
      const NodeBuffer = (globalThis as { Buffer?: { from(b: Uint8Array): unknown } }).Buffer;
      if (NodeBuffer) Object.assign(opened, { buffer: async () => NodeBuffer.from(plain.bytes) });
      return opened;
    }

    const res = await send(path);
    if (!res.ok || method !== 'GET') return res;
    const out = await res.json() as Doc | Json[];
    if (Array.isArray(out)) {
      const opened = [];
      for (const d of out) {
        if (!d.ok) { opened.push(d); continue; }
        const doc = await openDoc(d.ok as Doc);
        if (doc) opened.push({ ok: doc });
      }
      return asJson(res, opened);
    }
    const doc = await openDoc(out);
    if (!doc) return notFound('Document could not be read.');
    return asJson(res, doc);
  };
}
