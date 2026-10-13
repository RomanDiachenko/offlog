import { writable } from 'svelte/store';
import { showError } from './store';

// The desktop's "… · Undo" toasts, rendered by App.svelte. The phone has its
// own snackbar (phone/nav.ts's showToast). Here, not in desktop/, so App.svelte
// can render them without pulling in the lazily loaded desktop chunk.
export interface UndoToast { key: string; msg: string; undo: () => Promise<void> }

export const undoToasts = writable<UndoToast[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const SHOW_MS = 5000;
const MAX_SHOWN = 3;

// `key` identifies what the toast undoes; a second offer for the same key
// while one is showing is ignored.
export function offerUndo(key: string, msg: string, undo: () => Promise<void>): void {
  let added = false;
  undoToasts.update(list => {
    if (list.some(t => t.key === key)) return list;
    added = true;
    const next = [{ key, msg, undo }, ...list];
    for (const dropped of next.slice(MAX_SHOWN)) { clearTimeout(timers.get(dropped.key)); timers.delete(dropped.key); }
    return next.slice(0, MAX_SHOWN);
  });
  if (added) timers.set(key, setTimeout(() => dismissUndo(key), SHOW_MS));
}

export function dismissUndo(key: string): void {
  clearTimeout(timers.get(key));
  timers.delete(key);
  undoToasts.update(list => list.filter(t => t.key !== key));
}

// WCAG 2.2.1: while the pointer or keyboard focus is on a toast it doesn't
// time out; leaving it starts a full countdown again.
export function holdUndo(key: string): void {
  clearTimeout(timers.get(key));
  timers.delete(key);
}
export function releaseUndo(key: string): void {
  let shown = false;
  undoToasts.update(list => { shown = list.some(t => t.key === key); return list; });
  if (!shown || timers.has(key)) return;
  timers.set(key, setTimeout(() => dismissUndo(key), SHOW_MS));
}

export async function runUndo(key: string): Promise<void> {
  let toast: UndoToast | undefined;
  undoToasts.update(list => { toast = list.find(t => t.key === key); return list; });
  dismissUndo(key);
  if (!toast) return;
  try { await toast.undo(); } catch { showError('Could not undo. Please try again.'); }
}

// Toast text quotes a title; a long one would push Undo off the toast.
export const shortTitle = (title: string) => title.length > 30 ? title.slice(0, 30) + '…' : title;
