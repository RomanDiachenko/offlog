import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTauriSyncDefaults, getSyncUrl, getSyncKey, syncsWithOwnSidecar, setSyncUrl } from '../src/config';

// The Windows app keeps following its own sync host (which can move port or
// change identity) but never overrides a server the user set up by hand.
// window.__TAURI_INTERNALS__ is what config.ts reads to know it runs in Tauri.
const invoke = vi.fn();

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) =>
    cmd === 'get_sync_info' ? { port: 51234, user: 'offlog', password: 'fresh' } : undefined);
  (window as any).__TAURI_INTERNALS__ = { invoke };
});
afterEach(() => { delete (window as any).__TAURI_INTERNALS__; });

const stored = () => invoke.mock.calls.filter(c => c[0] === 'store_sync_secret').map(c => c[1]);

describe('initTauriSyncDefaults', () => {
  it('points a fresh install at its own sync host', async () => {
    await initTauriSyncDefaults();
    expect(getSyncUrl()).toBe('http://127.0.0.1:51234/offlog');
    expect(stored()).toEqual([{ user: 'offlog', pass: 'fresh' }]);
  });

  it('follows the host to a new port and new credentials on a later start', async () => {
    await initTauriSyncDefaults();
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'get_sync_info' ? { port: 60001, user: 'offlog', password: 'rotated' } : undefined);
    await initTauriSyncDefaults();
    expect(getSyncUrl()).toBe('http://127.0.0.1:60001/offlog');
    expect(stored().at(-1)).toEqual({ user: 'offlog', pass: 'rotated' });
  });

  it('knows when this app is the host phones sync with, and when it is not', async () => {
    expect(syncsWithOwnSidecar()).toBe(false);
    await initTauriSyncDefaults();
    expect(syncsWithOwnSidecar()).toBe(true);
    setSyncUrl('http://10.0.0.9:5984/offlog');
    expect(syncsWithOwnSidecar()).toBe(false);
  });

  it('treats an older install with a loopback URL as following its host', async () => {
    localStorage.setItem('offlog_sync_url', 'http://127.0.0.1:49999/offlog');
    await initTauriSyncDefaults();
    expect(getSyncUrl()).toBe('http://127.0.0.1:51234/offlog');
  });

  it('never overrides a server the user configured', async () => {
    await initTauriSyncDefaults();
    localStorage.setItem('offlog_sync_url', 'http://192.168.1.20:5984/offlog');
    invoke.mockClear();
    await initTauriSyncDefaults();
    expect(getSyncUrl()).toBe('http://192.168.1.20:5984/offlog');
    expect(stored()).toEqual([]);
  });

  it('a host with a sync key moves this device to the encrypted database and retires the readable one', async () => {
    await initTauriSyncDefaults();
    expect(getSyncKey()).toBe('');
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'get_sync_info' ? { port: 51234, user: 'offlog', password: 'new', key: 'a2V5LWE=' } : undefined);
    await initTauriSyncDefaults();
    expect(getSyncUrl()).toBe('http://127.0.0.1:51234/offlog-e-e153e859bc5ce847');
    expect(getSyncKey()).toBe('a2V5LWE=');
    expect(localStorage.getItem('offlog_plain_server_to_retire')).toBe('http://127.0.0.1:51234/offlog');
  });

  it('a fresh install with a key has no readable database to retire', async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'get_sync_info' ? { port: 51234, user: 'offlog', password: 'new', key: 'a2V5LWE=' } : undefined);
    await initTauriSyncDefaults();
    expect(getSyncUrl()).toBe('http://127.0.0.1:51234/offlog-e-e153e859bc5ce847');
    expect(localStorage.getItem('offlog_plain_server_to_retire')).toBeNull();
  });
});

describe('clearPairedHost', () => {
  it('drops the sync key with the paired PC, so a hand-set server syncs readable', async () => {
    const { clearPairedHost, setSyncKey } = await import('../src/config');
    setSyncKey('a2V5');
    clearPairedHost();
    expect(getSyncKey()).toBe('');
  });
});

describe('watchSyncDataSetAside', () => {
  it('shows a set-aside the PC already did before the app asked', async () => {
    const { watchSyncDataSetAside, syncDataSetAside } = await import('../src/config');
    const { get } = await import('svelte/store');
    invoke.mockImplementation(async (cmd: string) => cmd === 'get_sync_data_set_aside' ? 'C:/data/nyxdb-data.damaged-5' : undefined);
    await watchSyncDataSetAside();
    expect(get(syncDataSetAside)).toBe('C:/data/nyxdb-data.damaged-5');
  });
});
