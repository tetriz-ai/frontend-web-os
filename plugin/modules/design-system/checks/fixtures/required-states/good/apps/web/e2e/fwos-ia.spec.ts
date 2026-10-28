// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// fwos's IA harness. fwos writes this file and `fwos check` only counts runs of its own copy, so
// don't edit it: `fwos harness` puts it back. As every role in docs/app/ia.json, with every setting
// of the flags its pages use, it opens every static route and reads the nav, and hands what it saw
// to `fwos harness record`, which compares it with ia.json and keeps the run, tied to this code, for
// `fwos check`. The app takes the role and flags from a test cookie only while FWOS_TEST_ACCESS=1.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';

interface Run {
  key: string;
  role: string;
  flags: string[];
}

/**
 * The fwos CLI this app pins (the fwos-check package), run with this Node from the folder Playwright
 * runs in, so this file loads the same whether the app is an ES module or CommonJS.
 */
function fwos(args: string[], input?: string): string {
  const require = createRequire(join(process.cwd(), 'package.json'));
  const manifest = require.resolve('fwos-check/package.json');
  const cli = join(dirname(manifest), (require(manifest) as { bin: { fwos: string } }).bin.fwos);
  try {
    return execFileSync(process.execPath, [cli, ...args], { cwd: process.cwd(), input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    // `fwos harness record` exits 1 when the app shows something ia.json doesn't say; its answer is still on stdout.
    const out = (e as { stdout?: string }).stdout;
    if (out) return out;
    throw new Error(`fwos ${args.join(' ')} failed: ${(e as { stderr?: string }).stderr || (e as Error).message}`);
  }
}

const plan = JSON.parse(fwos(['harness', 'targets', 'ia'])) as { revision: string; cookie: string; runs: Run[]; visits: { page: string; path: string }[] };
const pathOf = (u: string) => new URL(u).pathname;

/**
 * Opens `url` and waits for the page to settle: loaded, then half a second with no request waiting
 * for its response, or 5 seconds at most. A request stops counting once its response arrives, since
 * Chromium never finishes a response the page doesn't read: Next.js leaves a prefetch's 404 unread, so
 * while the nav links a page that isn't built yet, Playwright's networkidle never comes.
 */
async function open(page: Page, url: string) {
  const waiting = new Set<object>();
  let settled = () => {};
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let cap: ReturnType<typeof setTimeout> | undefined;
  // Each request sent or answered restarts the half second, which only runs while none is waiting.
  const watch = () => {
    clearTimeout(quiet);
    if (waiting.size === 0) quiet = setTimeout(() => settled(), 500);
  };
  const sent = (r: object) => (waiting.add(r), watch());
  const over = (r: object) => (waiting.delete(r), watch());
  const answered = (r: { request(): object }) => over(r.request());
  page.on('request', sent);
  page.on('response', answered);
  page.on('requestfailed', over);
  try {
    const response = await page.goto(url, { waitUntil: 'load' });
    await new Promise<void>((done) => {
      settled = done;
      cap = setTimeout(done, 5_000);
      watch();
    });
    return response;
  } finally {
    clearTimeout(quiet);
    clearTimeout(cap);
    page.off('request', sent);
    page.off('response', answered);
    page.off('requestfailed', over);
  }
}

/** Whether the page says the app took this role and flag setting (the scaffold's layout renders it while FWOS_TEST_ACCESS=1). */
function took(content: string | null, run: Run): boolean {
  try {
    const seen = JSON.parse(content ?? '') as { role?: string; flags?: string[] };
    return seen.role === run.role && JSON.stringify([...(seen.flags ?? [])].sort()) === JSON.stringify([...run.flags].sort());
  } catch {
    return false;
  }
}

for (const run of plan.runs) {
  test(`opens every route as ${run.role}${run.flags.length > 0 ? ` with ${run.flags.join(', ')} on` : ''} @fwos-harness`, async ({ browser, baseURL, browserName }) => {
    test.setTimeout(30_000 + plan.visits.length * 10_000);
    const context = await browser.newContext();
    await context.addCookies([{ name: plan.cookie, value: encodeURIComponent(JSON.stringify({ role: run.role, flags: run.flags })), url: baseURL! }]);
    const page = await context.newPage();
    const visits = [];
    const nav = new Set<string>();
    // Every page that renders must say it took this role and flag setting (the scaffold's layout does, while FWOS_TEST_ACCESS=1).
    let applied = true;
    try {
      for (const v of plan.visits) {
        let response;
        try {
          response = await open(page, v.path);
        } catch (e) {
          visits.push({ page: v.page, path: v.path, status: 0, finalPath: v.path, notFound: false, error: (e as Error).message.split('\n')[0] });
          continue;
        }
        const status = response?.status() ?? 0;
        const chain: string[] = [];
        for (let req = response?.request() ?? null; req; req = req.redirectedFrom()) chain.unshift(req.url());
        const notFound = status === 404 || (await page.locator('[data-fwos-not-found]').count()) > 0;
        const states = await page.locator('[data-fwos-state]:visible').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-fwos-state')));
        const denied = states.length > 0 && states.every((state) => state === 'no-permission');
        if (status < 500) applied &&= took(await page.evaluate(() => document.querySelector('meta[name="fwos-access"]')?.getAttribute('content') ?? null), run);
        const hrefs = await page.locator('nav a[href], [role="navigation"] a[href]').evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
        for (const href of hrefs) if (href.startsWith('/') && !href.startsWith('//')) nav.add(href.split(/[?#]/)[0]!);
        visits.push({ page: v.page, path: v.path, status, finalPath: pathOf(page.url()), notFound, denied, ...(chain.length > 1 ? { redirectedTo: pathOf(chain[1]!) } : {}) });
      }
    } finally {
      await context.close();
    }
    const config = {
      server: process.env.FWOS_E2E_DEV === '1' ? 'next dev' : 'production build',
      browser: `${browserName} ${browser.version()}`,
    };
    const observations = { role: run.role, flags: run.flags, applied, visits, nav: [...nav].sort() };
    const answer = JSON.parse(fwos(['harness', 'record', 'ia', run.key, '--revision', plan.revision], JSON.stringify({ config, observations }))) as { violations: string[] };
    expect(answer.violations, run.key).toEqual([]);
  });
}
