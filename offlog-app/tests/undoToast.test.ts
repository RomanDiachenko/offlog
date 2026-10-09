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
