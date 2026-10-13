import { describe, expect, it } from 'vitest';
import { isBackupDue, filesToDelete, getAutoBackupUsage, autoBackupTime, readAutoBackup } from '../src/lib/autoBackup';

describe('isBackupDue', () => {
  it('is due when never run before', () => {
    expect(isBackupDue(null, new Date())).toBe(true);
  });

  it('is not due less than ~20h after the last run', () => {
    const now = new Date('2026-07-23T12:00:00.000Z');
    const last = new Date('2026-07-23T00:00:00.000Z').toISOString(); // 12h ago
    expect(isBackupDue(last, now)).toBe(false);
  });

  it('is due once ~20h have passed', () => {
    const now = new Date('2026-07-23T20:01:00.000Z');
    const last = new Date('2026-07-23T00:00:00.000Z').toISOString(); // 20h1m ago
    expect(isBackupDue(last, now)).toBe(true);
  });

  it('treats a corrupted/unparseable last-run value as never run', () => {
    expect(isBackupDue('not-a-date', new Date())).toBe(true);
  });
});

describe('filesToDelete', () => {
  it('deletes nothing when under the keep count', () => {
    const files = ['offlog-autobackup-2026-07-21.json', 'offlog-autobackup-2026-07-22.json'];
    expect(filesToDelete(files, 7)).toEqual([]);
  });

  it('deletes only the oldest excess files, keeping the newest N', () => {
    const files = [
      'offlog-autobackup-2026-07-17T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-18T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-19T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-20T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-21T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-22T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-23T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-24T00-00-00-000Z.json',
    ];
    const result = filesToDelete(files, 7);
    expect(result).toEqual(['offlog-autobackup-2026-07-17T00-00-00-000Z.json']);
  });

  it('is order-independent -- unsorted input still deletes the oldest', () => {
    const files = [
      'offlog-autobackup-2026-07-22T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-19T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-21T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-20T00-00-00-000Z.json',
    ];
    expect(filesToDelete(files, 2)).toEqual([
      'offlog-autobackup-2026-07-19T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-20T00-00-00-000Z.json',
    ]);
  });

  it('rotates out a backup dated in the future first', () => {
    const files = [
      'offlog-autobackup-2031-01-01T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-21T00-00-00-000Z.json',
      'offlog-autobackup-2026-07-22T00-00-00-000Z.json',
    ];
    expect(filesToDelete(files, 2, new Date('2026-07-22T12:00:00Z'))).toEqual(['offlog-autobackup-2031-01-01T00-00-00-000Z.json']);
  });
});

describe('getAutoBackupUsage', () => {
  it('reports nothing on a platform that keeps no backups', async () => {
    // Neither Tauri nor Capacitor here, so there is no backup folder to
    // measure. It must return null rather than a confident zero -- the
    // Settings section stays silent instead of claiming backups take no
    // space when the truth is that none are kept at all.
    await expect(getAutoBackupUsage()).resolves.toBeNull();
  });
});

describe('kept copies', () => {
  it('reads the moment a copy was written back out of its name', () => {
    const at = new Date('2026-10-14T00:18:53.123Z');
    const name = `offlog-autobackup-${at.toISOString().replace(/[:.]/g, '-')}.json`;
    expect(autoBackupTime(name)).toBe(at.toISOString());
  });

  it('refuses anything that is not a copy\'s own name before touching the file system', async () => {
    for (const bad of ['../sync-secret.enc', 'offlog-autobackup-2026-10-14T00-18-53-123Z.json/../x', 'notes.json', '']) {
      expect(autoBackupTime(bad)).toBeNull();
      await expect(readAutoBackup(bad)).rejects.toThrow('not an automatic backup');
    }
  });
});
