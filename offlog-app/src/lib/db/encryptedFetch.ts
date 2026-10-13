// The fetch a remote PouchDB uses when sync is end-to-end encrypted. It sits
// between the replicator and the server: requests leave with ids and documents
// sealed (syncCrypto.ts), responses come back opened. Every other part of the
// app, and the replicator itself, only ever sees real ids and readable docs.
//
// Anything from the server that does not open under this key (forged,
// altered, replayed, or written by a device without the key) is dropped and
// counted through onRejected; the replicator never sees it, so it is never
// stored. _local/ checkpoints and endpoints without user data pass through.
//
// Fails closed: a request for any other address, and any write that is not
// the replicator's own (_bulk_docs with new_edits:false), is refused rather
// than sent. Such a write would leave the server a readable document, or one
// sealed under a revision the server then replaces, which no device can open.
import { encryptId, decryptId, encryptDoc, decryptDoc, decryptAttachment, passesThrough, type SyncKeys } from '../syncCrypto';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
const refuse = (what: string) => Promise.reject(new TypeError(`Encrypted sync refuses ${what}.`));
type Json = Record<string, unknown>;
type Doc = Json & { _id: string };

function rebuild(res: Response, body: BodyInit): Response {
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}
const asJson = (res: Response, value: unknown) => rebuild(res, JSON.stringify(value));

export function encryptedFetch(dbUrl: string, keys: SyncKeys, onRejected: (count: number) => void, inner: FetchFn = (u, i) => fetch(u, i)): FetchFn {
  const baseUrl = new URL(dbUrl.replace(/\/+$/, ''));
  const base = baseUrl.origin + baseUrl.pathname;

  async function openDoc(doc: Doc): Promise<Doc | null> {
    const opened = await decryptDoc(keys, doc);
    if (!opened) onRejected(1);
    return opened as Doc | null;
  }

  return async function (url: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(url);
    const at = target.origin + target.pathname;
    if (at !== base && !at.startsWith(base + '/')) return refuse('a request outside its database');
    const rawPath = at.slice(base.length + 1);
    const qs = target.search;
    const method = (init.method ?? 'GET').toUpperCase();
    let body: any;
    try { body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
    const send = (path: string, newBody?: unknown) =>
      inner(`${base}/${path}${qs}`, newBody === undefined ? init : { ...init, body: JSON.stringify(newBody) });

    if (rawPath === '' || rawPath.startsWith('_local/') || rawPath.startsWith('_design/')) return inner(url, init);

    switch (rawPath) {
      case '_bulk_docs': {
        if (body?.new_edits !== false) return refuse('a write that is not a replication');
        const docs = await Promise.all((body.docs as Doc[]).map(d => encryptDoc(keys, d)));
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
          if (id === null) { onRejected(r.docs.length); continue; }
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
        const res = await inner(url, init);
        if (!res.ok) return res;
        const out = await res.json() as { results: (Json & { id: string; doc?: Doc })[] };
        const results = [];
        for (const row of out.results ?? []) {
          const id = await decryptId(keys, row.id);
          if (id === null) { onRejected(1); continue; }
          const next = { ...row, id };
          if (row.doc) { const doc = await openDoc(row.doc); if (!doc) continue; next.doc = doc; }
          results.push(next);
        }
        return asJson(res, { ...out, results });
      }
      case '_all_docs': {
        const res = await inner(url, init);
        if (!res.ok) return res;
        const out = await res.json() as { rows: (Json & { id: string; doc?: Doc })[] };
        const rows = [];
        for (const row of out.rows ?? []) {
          const id = await decryptId(keys, row.id);
          if (id === null) { onRejected(1); continue; }
          const next = { ...row, id, key: id };
          if (row.doc) { const doc = await openDoc(row.doc); if (!doc) continue; next.doc = doc; }
          rows.push(next);
        }
        return asJson(res, { ...out, rows });
      }
    }
    if (rawPath.startsWith('_')) return inner(url, init);

    // A document, or one of its attachments: /{id} or /{id}/{attachment}.
    const slash = rawPath.indexOf('/');
    const id = decodeURIComponent(slash < 0 ? rawPath : rawPath.slice(0, slash));
    if (passesThrough(id)) return inner(url, init);
    const sid = await encryptId(keys, id);
    const attachment = slash < 0 ? null : rawPath.slice(slash + 1);
    const path = encodeURIComponent(sid) + (attachment === null ? '' : '/' + attachment);

    if (method !== 'GET' && method !== 'HEAD') return refuse('a write that is not a replication');

    if (attachment !== null) {
      const res = await send(path);
      if (!res.ok || method !== 'GET') return res;
      const plain = await decryptAttachment(keys, sid, decodeURIComponent(attachment), new Uint8Array(await res.arrayBuffer()));
      if (!plain) {
        onRejected(1);
        return new Response(JSON.stringify({ error: 'not_found', reason: 'Attachment could not be read.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      const opened = rebuild(res, new Blob([plain as BlobPart], { type: 'application/octet-stream' }));
      // PouchDB's Node build reads attachments through response.buffer()
      // (node-fetch); browsers and WebViews read the Blob.
      const NodeBuffer = (globalThis as { Buffer?: { from(b: Uint8Array): unknown } }).Buffer;
      if (NodeBuffer) Object.assign(opened, { buffer: async () => NodeBuffer.from(plain) });
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
    if (!doc) return new Response(JSON.stringify({ error: 'not_found', reason: 'Document could not be read.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return asJson(res, doc);
  };
}
