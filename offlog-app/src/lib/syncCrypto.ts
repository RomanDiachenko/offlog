// End-to-end encryption of synced documents. Each device keeps its own data
// readable; what goes to the sync server, and what the server stores, is
// AES-256-GCM ciphertext under a key only the paired devices hold (created by
// the PC, handed over inside the encrypted pairing reply). The server still
// sees the shape of the data: how many documents, each id's length, revision
// ids and history, deleted flags, sizes and timing (docs/security.md §3).
//
// Ids are encrypted deterministically (the IV is an HMAC of the id), so the
// same document always maps to the same server id and any device can turn a
// server id back into the real one without fetching the document; only that
// exact spelling opens. A document body is bound to its server id, revision,
// deleted flag and its full set of attachments, and carries its own history:
// a server, or anyone holding the sync password, cannot forge or alter one,
// move it to another revision, or strip its attachments. It can still
// withhold documents. Anything that fails a check decrypts to null.
//
// _local/ replication checkpoints keep their ids (hashes of the replication,
// no user data) but their bodies are sealed too (sealLocal), so a forged
// checkpoint can't make a device skip changes.

export interface SyncKeys { doc: CryptoKey; id: CryptoKey; idIv: CryptoKey; att: CryptoKey }

// Web Crypto takes only ArrayBuffer-backed bytes.
type Bytes = Uint8Array<ArrayBuffer>;
const subtle = () => globalThis.crypto.subtle;
const utf8 = new TextEncoder(), fromUtf8 = new TextDecoder();
const ID_PREFIX = 'x:';

export const passesThrough = (id: string) => id.startsWith('_local/');

function b64(bytes: Bytes): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64url = (bytes: Bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
const join = (a: Bytes, b: Bytes) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

export async function importSyncKey(base64Key: string): Promise<SyncKeys> {
  const raw = unb64(base64Key);
  if (raw.length !== 32) throw new Error('A sync key is 32 bytes.');
  const master = await subtle().importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  const derive = (info: string, alg: AesKeyGenParams | HmacImportParams, usages: KeyUsage[]) =>
    subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8.encode(info) }, master, alg, false, usages);
  const aes = { name: 'AES-GCM', length: 256 } as const;
  return {
    doc: await derive('offlog sync v1 doc', aes, ['encrypt', 'decrypt']),
    id: await derive('offlog sync v1 id', aes, ['encrypt', 'decrypt']),
    idIv: await derive('offlog sync v1 id-iv', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
    att: await derive('offlog sync v1 attachment', aes, ['encrypt', 'decrypt']),
  };
}

async function seal(key: CryptoKey, iv: Bytes, data: Bytes, aad: string): Promise<Bytes> {
  return join(iv, new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(aad) }, key, data)));
}
async function open(key: CryptoKey, sealed: Bytes, aad: string): Promise<Bytes | null> {
  if (sealed.length < 28) return null;
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12), additionalData: utf8.encode(aad) }, key, sealed.subarray(12)));
  } catch { return null; }
}
const randomIv = () => globalThis.crypto.getRandomValues(new Uint8Array(12));

export async function encryptId(k: SyncKeys, id: string): Promise<string> {
  if (passesThrough(id)) return id;
  const iv = new Uint8Array(await subtle().sign('HMAC', k.idIv, utf8.encode(id))).subarray(0, 12);
  return ID_PREFIX + b64url(await seal(k.id, iv, utf8.encode(id), 'offlog-id-v1'));
}

export async function decryptId(k: SyncKeys, serverId: string): Promise<string | null> {
  if (passesThrough(serverId)) return serverId;
  if (!serverId.startsWith(ID_PREFIX)) return null;
  let sealed: Bytes;
  try { sealed = unb64url(serverId.slice(ID_PREFIX.length)); } catch { return null; }
  // base64 decoding forgives stray bits and whitespace; a second spelling of
  // a real server id would alias that document and stall every pull of it.
  if (b64url(sealed) !== serverId.slice(ID_PREFIX.length)) return null;
  const id = await open(k.id, sealed, 'offlog-id-v1');
  return id && fromUtf8.decode(id);
}

