import { describe, expect, it } from 'vitest';
import * as docs from '../scripts/release-docs.js';

const { addChangelogEntry, archiveRow, addArchiveRows, addReleaseNotesEntry, entryText, inShort, KEEP } = docs;

const link = (v: string, p: string) => `[${v}]: https://github.com/hrach-gevorgyan/offlog/compare/v${p}...v${v}`;

function changelog(count: number) {
  const vs = Array.from({ length: count }, (_, i) => `1.${count - i}.0`);
  const entries = vs.map(v => `## [${v}] — 2026-01-01\n\nIntro of ${v}.\n\n### Fixed\n- **Bullet of ${v}.** More.\n`);
  const links = vs.map((v, i) => link(v, vs[i + 1] ?? '1.0.0'));
  return `# Changelog\n\nHeader.\n\n---\n\n${entries.join('\n')}\n---\n\n${links.join('\n')}\n`;
}

describe('addChangelogEntry', () => {
  it('puts the new entry above the newest and its compare link first', () => {
    const { md, archived } = addChangelogEntry(changelog(3), '1.4.0', '1.3.0', '2026-10-04');
    expect(archived).toEqual([]);
    expect(md.indexOf('## [1.4.0] — 2026-10-04')).toBeLessThan(md.indexOf('## [1.3.0]'));
    expect(md.indexOf('## [1.4.0]')).toBeGreaterThan(md.indexOf('Header.'));
    const links = md.split('\n').filter(l => l.startsWith('[1.'));
    expect(links[0]).toBe(link('1.4.0', '1.3.0'));
    expect(links).toHaveLength(4);
  });

  it(`keeps ${KEEP} entries: the oldest moves out with its compare link`, () => {
    const { md, archived } = addChangelogEntry(changelog(KEEP), '1.11.0', '1.10.0', '2026-10-04');
    expect(archived.map((a: { version: string }) => a.version)).toEqual(['1.1.0']);
    expect(archived[0].text).toContain('Intro of 1.1.0.');
    expect(archived[0].text).not.toContain(']: https');
    expect(md.match(/^## \[/gm)).toHaveLength(KEEP);
    expect(md).not.toContain('## [1.1.0]');
    expect(md).not.toContain('[1.1.0]:');
    expect(md).toContain('Intro of 1.2.0.');
    // The link list stays a list, behind one separator.
    expect(md).toMatch(/\n- \*\*Bullet of 1\.2\.0\.\*\* More\.\n\n---\n\n\[1\.11\.0\]:/);
  });

  it('reads Windows line endings', () => {
    const { md } = addChangelogEntry(changelog(2).replace(/\n/g, '\r\n'), '1.3.0', '1.2.0', '2026-10-04');
    expect(md).toContain('## [1.3.0] — 2026-10-04');
    expect(md).not.toContain('\r');
  });
});

describe('archiveRow', () => {
  it('uses the opening paragraph', () => {
    expect(archiveRow({ version: '1.1.0', text: '## [1.1.0] — d\n\nWhat it was.\nAll of it.\n\n### Fixed\n- x' }))
      .toBe('| v1.1.0 | What it was. All of it. |');
  });
  it('falls back to the first bullet, without bold and with pipes escaped', () => {
    expect(archiveRow({ version: '1.1.0', text: '## [1.1.0] — d\n\n### Fixed\n- **A | B** fixed' }))
      .toBe('| v1.1.0 | A \\| B fixed |');
  });
  it('lands at the top of the history table', () => {
    const out = addArchiveRows('# H\n\n| Release | Summary |\n|---|---|\n| v1.0.0 | old |\n', ['| v1.1.0 | new |']);
    expect(out).toContain('|---|---|\n| v1.1.0 | new |\n| v1.0.0 | old |');
  });
});

describe('release notes', () => {
  const notes = '# Notes\n\n---\n\n## v1.2.0\n\n### In short\n\nOld summary.\n\n### Fixed\n- x\n';

  it('adds a TODO entry above the newest, scoped so the older entry stays clean', () => {
    const md = addReleaseNotesEntry(notes, '1.3.0');
    expect(md.indexOf('## v1.3.0')).toBeLessThan(md.indexOf('## v1.2.0'));
    expect(entryText(md, '## v1.3.0')).toContain('TODO');
    expect(entryText(md, '## v1.2.0')).not.toContain('TODO');
  });

  it('measures In short for the Play limit', () => {
    expect(inShort(notes, '1.2.0')).toBe('Old summary.');
    expect(inShort(notes, '9.9.9')).toBeNull();
  });

  it('reads In short from the asked-for release, not the newest', () => {
    const two = notes.replace('## v1.2.0', '## v1.3.0\n\n### In short\n\nNewer summary.\n\n## v1.2.0');
    expect(inShort(two, '1.3.0')).toBe('Newer summary.');
    expect(inShort(two, '1.2.0')).toBe('Old summary.');
  });
});
