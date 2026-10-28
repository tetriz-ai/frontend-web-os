// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The Electron platform profile. Not built in this release.
// Discovery, research, architecture, the spec and the test plan already cover it, so a user can
// plan an Electron app today; building one waits for this profile's adapters.

import type { PlatformProfile } from '../../kernel/index.ts';

export const profile: PlatformProfile = {
  platform: 'electron',
  status: 'unavailable',
  statusReason: 'Not built in this release. You can plan an Electron app (brief, research, architecture, spec, test plan), and fwos builds the web app.',
  checks: [],
  tools: [],
};