type Att = { content_type?: string; data?: string; digest?: string; stub?: boolean; revpos?: number; length?: number };
type AnyDoc = Record<string, unknown> & { _id: string; _rev?: string; _deleted?: boolean; _attachments?: Record<string, Att> };

const docAad = (serverId: string, rev: string | undefined, deleted: boolean | undefined) =>
  `offlog-doc-v1\n${serverId}\n${rev ?? ''}\n${deleted ? 1 : 0}`;
const attAad = (serverId: string, name: string) => `offlog-att-v1\n${serverId}\n${name}`;

// The content type is sealed in front of the bytes (2-byte length, then the
// type): an attachment fetched on its own must come back as the type it was,
// or the device stores it as a typeless blob (an SVG then won't render).
export async function encryptAttachment(k: SyncKeys, serverId: string, name: string, bytes: Bytes, type = ''): Promise<Bytes> {
  const t = utf8.encode(type);
  const plain = new Uint8Array(2 + t.length + bytes.length);
  plain[0] = t.length >> 8; plain[1] = t.length & 0xff;
  plain.set(t, 2); plain.set(bytes, 2 + t.length);
  return seal(k.att, randomIv(), plain, attAad(serverId, name));
}
export async function decryptAttachment(k: SyncKeys, serverId: string, name: string, sealed: Bytes): Promise<{ type: string; bytes: Bytes } | null> {
  const plain = await open(k.att, sealed, attAad(serverId, name));
  if (!plain || plain.length < 2) return null;
  const n = (plain[0] << 8) | plain[1];
  if (plain.length < 2 + n) return null;
  return { type: fromUtf8.decode(plain.subarray(2, 2 + n)), bytes: plain.slice(2 + n) };
}

