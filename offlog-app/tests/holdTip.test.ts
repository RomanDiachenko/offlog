import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { holdTipOnTap, holdUsed } from '../src/lib/phone/holdTip';
import { toast } from '../src/lib/phone/nav';

describe('hold tip', () => {
  beforeEach(() => { localStorage.clear(); toast.set(null); });

  it('shows once, on the first tap of a card', () => {
    holdTipOnTap();
    expect(get(toast)?.text).toBe('Tip: hold a task in a list for more actions');
    toast.set(null);
    holdTipOnTap();
    expect(get(toast)).toBeNull();
  });

  it('never shows once a card has been held', () => {
    holdUsed();
    holdTipOnTap();
    expect(get(toast)).toBeNull();
  });
});
