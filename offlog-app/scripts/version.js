#!/usr/bin/env node
// Single source of truth for the release version.
//
//   node scripts/version.js check          verify everything agrees
//   node scripts/version.js check --tag v6.5.0   also verify a tag matches
//   node scripts/version.js set 6.6.0      write it everywhere
//   node scripts/version.js prepare 6.6.0  set, plus TODO entries in both
//                                          release docs, archive rotation,
//                                          the compare link, and the commits
//                                          since the last tag to write from
//
// The version lives in three files and a git tag, and two docs must carry
// an entry for it. Keeping six places in sync by memory is what let
// releases ship documented-but-never-tagged and let versionCode drift
// from versionName -- so this is a gate, not a convenience.
//
// Policy (docs/decisions.md):
//   MAJOR  an older install can no longer read, sync or restore -- document
//          schema, storage format, backup format, or a required migration.
//          Features are never MAJOR, however large.
//   MINOR  a user-visible capability.
//   PATCH  a fix or maintenance work, no new capability.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { addChangelogEntry, archiveRow, addArchiveRows, addReleaseNotesEntry, entryText, inShort, PLAY_LIMIT } from './release-docs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = path.resolve(ROOT, '..', 'offlog-desktop');

const PKG = path.join(ROOT, 'package.json');
// npm copies package.json's version into the lockfile twice (top level and
// packages[""]) and rewrites it only on its next install, so it lagged a
// release behind unless set here too.
const LOCK = path.join(ROOT, 'package-lock.json');
const GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle');
const TAURI = path.join(DESKTOP, 'src-tauri', 'tauri.conf.json');
const CHANGELOG = path.resolve(ROOT, '..', 'docs', 'changelog.md');
const RELEASE_NOTES = path.resolve(ROOT, '..', 'docs', 'release-notes.md');
const HISTORY = path.resolve(ROOT, '..', 'docs', 'archive', 'history.md');
const MAINTENANCE = path.resolve(ROOT, '..', 'docs', 'maintenance.md');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

// versionCode must never decrease -- Play rejects that permanently, so the
// formula is fixed for good. It also has to clear every code already
// published by hand (highest was 117), which 1.0.0 -> 10000 does.
// MINOR and PATCH are capped at 99 by the multipliers.
function versionCodeFor(v) {
  const m = SEMVER.exec(v);
  if (!m) throw new Error(`not a semver version: ${v}`);
  const [, major, minor, patch] = m.map(Number);
  if (minor > 99 || patch > 99) {
    throw new Error(`${v}: MINOR and PATCH must stay under 100 for the versionCode formula`);
  }
  return major * 10000 + minor * 100 + patch;
}

const read = f => fs.readFileSync(f, 'utf8');

function currentVersions() {
  const gradle = read(GRADLE);
  const nameMatch = /versionName\s+"([^"]+)"/.exec(gradle);
  const codeMatch = /versionCode\s+(\d+)/.exec(gradle);
  if (!nameMatch || !codeMatch) throw new Error('could not read versionName/versionCode from build.gradle');
  return {
    pkg: JSON.parse(read(PKG)).version,
    gradleName: nameMatch[1],
    gradleCode: Number(codeMatch[1]),
    tauri: JSON.parse(read(TAURI)).version,
    lock: JSON.parse(read(LOCK)).version,
    lockRoot: JSON.parse(read(LOCK)).packages?.['']?.version,
  };
}

