import { describe, expect, it, vi, afterEach } from 'vitest';
import { endLaunchCover } from '../src/lib/launch';

afterEach(() => { document.documentElement.className = ''; document.getElementById('launch')?.remove(); });

describe('launch cover', () => {
  it('removes a shown cover and reports done', () => {
    document.documentElement.classList.add('launching', 'launch-dark');
    const el = document.createElement('div'); el.id = 'launch'; document.body.appendChild(el);
    const done = vi.fn();
    vi.useFakeTimers();
    endLaunchCover(done);
    vi.runAllTimers();
    vi.useRealTimers();
    expect(done).toHaveBeenCalledTimes(1);
    expect(document.getElementById('launch')).toBeNull();
    expect(document.documentElement.classList.contains('launching')).toBe(false);
    expect(document.documentElement.classList.contains('launch-dark')).toBe(false);
  });

  it('where no cover was shown (browser, desktop), it only reports done', () => {
    const done = vi.fn();
    endLaunchCover(done);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