// The server database for a sync key: a new key starts a new, empty one, so
// documents sealed under an old key never mix with it. Same name as
// sync_host.rs encrypted_db_name(); only a one-way hash of the key.
export async function encryptedDbName(base64Key: string): Promise<string> {
  const h = new Uint8Array(await subtle().digest('SHA-256', utf8.encode('offlog-db-key-v1\n' + base64Key)));
  return 'offlog-e-' + Array.from(h.subarray(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}

// A device's document as the server will hold it. Attachments must carry
// their data (the replicator always pushes it); their real type and digest
// travel inside the encrypted body.
export async function encryptDoc(k: SyncKeys, doc: AnyDoc): Promise<AnyDoc> {
  if (passesThrough(doc._id)) return doc;
  const { _id, _rev, _deleted, _revisions, _attachments, _conflicts, ...body } = doc;
  const serverId = await encryptId(k, _id);
  const out: AnyDoc = { _id: serverId };
  if (_rev !== undefined) out._rev = _rev;
  if (_deleted) out._deleted = true;
  if (_revisions !== undefined) out._revisions = _revisions;
  const meta: Record<string, { content_type?: string; digest?: string }> = {};
  if (_attachments) {
    out._attachments = {};
    for (const [name, att] of Object.entries(_attachments)) {
      if (typeof att.data !== 'string') throw new Error('An attachment pushed for sync must carry its data.');
      meta[name] = { content_type: att.content_type, digest: att.digest };
      out._attachments[name] = { content_type: 'application/octet-stream', data: b64(await encryptAttachment(k, serverId, name, unb64(att.data), att.content_type)) };
    }
  }
  const inner = utf8.encode(JSON.stringify({ i: _id, d: body, a: meta, ...(_revisions !== undefined && { r: _revisions }) }));
  out.e = b64(await seal(k.doc, randomIv(), inner, docAad(serverId, _rev, _deleted)));
  return out;
}

// The server's copy back to the device's own document, or null when it was
// not written with this key, was altered, or claims another id or revision.
export async function decryptDoc(k: SyncKeys, serverDoc: AnyDoc): Promise<AnyDoc | null> {
  if (passesThrough(serverDoc._id)) return serverDoc;
  if (typeof serverDoc.e !== 'string') return null;
  const id = await decryptId(k, serverDoc._id);
  if (id === null) return null;
  let sealed: Bytes;
  try { sealed = unb64(serverDoc.e); } catch { return null; }
  const inner = await open(k.doc, sealed, docAad(serverDoc._id, serverDoc._rev, serverDoc._deleted));
  if (!inner) return null;
  let parsed: { i: string; d: Record<string, unknown>; a: Record<string, { content_type?: string; digest?: string }>; r?: unknown };
  try { parsed = JSON.parse(fromUtf8.decode(inner)); } catch { return null; }
  if (parsed.i !== id) return null;
  const out: AnyDoc = { ...parsed.d, _id: id };
  if (serverDoc._rev !== undefined) out._rev = serverDoc._rev;
  if (serverDoc._deleted) out._deleted = true;
  // The history the writing device sealed, not the server's: a forged one
  // could make a device's own conflicting version look like an ancestor of
  // the incoming one, and so hide it.
  if (parsed.r !== undefined) {
    const r = parsed.r as { start?: unknown; ids?: unknown };
    const [pos, hash] = (serverDoc._rev ?? '').split('-');
    if (r.start !== Number(pos) || !Array.isArray(r.ids) || r.ids[0] !== hash) return null;
    out._revisions = parsed.r;
  } else if (serverDoc._revisions !== undefined) out._revisions = serverDoc._revisions;
  // Every attachment the device sealed must be there: a server dropping one
  // would otherwise have it vanish, and the next edit carry the loss on.
  const sealedNames = Object.keys(parsed.a ?? {});
  if (sealedNames.length !== Object.keys(serverDoc._attachments ?? {}).length) return null;
  if (serverDoc._attachments) {
    out._attachments = {};
    for (const [name, att] of Object.entries(serverDoc._attachments)) {
      const real = parsed.a?.[name];
      if (!real) return null;
      const restored: Att = { content_type: real.content_type, digest: real.digest };
      if (typeof att.data === 'string') {
        const plain = await decryptAttachment(k, serverDoc._id, name, unb64(att.data));
        if (!plain) return null;
        restored.data = b64(plain.bytes);
      } else {
        restored.stub = true;
        if (att.revpos !== undefined) restored.revpos = att.revpos;
      }
      out._attachments[name] = restored;
    }
  }
  return out;
}

// A replication checkpoint (_local/ doc) as the server keeps it: id and the
// server's own _rev in the clear, everything the replicator reads sealed and
// bound to the id. One that doesn't open counts as missing, and PouchDB then
// compares from the start instead of resuming where a forger points it.
const localAad = (id: string) => `offlog-local-v1\n${id}`;
export async function sealLocal(k: SyncKeys, doc: AnyDoc): Promise<AnyDoc> {
  const { _id, _rev, ...body } = doc;
  const out: AnyDoc = { _id, e: b64(await seal(k.doc, randomIv(), utf8.encode(JSON.stringify(body)), localAad(_id))) };
  if (_rev !== undefined) out._rev = _rev;
  return out;
}
export async function openLocal(k: SyncKeys, doc: AnyDoc): Promise<AnyDoc | null> {
  if (typeof doc.e !== 'string') return null;
  let sealed: Bytes;
  try { sealed = unb64(doc.e); } catch { return null; }
  const plain = await open(k.doc, sealed, localAad(doc._id));
  if (!plain) return null;
  try { return { ...JSON.parse(fromUtf8.decode(plain)), _id: doc._id, ...(doc._rev !== undefined && { _rev: doc._rev }) }; } catch { return null; }
}
