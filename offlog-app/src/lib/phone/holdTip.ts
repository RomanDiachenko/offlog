import { get } from 'svelte/store';
import { showToast, toast } from './nav';

// A task card's menu opens on a long press, which nothing on the card shows.
// The first plain tap on such a card says so, once per device; having held a
// card already counts as knowing. A live toast with a button (Undo, or an
// action like "Turn on") is never replaced by the tip: it waits for a later tap.
const KEY = 'offlog_hold_tip';

function seen(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return true; }
}
function remember(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* private mode: the tip may repeat */ }
}

export function holdTipOnTap(): void {
  const live = get(toast);
  if (seen() || live?.undo || live?.action) return;
  remember();
  showToast('Tip: hold a task in a list for more actions');
}

export function holdUsed(): void { remember(); }
