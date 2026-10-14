// Saved List/Board filters: their own meta:filter: docs (db/entities.ts), so
// they sync and go into backups without ever writing the project doc. Both
// apps read and write them only through here.
import { getSavedFilterRecords, putSavedFilterRecord } from '../db';
import type { SavedFilterDoc } from '../types';

// Where each device used to keep them, one key per project.
const legacyKey = (projectId: string) => `offlog_saved_filters_${projectId}`;

// A record arrives by sync or from a backup file, so a malformed one is dropped.
const valid = (v: unknown): SavedFilterDoc[] =>
  Array.isArray(v) ? v.filter(f => f && typeof f.name === 'string') : [];

function readLegacy(projectId: string): SavedFilterDoc[] {
  try { return valid(JSON.parse(localStorage.getItem(legacyKey(projectId)) ?? '[]')); }
  catch { return []; }
}

// What to show: the synced filters, plus any this device still holds from
// before they synced and has not moved yet. A name deleted anywhere stays
// gone, and a synced one wins over a same-named local copy.
export async function getSavedFilters(projectId: string): Promise<SavedFilterDoc[]> {
  const records = await getSavedFilterRecords(projectId);
  const known = new Set(records.map(r => r.name));
  const own = records.filter(r => !r.deleted).map(r => r.filter);
  return [...own, ...readLegacy(projectId).filter(f => !known.has(f.name))];
}

// Moves this device's filters into synced records once, then forgets them.
// A name already there (or deleted) is left as it is. A failed write keeps
// them local and is tried again on the next open; it is not the user's
// action, so it shows no error.
export async function moveLocalSavedFilters(projectId: string): Promise<void> {
  const local = readLegacy(projectId);
  if (!local.length) return;
  try {
    const known = new Set((await getSavedFilterRecords(projectId)).map(r => r.name));
    for (const f of local) if (!known.has(f.name)) await putSavedFilterRecord(projectId, f);
    localStorage.removeItem(legacyKey(projectId));
  } catch { /* retried on the next open */ }
}

// Same name replaces. Throws on a failed write: the caller shows the error.
export async function putSavedFilter(projectId: string, entry: SavedFilterDoc): Promise<SavedFilterDoc[]> {
  await putSavedFilterRecord(projectId, entry);
  return getSavedFilters(projectId);
}

// A copy still waiting to move goes too, or it would come back.
export async function removeSavedFilter(projectId: string, name: string): Promise<SavedFilterDoc[]> {
  const local = readLegacy(projectId);
  const kept = local.filter(f => f.name !== name);
  if (kept.length !== local.length) {
    try { localStorage.setItem(legacyKey(projectId), JSON.stringify(kept)); } catch { /* storage unavailable */ }
  }
  await putSavedFilterRecord(projectId, { name, search: '', filterCol: '', filterPrio: 0, filterTag: '' }, true);
  return getSavedFilters(projectId);
}
