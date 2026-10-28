// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Ajv's resolver is compiled into the CLI even though Ajv is a build dependency.
const requireFromAjv = createRequire(import.meta.resolve('ajv'));
const uri = requireFromAjv('fast-uri') as { normalize: (input: string) => string };

describe('the bundled schema resolver', () => {
  it.each(['%6Aavascript:alert(1)', '%u006Aavascript:alert(1)'])('does not activate a percent-encoded scheme: %s', (input) => {
    expect(uri.normalize(input)).not.toBe('javascript:alert(1)');
  });

  it('preserves the parent directory in a relative reference', () => {
    expect(uri.normalize('../x')).toBe('../x');
  });
});
