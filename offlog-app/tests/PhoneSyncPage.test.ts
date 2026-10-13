import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import { get, type Writable } from 'svelte/store';

const m = vi.hoisted(() => ({
  url: 'http://pc.local:5984/offlog',
  enabled: true,
  name: 'Pixel',
  askName: false,
  hub: 'Office PC' as string | null,
  uuid: 'h1' as string | null,
  syncState: { status: 'idle', lastSynced: null as string | null, error: null as string | null, lastErrorAt: null, conflictCount: 0, listeners: new Set<() => void>() },
}));
const setSyncEnabled = vi.fn((v: boolean) => { m.enabled = v; });
const setDeviceName = vi.fn((n: string) => { m.name = n.trim() || 'Default'; });
vi.mock('../src/config', async () => {
  const { writable: w } = await import('svelte/store');
  return {
    getSyncUrl: () => m.url,
    isSyncEnabled: () => m.enabled,
    setSyncEnabled: (...a: unknown[]) => setSyncEnabled(...(a as [boolean])),
    getDeviceName: () => m.name,
    getDeviceId: () => 'dev:me',
    getPairedHostName: () => m.hub,
    getPairedHostUuid: () => m.uuid,
    shouldAskDeviceNameForSync: () => m.askName,
    markDeviceNameAskedForSync: () => { m.askName = false; },
    setDeviceName: (...a: unknown[]) => setDeviceName(...(a as [string])),
    isTauri: () => false, invokeTauri: vi.fn(), getTimeFormat24h: () => true,
    otherHostsDetected: w([]),
  };
});