function check(expectedTag) {
  const v = currentVersions();
  const errors = [];

  if (!SEMVER.test(v.pkg)) {
    errors.push(`package.json version "${v.pkg}" is not MAJOR.MINOR.PATCH`);
  }
  if (v.gradleName !== v.pkg) {
    errors.push(`android versionName "${v.gradleName}" != package.json "${v.pkg}"`);
  }
  if (v.tauri !== v.pkg) {
    errors.push(`tauri.conf.json version "${v.tauri}" != package.json "${v.pkg}"`);
  }
  if (v.lock !== v.pkg || v.lockRoot !== v.pkg) {
    errors.push(`package-lock.json version "${v.lock}" / "${v.lockRoot}" != package.json "${v.pkg}"`);
  }
  if (SEMVER.test(v.pkg)) {
    const expected = versionCodeFor(v.pkg);
    if (v.gradleCode !== expected) {
      errors.push(`android versionCode ${v.gradleCode} != ${expected} (derived from ${v.pkg})`);
    }
  }

  const changelog = read(CHANGELOG);
  if (!changelog.includes(`## [${v.pkg}]`)) {
    errors.push(`docs/changelog.md has no "## [${v.pkg}]" entry`);
  }
  // Identity match by string, shape match by a fixed pattern -- never
  // build a regex out of the version. Escaping only '.' leaves every
  // other metacharacter live, and check() reports a malformed version
  // rather than returning, so a bad value does reach this line.
  const hasCompareLink = changelog.split('\n').some(
    l => l.startsWith(`[${v.pkg}]:`) && /^\[[^\]]+\]:\s*https?:\/\//.test(l));
  if (!hasCompareLink) {
    errors.push(`docs/changelog.md has no [${v.pkg}]: compare link`);
  }
  const notes = read(RELEASE_NOTES);
  if (!notes.includes(`## v${v.pkg}`)) {
    errors.push(`docs/release-notes.md has no "## v${v.pkg}" entry`);
  } else {
    const short = inShort(notes, v.pkg);
    if (short === null) errors.push(`docs/release-notes.md v${v.pkg} has no "### In short" block`);
    else if (short.length > PLAY_LIMIT) errors.push(`release notes "In short" is ${short.length} characters; Google Play takes ${PLAY_LIMIT}`);
  }
  for (const [file, text, heading] of [['changelog.md', changelog, `## [${v.pkg}]`], ['release-notes.md', notes, `## v${v.pkg}`]]) {
    if (entryText(text, heading)?.includes('TODO')) errors.push(`docs/${file} v${v.pkg} entry still has a TODO`);
  }

  if (expectedTag !== undefined) {
    if (expectedTag !== `v${v.pkg}`) {
      errors.push(`tag ${expectedTag} does not match version v${v.pkg}`);
    }
  }

  if (errors.length) {
    console.error(`version check FAILED (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`version ${v.pkg} consistent (versionCode ${v.gradleCode}, changelog + release notes present)`);
}

function set(next) {
  if (!SEMVER.test(next)) {
    console.error(`"${next}" is not MAJOR.MINOR.PATCH`);
    process.exit(1);
  }
  const v = currentVersions();
  const cmp = (a, b) => {
    const [x, y] = [a, b].map(s => SEMVER.exec(s).slice(1, 4).map(Number));
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };
  if (SEMVER.test(v.pkg) && cmp(next, v.pkg) <= 0) {
    console.error(`${next} is not higher than the current ${v.pkg}`);
    process.exit(1);
  }
  const code = versionCodeFor(next);

  const pkg = JSON.parse(read(PKG));
  pkg.version = next;
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');

  fs.writeFileSync(GRADLE, read(GRADLE)
    .replace(/versionCode\s+\d+/, `versionCode ${code}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${next}"`));

  const tauri = JSON.parse(read(TAURI));
  tauri.version = next;
  fs.writeFileSync(TAURI, JSON.stringify(tauri, null, 2) + '\n');

  const lock = JSON.parse(read(LOCK));
  lock.version = next;
  if (lock.packages?.['']) lock.packages[''].version = next;
  fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');

  console.log(`set ${v.pkg} -> ${next} (versionCode ${code})`);
  return v.pkg;
}

function prepare(next) {
  const prev = set(next);
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const { md, archived } = addChangelogEntry(read(CHANGELOG), next, prev, date);
  fs.writeFileSync(CHANGELOG, md);
  if (archived.length) {
    fs.writeFileSync(HISTORY, addArchiveRows(read(HISTORY), archived.map(archiveRow)));
    console.log(`archived ${archived.map(a => a.version).join(', ')} to docs/archive/history.md (read its row once)`);
  }
  fs.writeFileSync(RELEASE_NOTES, addReleaseNotesEntry(read(RELEASE_NOTES), next));
  console.log(`added TODO entries for ${next} to docs/changelog.md and docs/release-notes.md`);

  const due = /Next pass due:\s*([\s\S]*?\.)\*\*/.exec(read(MAINTENANCE));
  if (due) console.log(`maintenance pass due: ${due[1].replace(/\*\*/g, '').replace(/\s+/g, ' ')}`);

  try {
    const log = execFileSync('git', ['log', '--no-merges', '--format=%s', `v${prev}..HEAD`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    console.log(`\ncommits since v${prev} to write the entries from:\n${log}`);
  } catch { console.log(`(no tag v${prev} to list commits from)`); }
  console.log('next: replace every TODO, then version:check');
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'check') {
  const i = rest.indexOf('--tag');
  check(i === -1 ? undefined : rest[i + 1]);
} else if (cmd === 'set') {
  set(rest[0]);
  console.log('next: add the docs/changelog.md and docs/release-notes.md entries, then run version:check');
} else if (cmd === 'prepare') {
  prepare(rest[0]);
} else {
  console.error('usage: version.js check [--tag vX.Y.Z] | version.js set X.Y.Z | version.js prepare X.Y.Z');
  process.exit(1);
}
