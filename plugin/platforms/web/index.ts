// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The web platform profile (supported): Next.js App Router, Tailwind v4, Vitest and Playwright.

import type { PlatformProfile, ToolRequirement } from '../../kernel/index.ts';
import { commandVersion, components, fixtures, hasChromium, playwrightBrowsersDir, screens, verify } from './adapters.ts';
import { inferLayout, inventory } from './adopt.ts';
import { changeMap } from './map.ts';
import { tests as testRunners } from './runners.ts';
import { checks } from './checks/web.ts';
import { gallery } from './gallery.ts';

export { components, fixtures, screens, verify, routeOf, mockFetchSource, webApp, uiDir, commandVersion, HARNESS_DIR } from './adapters.ts';
export { inferLayout, inventory, normalizeDir } from './adopt.ts';
export { runnerOf, testCommands } from './runners.ts';
export { mapChange, matchRoute } from './map.ts';
export { describeComponent, gallery, galleryCommand } from './gallery.ts';

export const MIN_NODE_MAJOR = 22;

export const tools: ToolRequirement[] = [
  {
    name: 'Node.js',
    neededFor: 'every project: checks, hooks and the token build',
    installedBy: 'user',
    probe() {
      const major = Number.parseInt(process.versions.node.split('.')[0]!, 10);
      return major >= MIN_NODE_MAJOR
        ? { ok: true, version: process.versions.node }
        : { ok: false, version: process.versions.node, fix: `install Node ${MIN_NODE_MAJOR} or newer (LTS), e.g. from nodejs.org` };
    },
  },
  {
    name: 'pnpm',
    neededFor: 'web and Electron workspaces',
    installedBy: 'user',
    probe() {
      const v = commandVersion('pnpm');
      return v ? { ok: true, version: v } : { ok: false, fix: 'install pnpm with its standalone installer: https://pnpm.io/installation' };
    },
  },
  {
    name: 'git',
    neededFor: 'changes, branches and the commit check',
    installedBy: 'user',
    probe() {
      const v = commandVersion('git');
      return v ? { ok: true, version: v.replace('git version ', '') } : { ok: false, fix: 'install git' };
    },
  },
  {
    name: 'Playwright Chromium',
    neededFor: 'end-to-end tests and the verify loop',
    installedBy: 'plugin',
    probe() {
      return hasChromium()
        ? { ok: true, version: playwrightBrowsersDir() }
        : { ok: false, fix: 'in the app folder: pnpm exec playwright install chromium (fwos asks before it runs this)' };
    },
  },
];

export const profile: PlatformProfile = {
  platform: 'web',
  status: 'supported',
  components,
  screens,
  fixtures,
  verify,
  tests: testRunners,
  changeMap,
  inferLayout,
  inventory,
  gallery,
  checks,
  tools,
};
