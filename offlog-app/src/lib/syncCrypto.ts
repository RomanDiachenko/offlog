// End-to-end encryption of synced documents. Each device keeps its own data
// readable; what goes to the sync server, and what the server stores, is
// AES-256-GCM ciphertext under a key only the paired devices hold (created by
// the PC, handed over inside the encrypted pairing reply). The server sees
// opaque ids, revision ids, sizes and timing, nothing else.
//
// Ids are encrypted deterministically (the IV is an HMAC of the id), so the
// same document always maps to the same server id and any device can turn a
// server id back into the real one without fetching the document. A document
// body is bound to its server id, revision and deleted flag: a server, or
// anyone holding the sync password, cannot forge, alter, delete or replay a
// document. Anything that fails a check decrypts to null and is rejected.
//
// _local/ (replication checkpoints) and _design/ documents pass through as is:
// they hold no user data and the server must be able to read them.

export interface SyncKeys { doc: CryptoKey; id: CryptoKey; idIv: CryptoKey; att: CryptoKey }

// Web Crypto takes only ArrayBuffer-backed bytes.
type Bytes = Uint8Array<ArrayBuffer>;
const subtle = () => globalThis.crypto.subtle;
const utf8 = new TextEncoder(), fromUtf8 = new TextDecoder();
const ID_PREFIX = 'x:';

export const passesThrough = (id: string) => id.startsWith('_local/') || id.startsWith('_design/');

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
  if (passesThrough(id) || id.startsWith(ID_PREFIX)) return id;
  const iv = new Uint8Array(await subtle().sign('HMAC', k.idIv, utf8.encode(id))).subarray(0, 12);
  return ID_PREFIX + b64url(await seal(k.id, iv, utf8.encode(id), 'offlog-id-v1'));
}

export async function decryptId(k: SyncKeys, serverId: string): Promise<string | null> {
  if (passesThrough(serverId)) return serverId;
  if (!serverId.startsWith(ID_PREFIX)) return null;
  let sealed: Bytes;
  try { sealed = unb64url(serverId.slice(ID_PREFIX.length)); } catch { return null; }
  const id = await open(k.id, sealed, 'offlog-id-v1');
  return id && fromUtf8.decode(id);
}

type Att = { content_type?: string; data?: string; digest?: string; stub?: boolean; revpos?: number; length?: number };
type AnyDoc = Record<string, unknown> & { _id: string; _rev?: string; _deleted?: boolean; _attachments?: Record<string, Att> };

const docAad = (serverId: string, rev: string | undefined, deleted: boolean | undefined) =>
  `offlog-doc-v1\n${serverId}\n${rev ?? ''}\n${deleted ? 1 : 0}`;
const attAad = (serverId: string, name: string) => `offlog-att-v1\n${serverId}\n${name}`;

export async function encryptAttachment(k: SyncKeys, serverId: string, name: string, bytes: Bytes): Promise<Bytes> {
  return seal(k.att, randomIv(), bytes, attAad(serverId, name));
}
export async function decryptAttachment(k: SyncKeys, serverId: string, name: string, sealed: Bytes): Promise<Bytes | null> {
  return open(k.att, sealed, attAad(serverId, name));
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
      out._attachments[name] = { content_type: 'application/octet-stream', data: b64(await encryptAttachment(k, serverId, name, unb64(att.data))) };
    }
  }
  const inner = utf8.encode(JSON.stringify({ i: _id, d: body, a: meta }));
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
  let parsed: { i: string; d: Record<string, unknown>; a: Record<string, { content_type?: string; digest?: string }> };
  try { parsed = JSON.parse(fromUtf8.decode(inner)); } catch { return null; }
  if (parsed.i !== id) return null;
  const out: AnyDoc = { ...parsed.d, _id: id };
  if (serverDoc._rev !== undefined) out._rev = serverDoc._rev;
  if (serverDoc._deleted) out._deleted = true;
  if (serverDoc._revisions !== undefined) out._revisions = serverDoc._revisions;
  if (serverDoc._attachments) {
    out._attachments = {};
    for (const [name, att] of Object.entries(serverDoc._attachments)) {
      const real = parsed.a?.[name];
      if (!real) return null;
      const restored: Att = { content_type: real.content_type, digest: real.digest };
      if (typeof att.data === 'string') {
        const plain = await decryptAttachment(k, serverDoc._id, name, unb64(att.data));
        if (!plain) return null;
        restored.data = b64(plain);
      } else {
        restored.stub = true;
        if (att.revpos !== undefined) restored.revpos = att.revpos;
      }
      out._attachments[name] = restored;
    }
  }
  return out;
}
