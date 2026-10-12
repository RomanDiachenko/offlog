import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/lib/shared/privacyPoints';

// The short privacy page must keep every limit from security.md's "What Offlog
// does not protect against"; a page that only lists the good parts is wrong.
describe('privacy page limits', () => {
  it('names the unencrypted connection, the open server, unencrypted storage, backups, update checks and the missing review', () => {
    const text = LIMITS.map(p => `${p.title} ${p.text}`).join(' ');
    for (const must of ['connection isn’t encrypted', 'pairing code is short', 'open to your Wi-Fi', 'plain text', 'IP address', 'aren’t encrypted on the device', 'no cloud copy', 'plain file', 'No independent security review']) {
      expect(text).toContain(must);
    }
  });
});
