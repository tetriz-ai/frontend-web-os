// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { profile } from '../index.ts';

describe('the Electron profile', () => {
  it('reports that it is not in this release, and says why and what still works', () => {
    expect(profile.platform).toBe('electron');
    expect(profile.status).toBe('unavailable');
    expect(profile.statusReason).toBe(
      'Not built in this release. You can plan an Electron app (brief, research, architecture, spec, test plan), and fwos builds the web app.',
    );
    expect(profile.checks).toEqual([]);
    expect(profile.tools).toEqual([]);
  });
});
