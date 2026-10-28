// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The verify driver's render, short of a browser: what it says when the app can't start. The real
// run, Next.js and Chromium included, is in scripts/tests/e2e.test.ts (`pnpm test:e2e`).

import { afterAll, describe, expect, it } from 'vitest';
import { loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, minimalState, tempProject } from '../../../kernel/testing.ts';
import { verify } from '../adapters.ts';

afterAll(cleanupTempProjects);

const fixture = { kind: 'page', id: 'home', state: 'ready' } as const;
const path = '/fwos-screens/home?state=ready';
const app = (files: Record<string, string | object> = {}) =>
  loadProject(tempProject({ '.fwos/state.json': minimalState(), 'apps/web/package.json': { name: 'web' }, ...files }));

describe('the web verify driver renders a state fixture', () => {
  it("finds each state's fixture where the app renders it: the screens browser, else the gallery, else nowhere", () => {
    const COMPONENTS = 'apps/web/app/(fwos-screens)/fwos-screens/components/[componentId]/page.tsx';
    const GALLERY = 'apps/web/app/(fwos-screens)/fwos-screens/fwos-gallery/page.tsx';
    const PAGES = 'apps/web/app/(fwos-screens)/fwos-screens/[pageId]/page.tsx';
    const scaffolded = app({ [COMPONENTS]: 'export default function C() { return null; }\n', [PAGES]: 'export default function P() { return null; }\n' });
    expect(verify.fixture!(scaffolded, { kind: 'page', id: 'list', state: 'filtered empty' })).toBe('/fwos-screens/list?state=filtered%20empty');
    expect(verify.fixture!(scaffolded, { kind: 'component', id: 'button', state: 'loading' })).toBe('/fwos-screens/components/button?state=loading');
    // An app with no screens browser of its own, such as an adopted one, renders component states in the gallery.
    const adopted = app({ [GALLERY]: 'export default function G() { return null; }\n' });
    expect(verify.fixture!(adopted, { kind: 'component', id: 'button', state: 'disabled' })).toBe('/fwos-screens/fwos-gallery?fixture=button&state=disabled');
    expect(verify.fixture!(adopted, { kind: 'page', id: 'list', state: 'ready' })).toBeNull();
    expect(verify.fixture!(app(), { kind: 'component', id: 'button', state: 'disabled' })).toBeNull();
  });

  it("says what's missing when Next.js or Playwright isn't installed, and starts nothing", async () => {
    expect(await verify.render!(app(), { fixture, path })).toEqual({ ok: false, reason: "next isn't installed in apps/web (run pnpm install)" });
    const withNext = app({ 'apps/web/node_modules/next/package.json': { name: 'next', version: '16.4.0' } });
    expect(await verify.render!(withNext, { fixture, path })).toEqual({ ok: false, reason: "@playwright/test isn't installed in apps/web (run pnpm install)" });
  });

  it('names the last thing the app said when it stops before it is up', async () => {
    const p = app({
      'apps/web/node_modules/next/package.json': { name: 'next', version: '16.4.0' },
      'apps/web/node_modules/next/dist/bin/next': "console.error('Error: the app needs DATABASE_URL');\nprocess.exit(1);\n",
      'apps/web/node_modules/@playwright/test/package.json': { name: '@playwright/test', main: 'index.js' },
      'apps/web/node_modules/@playwright/test/index.js': 'module.exports = {};\n',
    });
    expect(await verify.render!(p, { fixture, path })).toEqual({ ok: false, reason: "the app stopped before it was up (exit 1): Error: the app needs DATABASE_URL" });
  });

  it("uses an app that's already running at a URL instead of starting one, and says when nothing answers there", async () => {
    const p = app({
      'apps/web/node_modules/next/package.json': { name: 'next', version: '16.4.0' },
      'apps/web/node_modules/@playwright/test/package.json': { name: '@playwright/test', main: 'index.js' },
      'apps/web/node_modules/@playwright/test/index.js': 'module.exports = {};\n',
    });
    expect(await verify.render!(p, { fixture, path, url: 'http://127.0.0.1:9' })).toMatchObject({ ok: false, reason: expect.stringMatching(/^nothing answered at http:\/\/127\.0\.0\.1:9/) });
  });
});
