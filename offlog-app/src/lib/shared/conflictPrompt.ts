import type { ConflictInfo, ConflictVersion } from '../db';

// The confirm before keeping one version of a conflict, for both shells. It
// names the version being kept and its device: the doc's own label is
// whichever version this device happens to show, which reads as the wrong
// choice when the other one was picked. Every other version is discarded,
// including any the screen isn't showing side by side, so it counts them.
export function keepVersionPrompt(c: ConflictInfo, v: ConflictVersion): string {
  const losing = c.versions.length - 1;
  const title = v.doc.title ?? v.doc.name ?? c.label;
  return `Keep the version from ${v.doc.source ?? 'an unknown device'}, "${title}"? The other ${losing === 1 ? 'version' : `${losing} versions`} will be discarded permanently.`;
}
