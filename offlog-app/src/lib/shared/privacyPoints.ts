// The short privacy page both shells show (phone Settings → Advanced →
// Privacy, desktop Settings → Privacy): the plain version of docs/privacy.md
// and of security.md's "What Offlog does not protect against". Change them
// together. These are the limits that matter in everyday use; the rarer
// technical ones stay in security.md, which the policy links. None of these
// may be dropped or softened to look better (tests/privacyPoints.test.ts).
import type { ICON } from './iconPaths';

export const REPO_URL = 'https://github.com/hrach-gevorgyan/offlog';
export const PRIVACY_URL = `${REPO_URL}/blob/main/docs/privacy.md`;

export interface PrivacyPoint { icon: keyof typeof ICON; title: string; text: string }

export const PRIVATE: PrivacyPoint[] = [
  { icon: 'shield', title: 'Nothing is collected', text: 'No account, no analytics, no crash reports, no ads.' },
  { icon: 'device', title: 'Your tasks stay on your devices', text: 'In the app’s own storage. Automatic backups stay on the device too.' },
  { icon: 'sync', title: 'Sync goes only where you say', text: 'To your own computer, end-to-end encrypted, or to your own server. Never to us, never to a cloud.' },
  { icon: 'bell', title: 'Notifications are set on the device', text: 'The system shows them; nothing goes through a server.' },
  { icon: 'offline', title: 'Works without the internet', text: 'Everything works offline; the internet is never needed.' },
  { icon: 'code', title: 'Anyone can check', text: 'Offlog is open source, so everything on this page can be verified.' },
];

export const LIMITS: PrivacyPoint[] = [
  { icon: 'wifi', title: 'Sync is made for your home Wi-Fi', text: 'With your computer, your tasks are encrypted end to end. With your own server they aren’t. The connection isn’t encrypted, the pairing code is short, and the sync server is open to your Wi-Fi behind one password, which the PC stores as plain text. Pair and sync only on a network you trust.' },
  { icon: 'lock', title: 'Tasks aren’t encrypted on the device', text: 'App lock hides the app; it doesn’t encrypt it. Your phone’s or PC’s own disk encryption protects the data.' },
  { icon: 'backup', title: 'Backups are up to you', text: 'There is no cloud copy, and an exported backup is a plain file. Export now and then, and keep the file private.' },
  { icon: 'globe', title: 'The Windows app checks for updates', text: 'It asks GitHub whether a newer version exists, which shows GitHub your IP address. You can turn it off in Settings → Advanced.' },
  { icon: 'person', title: 'No independent security review', text: 'Offlog is made and checked by one person.' },
];
