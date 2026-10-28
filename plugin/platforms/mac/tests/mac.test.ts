// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { profile } from '../index.ts';

describe('the Mac profile', () => {
  it('reports that it is not in this release, and says why and what still works', () => {
    expect(profile.platform).toBe('mac');
    expect(profile.status).toBe('unavailable');
    expect(profile.statusReason).toBe(
      'Not built in this release. You can plan a native Mac app (brief, research, architecture, spec, test plan), and fwos builds the web app.',
    );
    expect(profile.checks).toEqual([]);
  });

  it('still reports Xcode, so doctor can say what a Mac build will need', () => {
    expect(profile.tools.map((t) => t.name)).toEqual(['Xcode']);
    const probe = profile.tools[0]!.probe();
    if (probe.ok) expect(probe.version).toMatch(/Xcode/);
    else expect(probe.fix).toMatch(process.platform === 'darwin' ? /install Xcode/ : /need a Mac/);
  });
});
