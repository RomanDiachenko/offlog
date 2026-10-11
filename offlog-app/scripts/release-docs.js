// Text edits that `version.js prepare` makes to the release docs, kept pure
// (string in, string out) so tests can run them without touching files.
//
// changelog.md keeps the newest KEEP releases in full; the oldest beyond
// that moves to archive/history.md as one table row. Its compare-link list
// at the end of the file must lose and gain links in step with the entries,
// or version:check fails on the next release.

export const KEEP = 10;
export const PLAY_LIMIT = 500;
const REPO = 'https://github.com/hrach-gevorgyan/offlog';

const lf = s => s.replace(/\r\n/g, '\n');
const LINK = /^\[\d+\.\d+\.\d+\]:/;

export function addChangelogEntry(md, version, prev, date) {
  let s = lf(md);
  const first = s.indexOf('\n## [');
  if (first < 0) throw new Error('changelog.md: no "## [" entry to insert above');
  const entry = `## [${version}] — ${date}\n\nTODO: one paragraph on what this release is, then Added / Changed / Fixed / Security.\n\n`;
  s = s.slice(0, first + 1) + entry + s.slice(first + 1);

  const lines = s.split('\n');
  const at = lines.findIndex(l => LINK.test(l));
  const link = `[${version}]: ${REPO}/compare/v${prev}...v${version}`;
  if (at < 0) lines.push(link); else lines.splice(at, 0, link);
  s = lines.join('\n');

  return rotate(s);
}

// Moves entries past KEEP out, oldest first. Returns the archived ones so
// the caller can write their rows to history.md.
function rotate(s) {
  const archived = [];
  for (;;) {
    const starts = [...s.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)];
    if (starts.length <= KEEP) break;
    const last = starts[starts.length - 1];
    const linksAt = s.search(/^\[\d+\.\d+\.\d+\]:/m);
    const end = linksAt < 0 ? s.length : linksAt;
    // The entry runs to the link list, minus the --- separators before it.
    const body = s.slice(last.index, end).replace(/(\n---\s*)+$/, '').trimEnd();
    archived.push({ version: last[1], text: body });
    let head = s.slice(0, last.index).replace(/(\n---\s*)+$/, '').trimEnd();
    const tail = s.slice(end);
    s = head + '\n\n---\n\n' + tail;
    s = s.split('\n').filter(l => !l.startsWith(`[${last[1]}]:`)).join('\n');
  }
  return { md: s, archived };
}

// One-line summary for history.md: the entry's opening paragraph if it has
// one, else its first bullet. Meant to be read and tightened by a person.
export function archiveRow({ version, text }) {
  const paras = text.split(/\n\s*\n/).slice(1).map(p => p.trim());
  const intro = paras.find(p => p && !p.startsWith('#') && !p.startsWith('-'));
  const bullet = paras.flatMap(p => p.split('\n')).find(l => l.startsWith('- '));
  const raw = intro ?? (bullet ? bullet.slice(2) : '');
  // Backslashes first: escaping only | would let a summary's own "\|" undo it.
  const summary = raw.replace(/\s+/g, ' ').replace(/\*\*/g, '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').trim();
  return `| v${version} | ${summary} |`;
}

export function addArchiveRows(history, rows) {
  const s = lf(history);
  const head = '| Release | Summary |\n|---|---|\n';
  const at = s.indexOf(head);
  if (at < 0) throw new Error('history.md: no "| Release | Summary |" table');
  const cut = at + head.length;
  return s.slice(0, cut) + rows.map(r => r + '\n').join('') + s.slice(cut);
}

export function addReleaseNotesEntry(md, version) {
  const s = lf(md);
  const first = s.indexOf('\n## v');
  if (first < 0) throw new Error('release-notes.md: no "## v" entry to insert above');
  const entry = `## v${version}\n\n### In short\n\nTODO: under ${PLAY_LIMIT} characters, for Google Play's "What's new".\n\n### New\n- TODO\n\n### Fixed\n- TODO\n\n`;
  return s.slice(0, first + 1) + entry + s.slice(first + 1);
}

// The text of one release's entry, heading included, up to the next entry.
export function entryText(md, heading) {
  const s = lf(md);
  const at = s.indexOf(heading + '\n') >= 0 ? s.indexOf(heading + '\n') : s.indexOf(heading + ' ');
  if (at < 0) return null;
  const next = s.slice(at + heading.length).search(/\n## /);
  return next < 0 ? s.slice(at) : s.slice(at, at + heading.length + next);
}

export function inShort(md, version) {
  const entry = entryText(md, `## v${version}`);
  const m = entry && /### In short\n+([\s\S]*?)\n\n/.exec(entry + '\n\n');
  return m ? m[1] : null;
}
