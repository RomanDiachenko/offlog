import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config', async (orig) => ({ ...(await orig<object>()), getTimeFormat24h: () => true }));
import { reminderWhen } from '../src/lib/phone/format';

describe('reminderWhen', () => {
  const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m, d, h, min).toISOString();
  it('reads day first, then the time', () => {
    expect(reminderWhen(at(2030, 9, 9, 16, 5), '2030-10-09')).toBe('Today, 16:05');
    expect(reminderWhen(at(2030, 9, 10, 9, 0), '2030-10-09')).toBe('Tomorrow, 09:00');
    expect(reminderWhen(at(2030, 9, 15, 16, 5), '2030-10-09')).toBe('Tue 15 Oct, 16:05');
  });
});
