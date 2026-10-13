import { describe, expect, it } from 'vitest';
import { keepVersionPrompt } from '../src/lib/shared/conflictPrompt';

// The confirm must name the version being kept, not whichever one the
// device happens to show: picking the PC's edit asked about the phone's.
describe('keepVersionPrompt', () => {
  const versions = [
    { rev: '', isCurrent: true, isNewest: false, doc: { _id: 'task:a', _rev: '3-a', type: 'task', source: 'Test phone', title: 'Buy paint (phone edit)' } },
    { rev: '3-b', isCurrent: false, isNewest: true, doc: { _id: 'task:a', _rev: '3-b', type: 'task', source: 'Test PC', title: 'Buy paint (PC edit)' } },
  ];
  const c = { docId: 'task:a', type: 'task', label: 'Buy paint (phone edit)', differing: ['title'], versions };

  it('names the chosen version and the device it came from', () => {
    expect(keepVersionPrompt(c, versions[1])).toBe('Keep the version from Test PC, "Buy paint (PC edit)"? The other version will be discarded permanently.');
    expect(keepVersionPrompt(c, versions[0])).toContain('from Test phone, "Buy paint (phone edit)"');
  });

  it('counts every other version and copes with an unnamed device or an untitled doc', () => {
    const three = { ...c, versions: [...versions, { rev: '3-c', isCurrent: false, isNewest: false, doc: { _id: 'tag:x', _rev: '3-c', type: 'tag_color' } }] };
    expect(keepVersionPrompt(three, three.versions[2])).toBe('Keep the version from an unknown device, "Buy paint (phone edit)"? The other 2 versions will be discarded permanently.');
  });
});
