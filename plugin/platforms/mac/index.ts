// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The native Mac (SwiftUI) platform profile. Not built in this release. The spec and test plan
// already cover it, and doctor reports Xcode so you know what a Mac build will need.

import { execFileSync } from 'node:child_process';
import type { PlatformProfile } from '../../kernel/index.ts';

function xcodeVersion(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    return execFileSync('xcodebuild', ['-version'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).toString().split('\n')[0]!.trim();
  } catch {
    return null;
  }
}

export const profile: PlatformProfile = {
  platform: 'mac',
  status: 'unavailable',
  statusReason: 'Not built in this release. You can plan a native Mac app (brief, research, architecture, spec, test plan), and fwos builds the web app.',
  checks: [],
  tools: [
    {
      name: 'Xcode',
      neededFor: 'native Mac builds and XCTest/XCUITest',
      installedBy: 'user',
      probe() {
        if (process.platform !== 'darwin') return { ok: false, fix: 'Mac builds need a Mac, or a macOS CI runner' };
        const v = xcodeVersion();
        return v ? { ok: true, version: v } : { ok: false, fix: 'install Xcode from the App Store, then: sudo xcode-select -s /Applications/Xcode.app' };
      },
    },
  ],
};