const syncNow = vi.fn();
const startSync = vi.fn();
const cancelSync = vi.fn();
const getDeviceLastSeen = vi.fn();
const getConflicts = vi.fn();
const resolveConflict = vi.fn();
const getSyncHostRecord = vi.fn();
vi.mock('../src/lib/db', () => ({
  getSyncHostRecord: (...a: unknown[]) => getSyncHostRecord(...a),
  syncState: m.syncState,
  syncNow: (...a: unknown[]) => syncNow(...a),
  startSync: (...a: unknown[]) => startSync(...a),
  cancelSync: (...a: unknown[]) => cancelSync(...a),
  getDeviceLastSeen: (...a: unknown[]) => getDeviceLastSeen(...a),
  getConflicts: (...a: unknown[]) => getConflicts(...a),
  resolveConflict: (...a: unknown[]) => resolveConflict(...a),
  getCustomFieldDefs: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/lib/store', async () => {
  const { writable: w } = await import('svelte/store');
  return { showError: vi.fn(), modalOpen: w(false), projects: w([]) };
});
const pairWithHost = vi.fn();
const scanForHosts = vi.fn();
vi.mock('../src/lib/discovery', async () => {
  const { writable: w } = await import('svelte/store');
  return {
    discoveredHosts: w([]), isScanning: w(false),
    scanForHosts: (...a: unknown[]) => scanForHosts(...a), stopScan: vi.fn(),
    pairWithHost: (...a: unknown[]) => pairWithHost(...a), staleHostAlert: w(null),
  };
});
const confirmAction = vi.fn();
vi.mock('../src/lib/confirm', () => ({ confirmAction: (...a: unknown[]) => confirmAction(...a), confirmRequest: { subscribe: (f: (v: null) => void) => { f(null); return () => {}; } } }));

import SettingsPage from '../src/lib/phone/settings/SettingsPage.svelte';
import { showError } from '../src/lib/store';
import * as nav from '../src/lib/phone/nav';
import { staleHostAlert, discoveredHosts } from '../src/lib/discovery';

window.matchMedia = ((q: string) => ({
  matches: q.includes('reduce'), media: q, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const settle = (ms = 30) => new Promise(r => setTimeout(r, ms));
const conflict = {
  docId: 'task:a', label: 'Buy paint', type: 'task', differing: ['title'],
  versions: [
    { rev: '', isCurrent: true, isNewest: false, doc: { _rev: '3-a', source: 'Pixel', title: 'Buy paint', updated_at: new Date().toISOString() } },
    { rev: '3-b', isCurrent: false, isNewest: true, doc: { _rev: '3-b', source: 'PC', title: 'Buy paint now', updated_at: new Date().toISOString() } },
  ],
};

beforeEach(async () => {
  await settle();
  nav.switchTab('home');
  await settle();
  vi.clearAllMocks();
  nav.toast.set(null);
  m.url = 'http://pc.local:5984/offlog';
  m.enabled = true;
  m.name = 'Pixel';
  m.askName = false;
  m.hub = 'Office PC';
  m.uuid = 'h1';
  Object.assign(m.syncState, { status: 'idle', lastSynced: null, error: null, conflictCount: 0 });
  syncNow.mockResolvedValue(undefined);
  startSync.mockResolvedValue(undefined);
  getDeviceLastSeen.mockResolvedValue([
    { device: 'Pixel', lastSeen: new Date().toISOString() },
    { device: 'Office PC', lastSeen: new Date(Date.now() - 2 * 3600e3).toISOString() },
    { device: 'Galaxy Tab', lastSeen: new Date(Date.now() - 3 * 3600e3).toISOString() },
    { device: 'work phone', lastSeen: new Date(Date.now() - 3 * 86400e3).toISOString() },
    { device: 'Old name of this phone', id: 'dev:me', lastSeen: new Date(Date.now() - 4 * 86400e3).toISOString() },
  ]);
  getConflicts.mockResolvedValue([]);
  getSyncHostRecord.mockResolvedValue(null);
  resolveConflict.mockResolvedValue(undefined);
  pairWithHost.mockResolvedValue(undefined);
  (staleHostAlert as Writable<{ uuid: string; name: string } | null>).set(null);
  (discoveredHosts as Writable<unknown[]>).set([]);
  delete (window as { Capacitor?: unknown }).Capacitor;
});
afterEach(() => { cleanup(); delete (window as { Capacitor?: unknown }).Capacitor; });

describe('phone Sync page', () => {
  it('the card shows this device ↔ the computer; other devices list only the rest', async () => {
    m.syncState.lastSynced = new Date().toISOString();
    const { getByRole, getByText, container } = render(SettingsPage, { page: 'sync' });
    expect(getByRole('heading', { name: 'Up to date' })).toBeTruthy();
    expect(getByText(/^Synced /)).toBeTruthy();
    const card = container.querySelector('.card')!;
    expect(card.classList.contains('ok')).toBe(true);
    expect(card.querySelector('.me b')!.textContent).toBe('Pixel');
    expect(card.textContent).toContain('Office PC');
    await waitFor(() => getByText('Galaxy Tab'));
    const rows = [...container.querySelectorAll('.dev')].map(r => r.textContent!);
    expect(rows).toHaveLength(2);
    expect(rows.some(r => r.includes('Pixel') || r.includes('Office PC'))).toBe(false);
    const tab = [...container.querySelectorAll('.dev')].find(r => r.textContent!.includes('Galaxy Tab'))!;
    expect(tab.querySelector('.ava')!.textContent).toBe('G');
    expect(tab.textContent).toContain('Last change 3h ago');
    expect(tab.querySelector('.p-dot.fresh')).toBeTruthy();
    const old = [...container.querySelectorAll('.dev')].find(r => r.textContent!.includes('work phone'))!;
    expect(old.querySelector('.ava')!.textContent).toBe('W');
    expect(old.textContent).toContain('Last change 3d ago');
    expect(old.querySelector('.p-dot.fresh')).toBeNull();
    expect(getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(getDeviceLastSeen).toHaveBeenCalledWith();
  });

  it('a phone paired before the name was kept calls the computer "Your computer"', () => {
    m.hub = null;
    const { container } = render(SettingsPage, { page: 'sync' });
    expect(container.querySelector('.card')!.textContent).toContain('Your computer');
  });

  it('the switch turns sync off (cancelling it) and back on (starting it)', async () => {
    const { getByRole, getByText, queryByText } = render(SettingsPage, { page: 'sync' });
    await fireEvent.click(getByRole('switch'));
    expect(setSyncEnabled).toHaveBeenLastCalledWith(false);
    expect(cancelSync).toHaveBeenCalledTimes(1);
    expect(getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(getByRole('heading', { name: 'Sync is off' })).toBeTruthy();
    expect(getByText('Everything stays on this device.')).toBeTruthy();
    expect(queryByText('Sync now')).toBeNull();
    await fireEvent.click(getByRole('switch'));
    expect(setSyncEnabled).toHaveBeenLastCalledWith(true);
    expect(startSync).toHaveBeenCalledTimes(1);
  });

  it('with sync off, the card button turns it back on', async () => {
    m.enabled = false;
    const { getByText, getByRole } = render(SettingsPage, { page: 'sync' });
    await fireEvent.click(getByText('Turn on sync'));
    expect(setSyncEnabled).toHaveBeenLastCalledWith(true);
    expect(startSync).toHaveBeenCalledTimes(1);
    expect(getByRole('heading', { name: 'Waiting for the first sync' })).toBeTruthy();
  });

  it('turning Sync on for the first time asks for the device name, once', async () => {
    m.enabled = false;
    m.askName = true;
    const { getByRole } = render(SettingsPage, { page: 'sync' });
    expect(document.querySelector('.psheet')).toBeNull();
    await fireEvent.click(getByRole('switch'));
    await waitFor(() => expect((getByRole('textbox') as HTMLInputElement).value).toBe('Pixel'));
    expect(m.askName).toBe(false);
  });

  it('turning Sync on again does not ask for the name', async () => {
    m.enabled = false;
    const { getByRole } = render(SettingsPage, { page: 'sync' });
    await fireEvent.click(getByRole('switch'));
    expect(startSync).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.psheet')).toBeNull();
  });

  it('Sync now syncs and confirms; a failure surfaces showError', async () => {
    const { getByText } = render(SettingsPage, { page: 'sync' });
    await fireEvent.click(getByText('Sync now'));
    await waitFor(() => expect(get(nav.toast)?.text).toBe('Synced'));
    expect(syncNow).toHaveBeenCalledWith();
    syncNow.mockRejectedValueOnce(new Error('x'));
    await fireEvent.click(getByText('Sync now'));
    await waitFor(() => expect(showError).toHaveBeenCalledWith('Could not sync. Please try again.'));
  });

  it('Sync now while offline says the computer is out of reach', async () => {
    m.syncState.status = 'offline';
    syncNow.mockRejectedValueOnce(new Error('x'));
    const { getByText } = render(SettingsPage, { page: 'sync' });
    await fireEvent.click(getByText('Sync now'));
    await waitFor(() => expect(showError).toHaveBeenCalledWith('Could not reach your computer. Sync picks up again once this phone is back on its network.'));
  });

  it('resolving the last conflict closes the sheet and says so', async () => {
    m.syncState.conflictCount = 1;
    getConflicts.mockResolvedValue([conflict]);
    const { getByText, getAllByText, queryByText } = render(SettingsPage, { page: 'sync' });
    await waitFor(() => getByText('Review conflicts'));
    await fireEvent.click(getByText('Review conflicts'));
    await waitFor(() => getByText('Buy paint now'));
    getConflicts.mockResolvedValue([]);
    confirmAction.mockResolvedValueOnce(true);
    await fireEvent.click(getAllByText('Keep this')[0]);
    await waitFor(() => expect(get(nav.toast)?.text).toBe('All conflicts resolved'));
    await waitFor(() => expect(queryByText('Buy paint now')).toBeNull());
  });

  it('the computer goes by its Offlog name, and is not listed again under its own name', async () => {
    getSyncHostRecord.mockResolvedValue({ device_id: 'dev:pc', name: 'Test PC' });
    getDeviceLastSeen.mockResolvedValue([
      { device: 'Test PC', id: 'dev:pc', lastSeen: new Date().toISOString() },
      { device: 'Galaxy Tab', id: 'dev:tab', lastSeen: new Date().toISOString() },
    ]);
    const { container, findByText } = render(SettingsPage, { page: 'sync' });
    await findByText('Galaxy Tab');
    expect(container.querySelector('.card')!.textContent).toContain('Test PC');
    expect(container.querySelector('.card')!.textContent).not.toContain('Office PC');
    expect([...container.querySelectorAll('.dev')].map(r => r.textContent!).some(t => t.includes('Test PC'))).toBe(false);
  });

  it('an unreachable computer says what to do, and Try again syncs', async () => {
    Object.assign(m.syncState, { status: 'error', error: 'Cannot reach sync server — it may be switched off' });
    const { getByRole, getByText, container } = render(SettingsPage, { page: 'sync' });
    expect(getByRole('heading', { name: "Can't reach Office PC" })).toBeTruthy();
    expect(getByText(/same Wi-Fi. If they are, Windows Firewall on the computer may be blocking Offlog. Your changes are safe here/)).toBeTruthy();
    expect(container.querySelector('.card.bad')).toBeTruthy();
    await fireEvent.click(getByText('Try again'));
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('any other sync error is shown as it is, with Try again', () => {
    Object.assign(m.syncState, { status: 'error', error: 'Disk is full.' });
    const { getByRole, getByText } = render(SettingsPage, { page: 'sync' });
    expect(getByRole('heading', { name: 'Sync stopped' })).toBeTruthy();
    expect(getByText('Disk is full. Your changes are safe here.')).toBeTruthy();
    expect(getByText('Try again')).toBeTruthy();
  });

  it('a computer that no longer accepts this phone asks to pair again, with the pairing button', async () => {
    (window as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android' };
    Object.assign(m.syncState, { status: 'error', error: 'Your computer no longer accepts this device. Pair it again in Settings → Sync.' });
    const { getByRole, getByText, queryByText } = render(SettingsPage, { page: 'sync' });
    expect(getByRole('heading', { name: 'Pair this phone again' })).toBeTruthy();
    expect(getByText(/Office PC no longer accepts this phone/)).toBeTruthy();
    expect(getByText('Connect to my computer')).toBeTruthy();
    expect(queryByText('Try again')).toBeNull();
  });

  // The page stays open across a pairing (Own server → Connect a device), so
  // what it knows about the computer must follow sync, not the moment it opened.
  it('a page opened on Own server follows a pairing made while it is open', async () => {
    (window as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android' };
    m.uuid = null; m.hub = null;
    const { findByRole, findByText, queryByText } = render(SettingsPage, { page: 'sync' });
    m.uuid = 'h1'; m.hub = 'Office PC';
    Object.assign(m.syncState, { status: 'error', error: 'Your computer no longer accepts this device. Pair it again in Settings → Sync.' });
    m.syncState.listeners.forEach(fn => fn());
    expect(await findByRole('heading', { name: 'Pair this phone again' })).toBeTruthy();
    expect(await findByText(/Office PC no longer accepts this phone/)).toBeTruthy();
    expect(queryByText('Try again')).toBeNull();
  });

  // The card's tone is a class (ok/idle/bad). A rule for that class alone
  // (the pairing sheet's success message was .ok) lands on the card too:
  // tinted, cramped, glued to the Conflicts row. Component CSS isn't applied
  // in jsdom, so the stylesheet itself is checked.
  it('no rule styles a card tone class on its own', () => {
    const src = readFileSync(resolve(__dirname, '../src/lib/phone/settings/SyncPage.svelte'), 'utf8');
    const css = src.slice(src.indexOf('<style>'));
    const bare = css.split('\n').filter(l => /^\s*\.(ok|idle|bad|attn)\s*[{,]/.test(l));
    expect(bare).toEqual([]);
  });

  it('says how many items from the server were refused', () => {
    Object.assign(m.syncState, { rejected: 3 });
    const { getByText } = render(SettingsPage, { page: 'sync' });
    expect(getByText(/Refused 3 items from the sync server/)).toBeTruthy();
    Object.assign(m.syncState, { rejected: 0 });
  });

  it('no server yet: invites pairing, and offers no Sync now', () => {
    m.url = '';
    const { getByRole, queryByText, getByText } = render(SettingsPage, { page: 'sync' });
    expect(getByRole('heading', { name: 'Sync with your computer' })).toBeTruthy();
    expect(queryByText('Sync now')).toBeNull();
    expect(queryByText('Other devices')).toBeNull();
    expect(getByText('Pair from the Android or PC app.')).toBeTruthy();
  });

  it('Name renames this device in a sheet', async () => {
    const { getByText, getByRole } = render(SettingsPage, { page: 'sync' });
    await fireEvent.click(getByRole('button', { name: /^Name/ }));
    const input = getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('Pixel');
    await fireEvent.input(input, { target: { value: '  Work phone ' } });
    await fireEvent.click(getByText('Save'));
    expect(setDeviceName).toHaveBeenCalledWith('  Work phone ');
    await waitFor(() => expect(document.querySelector('.psheet')).toBeNull());
    expect(getByRole('button', { name: /^Name/ }).querySelector('.p-v')!.textContent).toBe('Work phone');
  });

  it('a failed device list load surfaces showError', async () => {
    getDeviceLastSeen.mockRejectedValueOnce(new Error('x'));
    render(SettingsPage, { page: 'sync' });
    await waitFor(() => expect(showError).toHaveBeenCalledWith('Could not load recent devices. Please try again.'));
  });

  it('a sync error keeps the card, and conflicts stay reachable from their own row', async () => {
    m.syncState.conflictCount = 2;
    getConflicts.mockResolvedValue([conflict, { ...conflict, docId: 'task:b' }]);
    Object.assign(m.syncState, { status: 'error', error: 'Disk is full.' });
    const { getByRole, getByText } = render(SettingsPage, { page: 'sync' });
    expect(getByRole('heading', { name: 'Sync stopped' })).toBeTruthy();
    await waitFor(() => getByText('Edited on two devices. Pick which to keep.'));
  });

  it('a conflict opens in a sheet and "Keep this" resolves it after confirming', async () => {
    m.syncState.conflictCount = 1;
    getConflicts.mockResolvedValue([conflict]);
    const { getByText, getAllByText, getByRole, queryByText } = render(SettingsPage, { page: 'sync' });
    // The card itself says so, instead of "Up to date" with a row below.
    await waitFor(() => getByRole('heading', { name: '1 conflict to resolve' }));
    expect(queryByText('Up to date')).toBeNull();
    expect(queryByText('Edited on two devices. Pick which to keep.')).toBeNull();
    await fireEvent.click(getByText('Review conflicts'));
    await waitFor(() => getByText('Buy paint now'));
    confirmAction.mockResolvedValueOnce(false);
    await fireEvent.click(getAllByText('Keep this')[1]);
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(resolveConflict).not.toHaveBeenCalled();
    expect(confirmAction.mock.calls[0][0]).toContain('from PC, "Buy paint now"');
    confirmAction.mockResolvedValueOnce(true);
    await fireEvent.click(getAllByText('Keep this')[1]);
    await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith('task:a', 'other', '3-b', ['3-a', '3-b']));
    resolveConflict.mockRejectedValueOnce(new Error('x'));
    confirmAction.mockResolvedValueOnce(true);
    await fireEvent.click(getAllByText('Keep this')[0]);
    await waitFor(() => expect(showError).toHaveBeenCalledWith('Could not resolve conflict. Please try again.'));
    expect(resolveConflict).toHaveBeenLastCalledWith('task:a', 'current', '', ['3-a', '3-b']);
    // A conflict that changed since it was shown names the reason and reloads.
    const changed = Object.assign(new Error('This conflict changed while it was open'), { name: 'ConflictChangedError' });
    resolveConflict.mockRejectedValueOnce(changed);
    confirmAction.mockResolvedValueOnce(true);
    const loads = getConflicts.mock.calls.length;
    await fireEvent.click(getAllByText('Keep this')[0]);
    await waitFor(() => expect(showError).toHaveBeenCalledWith(changed.message));
    await waitFor(() => expect(getConflicts.mock.calls.length).toBeGreaterThan(loads));
  });

  it('Android, not paired yet: "Connect to my computer" pairs and turns sync on', async () => {
    (window as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android' };
    m.url = ''; m.enabled = false;
    const host = { uuid: 'h1', name: 'Office PC', address: '10.0.0.2', port: 1 };
    const { getByText, getByLabelText } = render(SettingsPage, { page: 'sync' });
    expect(getByText(/Keep this phone and your computer in step/)).toBeTruthy();
    await fireEvent.click(getByText('Connect to my computer'));
    await fireEvent.click(getByText('Find my computer'));
    (discoveredHosts as Writable<unknown[]>).set([host]);
    await waitFor(() => getByText('Connect'));
    await fireEvent.click(getByText('Connect'));
    await fireEvent.input(getByLabelText('Pairing code'), { target: { value: '123456' } });
    m.url = 'http://10.0.0.2:1/offlog';
    await fireEvent.click(getByText('Connect'));
    await waitFor(() => getByText(/Connected to “Office PC”/));
    expect(setSyncEnabled).toHaveBeenLastCalledWith(true);
  });

  it('Android: Connect a device finds the computer and pairs with the code', async () => {
    (window as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android' };
    const host = { uuid: 'h1', name: 'Office PC', address: '10.0.0.2', port: 1 };
    const { getByText, getByLabelText } = render(SettingsPage, { page: 'sync' });
    await fireEvent.click(getByText('Connect a device'));
    await fireEvent.click(getByText('Find my computer'));
    expect(scanForHosts).toHaveBeenCalledTimes(1);
    (discoveredHosts as Writable<unknown[]>).set([host]);
    await waitFor(() => getByText('Connect'));
    await fireEvent.click(getByText('Connect'));
    await fireEvent.input(getByLabelText('Pairing code'), { target: { value: '123456' } });
    m.url = 'http://10.0.0.2:1/offlog';
    await fireEvent.click(getByText('Connect'));
    await waitFor(() => getByText(/Connected to “Office PC”/));
    expect(pairWithHost).toHaveBeenCalledWith(host, '123456');
  });

  it('Android: a failed pairing says why, and after three tries says what to check', async () => {
    (window as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android' };
    const host = { uuid: 'h1', name: 'Office PC', address: '10.0.0.2', port: 1 };
    pairWithHost.mockRejectedValueOnce(new Error('Wrong code.')).mockRejectedValueOnce('x').mockRejectedValueOnce('x');
    const { getByText, getByLabelText, queryByText } = render(SettingsPage, { page: 'sync' });
    await fireEvent.click(getByText('Connect a device'));
    await fireEvent.click(getByText('Find my computer'));
    (discoveredHosts as Writable<unknown[]>).set([host]);
    await waitFor(() => getByText('Connect'));
    await fireEvent.click(getByText('Connect'));
    await fireEvent.input(getByLabelText('Pairing code'), { target: { value: '000000' } });
    await fireEvent.click(getByText('Connect'));
    await waitFor(() => getByText('Wrong code.'));
    await fireEvent.click(getByText('Connect'));
    await waitFor(() => getByText('Could not pair.'));
    await fireEvent.click(getByText('Connect'));
    await waitFor(() => getByText('Could not pair. Double-check the code on the PC screen, or generate a new one there.'));
    expect(pairWithHost).toHaveBeenCalledTimes(3);
    expect(queryByText(/Connected to/)).toBeNull();
  });

  it('a typed-in server shows as Your server, with its own advice when unreachable', () => {
    m.uuid = null;
    Object.assign(m.syncState, { status: 'error', error: 'Cannot reach sync server' });
    const { getByRole, getByText, container } = render(SettingsPage, { page: 'sync' });
    expect(getByRole('heading', { name: "Can't reach your server" })).toBeTruthy();
    expect(getByText(/Check that the server is on and its address is right/)).toBeTruthy();
    expect(container.querySelector('.card')!.textContent).toContain('Your server');
    expect(getByText('In use')).toBeTruthy();
  });

  it('a web build has no Connect row', () => {
    const { queryByText } = render(SettingsPage, { page: 'sync' });
    expect(queryByText('Connect a device')).toBeNull();
  });

  it('Use my own server opens Advanced; a stale paired host is shown in the card', async () => {
    (staleHostAlert as Writable<{ uuid: string; name: string } | null>).set({ uuid: 'u', name: 'Old PC' });
    const { getByText, getByRole } = render(SettingsPage, { page: 'sync' });
    expect(getByRole('heading', { name: "Can't find Office PC" })).toBeTruthy();
    expect(getByText(/“Old PC” is on this network/)).toBeTruthy();
    await fireEvent.click(getByText('Use my own server'));
    expect(get(nav.stack).at(-1)).toMatchObject({ k: 'set', page: 'server' });
  });
});
