import { describe, expect, it } from 'vitest';
import { checkLink } from '@/features/reading-list';

// TC-reading-4: the link rule accepts only http and https web addresses.

const EMPTY = 'Enter the link you want to save.';
const INVALID = 'Enter a web address that starts with http:// or https://.';

describe('the link rule', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['  http://example.com  ', 'http://example.com'],
  ])('accepts %j as %j @AC-reading-3', (raw, url) => {
    expect(checkLink(raw)).toEqual({ ok: true, url });
  });

  it.each(['', '   '])('asks for a link when the value is %j @AC-reading-3', (raw) => {
    expect(checkLink(raw)).toEqual({ ok: false, message: EMPTY });
  });

  it.each(['example.com/page', 'ftp://example.com/file', 'javascript:alert(1)', 'https://'])(
    'refuses %j as not a web address @AC-reading-3',
    (raw) => {
      expect(checkLink(raw)).toEqual({ ok: false, message: INVALID });
    },
  );
});
