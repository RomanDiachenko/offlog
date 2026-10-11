import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/lib/shared/privacyPoints';

// The short privacy page must keep every limit from security.md's "What Offlog
// does not protect against"; a page that only lists the good parts is wrong.
describe('privacy page limits', () => {
  it('names unencrypted sync, unencrypted storage, backups and the missing review', () => {
    const text = LIMITS.map(p => `${p.title} ${p.text}`).join(' ');
    for (const must of ['isn’t encrypted', 'pairing code is short', 'aren’t encrypted on the device', 'no cloud copy', 'plain file', 'No independent security review']) {
      expect(text).toContain(must);
    }
  });
});
