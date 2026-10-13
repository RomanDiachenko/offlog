import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    rmdir: vi.fn(async (o: { path: string }) => { calls.push(`rmdir ${o.path}`); }),
    writeFile: vi.fn(async (o: { path: string }) => { calls.push(`write ${o.path}`); return { uri: `file:///cache/${o.path}` }; }),
  },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(async (o: { url: string }) => { calls.push(`share ${o.url}`); }) } }));

import { shareViaCache } from '../src/lib/shared/shareFile';

describe('shareViaCache', () => {
  it('empties the share folder before writing, so earlier plain-text copies do not pile up', async () => {
    await shareViaCache('offlog-backup.json', '[]', true);
    expect(calls).toEqual(['rmdir share', 'write share/offlog-backup.json', 'share file:///cache/share/offlog-backup.json']);
  });
});
