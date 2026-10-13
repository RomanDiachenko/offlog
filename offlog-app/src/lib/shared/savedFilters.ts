// Saved List/Board filters live on the project doc, so they sync and go into
// backups. Both apps read and write them only through here.
import { updateProject } from '../db';
import type { ProjectDoc, SavedFilterDoc } from '../types';

// Where each device used to keep them, one key per project.
const legacyKey = (projectId: string) => `offlog_saved_filters_${projectId}`;

// The list arrives by sync or from a backup file, so a malformed one reads as empty.
const valid = (v: unknown): SavedFilterDoc[] =>
  Array.isArray(v) ? v.filter(f => f && typeof f.name === 'string') : [];

function readLegacy(projectId: string): SavedFilterDoc[] {
  try { return valid(JSON.parse(localStorage.getItem(legacyKey(projectId)) ?? '[]')); }
  catch { return []; }
}

// The project's own entry wins over a same-named one from this device.
function merge(own: SavedFilterDoc[], local: SavedFilterDoc[]): SavedFilterDoc[] {
  const names = new Set(own.map(f => f.name));
  return [...own, ...local.filter(f => !names.has(f.name))];
}

// What to show: the project's filters plus any this device still holds from
// before they moved, so nothing disappears while the move is pending.
export function savedFiltersOf(project: ProjectDoc): SavedFilterDoc[] {
  return merge(valid(project.saved_filters), readLegacy(project._id));
}

// Moves this device's filters into the project once, then forgets them.
// A failed write keeps them local and is tried again on the next open; it is
// not the user's action, so it shows no error.
export async function moveLocalSavedFilters(projectId: string): Promise<void> {
  const local = readLegacy(projectId);
  if (!local.length) return;
  try {
    await updateProject(projectId, doc => ({ saved_filters: merge(valid(doc.saved_filters), local) }));
    localStorage.removeItem(legacyKey(projectId));
  } catch { /* retried on the next open */ }
}

// Same name replaces. Throws on a failed write: the caller shows the error.
export async function putSavedFilter(projectId: string, entry: SavedFilterDoc): Promise<SavedFilterDoc[]> {
  const p = await updateProject(projectId, doc => ({ saved_filters: [...valid(doc.saved_filters).filter(f => f.name !== entry.name), entry] }));
  return savedFiltersOf(p);
}

// A copy still waiting to move goes too, or it would come back.
export async function removeSavedFilter(projectId: string, name: string): Promise<SavedFilterDoc[]> {
  const local = readLegacy(projectId);
  if (local.some(f => f.name === name)) {
    try { localStorage.setItem(legacyKey(projectId), JSON.stringify(local.filter(f => f.name !== name))); } catch { /* storage unavailable */ }
  }
  const p = await updateProject(projectId, doc => ({ saved_filters: valid(doc.saved_filters).filter(f => f.name !== name) }));
  return savedFiltersOf(p);
}
