import { describe, expect, it } from 'vitest';
import { formatExtrasSummary } from '../src/lib/shared/taskHelpers';
import type { TaskDoc } from '../src/lib/types';

// The "More details" summary uses the editor's own words: the block is called
// Steps, and Notes already shows above it, so neither is listed as "notes".
describe('formatExtrasSummary', () => {
  const t = (id: string) => ({ _id: id }) as TaskDoc;
  it('names steps and finished blockers in plain words', () => {
    const [a, b] = formatExtrasSummary('', null, 1, false, [{ text: 'x', done: true }, { text: 'y', done: false }], [], [t('task:b')], 0, [], '');
    const text = `${a} ${b}`;
    expect(text).toContain('1/2 steps');
    expect(text).toContain('blocker done');
    expect(text).not.toContain('(done)');
  });
  it('the empty summary does not offer notes, which sit above it', () => {
    const [a, b] = formatExtrasSummary('', null, 1, false, [], [], [], 0, [], '');
    expect(`${a} ${b}`).not.toMatch(/notes/);
    expect(`${a} ${b}`).toMatch(/steps/);
  });
});
