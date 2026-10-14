import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const showError = vi.fn();
vi.mock('../src/lib/store', () => ({ showError: (...a: unknown[]) => showError(...a) }));

import { undoToasts, offerUndo, runUndo, dismissUndo } from '../src/lib/undoToast';

afterEach(() => { for (const t of get(undoToasts)) dismissUndo(t.key); showError.mockReset(); vi.useRealTimers(); });

describe('desktop undo toasts', () => {
  it('shows a toast, runs its undo once, and removes it', async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    offerUndo('archive:task:1', 'Archived "A"', undo);
    expect(get(undoToasts).map(t => t.msg)).toEqual(['Archived "A"']);
    await runUndo('archive:task:1');
    await runUndo('archive:task:1');
    expect(undo).toHaveBeenCalledTimes(1);
    expect(get(undoToasts)).toEqual([]);
  });

  it('ignores a second offer for the same thing and keeps three at most', () => {
    offerUndo('k1', 'one', vi.fn()); offerUndo('k1', 'again', vi.fn());
    expect(get(undoToasts).map(t => t.msg)).toEqual(['one']);
    offerUndo('k2', 'two', vi.fn()); offerUndo('k3', 'three', vi.fn()); offerUndo('k4', 'four', vi.fn());
    expect(get(undoToasts).map(t => t.msg)).toEqual(['four', 'three', 'two']);
  });

  it('disappears on its own after a few seconds', () => {
    vi.useFakeTimers();
    offerUndo('k', 'gone soon', vi.fn());
    vi.advanceTimersByTime(5000);
    expect(get(undoToasts)).toEqual([]);
  });

  it('a failed undo says so', async () => {
    offerUndo('k', 'x', vi.fn().mockRejectedValue(new Error('boom')));
    await runUndo('k');
    expect(showError).toHaveBeenCalledWith('Could not undo. Please try again.');
  });
});

// WCAG 2.2.1: a toast that times out pauses while the pointer or keyboard
// focus is on it, and gets its full time again when left.
describe('undo toast pause', () => {
  it('keyboard focus keeps it held after the pointer leaves', async () => {
    vi.useFakeTimers();
    const { offerUndo, holdUndo, releaseUndo, undoToasts } = await import('../src/lib/undoToast');
    offerUndo('k:both', 'x', async () => {});
    holdUndo('k:both', 'focus');
    holdUndo('k:both', 'pointer');
    releaseUndo('k:both', 'pointer');
    vi.advanceTimersByTime(60000);
    expect(get(undoToasts).some(t => t.key === 'k:both')).toBe(true);
    releaseUndo('k:both', 'focus');
    vi.advanceTimersByTime(5100);
    expect(get(undoToasts).some(t => t.key === 'k:both')).toBe(false);
  });

  it('the window hiding releases a pointer hold that never got its mouseleave', async () => {
    vi.useFakeTimers();
    const { offerUndo, holdUndo, releasePointerHolds, undoToasts } = await import('../src/lib/undoToast');
    offerUndo('k:hid', 'x', async () => {});
    holdUndo('k:hid', 'pointer');
    releasePointerHolds();
    vi.advanceTimersByTime(5100);
    expect(get(undoToasts).some(t => t.key === 'k:hid')).toBe(false);
  });

  it('holds while hovered or focused, then runs a fresh countdown', async () => {
    vi.useFakeTimers();
    try {
      const { offerUndo, holdUndo, releaseUndo, undoToasts } = await import('../src/lib/undoToast');
      const { get } = await import('svelte/store');
      offerUndo('k:pause', 'Deleted "x"', async () => {});
      vi.advanceTimersByTime(4000);
      holdUndo('k:pause');
      vi.advanceTimersByTime(60000);
      expect(get(undoToasts).some(t => t.key === 'k:pause')).toBe(true);
      releaseUndo('k:pause');
      vi.advanceTimersByTime(4900);
      expect(get(undoToasts).some(t => t.key === 'k:pause')).toBe(true);
      vi.advanceTimersByTime(200);
      expect(get(undoToasts).some(t => t.key === 'k:pause')).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
