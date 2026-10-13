import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const showError = vi.hoisted(() => vi.fn());
vi.mock('../src/config', () => ({ isTauri: () => true, invokeTauri: (...a: unknown[]) => invoke(...a) }));
vi.mock('../src/lib/store', () => ({ showError }));

import { openWebLink } from '../src/lib/desktop/openWebLink';

beforeEach(() => { invoke.mockReset(); showError.mockReset(); });

describe('openWebLink (Windows app)', () => {
  it('hands the address to the native opener', async () => {
    invoke.mockResolvedValue(undefined);
    await openWebLink('https://offlog.io');
    expect(invoke).toHaveBeenCalledWith('open_web_link', { url: 'https://offlog.io' });
    expect(showError).not.toHaveBeenCalled();
  });

  it('says so when it could not open the link', async () => {
    invoke.mockRejectedValue('not a web address');
    await openWebLink('https://offlog.io');
    expect(showError).toHaveBeenCalledWith('Could not open the link. Please try again.');
  });
});
