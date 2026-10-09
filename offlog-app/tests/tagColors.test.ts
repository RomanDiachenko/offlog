import { describe, expect, it } from 'vitest';
import { colourName } from '../src/lib/tagColors';
describe('colourName', () => {
  it('names palette colours for screen readers; anything else is a custom colour', () => {
    expect(colourName('#3b82f6')).toBe('Blue');
    expect(colourName('#EF4444')).toBe('Red');
    expect(colourName('#123456')).toBe('Custom color');
  });
});
