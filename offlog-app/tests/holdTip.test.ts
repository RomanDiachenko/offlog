import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { holdTipOnTap, holdUsed } from '../src/lib/phone/holdTip';
import { toast } from '../src/lib/phone/nav';

describe('hold tip', () => {
  beforeEach(() => { localStorage.clear(); toast.set(null); });

  it('shows once, on the first tap of a card', () => {
    holdTipOnTap();
    expect(get(toast)?.text).toBe('Tip: hold a task for more actions, or in a project’s List to select several');
    toast.set(null);
    holdTipOnTap();
    expect(get(toast)).toBeNull();
  });

  it('waits while an Undo is showing, then shows on a later tap', () => {
    toast.set({ id: 1, text: 'Done: A', undo: () => {} });
    holdTipOnTap();
    expect(get(toast)?.text).toBe('Done: A');
    toast.set(null);
    holdTipOnTap();
    expect(get(toast)?.text).toBe('Tip: hold a task for more actions, or in a project’s List to select several');
  });

  it('waits while a toast with an action is showing', () => {
    toast.set({ id: 2, text: 'Reminders may be a few minutes late', action: { label: 'Turn on', run: () => {} } });
    holdTipOnTap();
    expect(get(toast)?.text).toBe('Reminders may be a few minutes late');
  });

  it('never shows once a card has been held', () => {
    holdUsed();
    holdTipOnTap();
    expect(get(toast)).toBeNull();
  });
});
