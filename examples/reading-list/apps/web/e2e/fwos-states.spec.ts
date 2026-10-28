// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// fwos's state harness. fwos writes this file and `fwos check` only counts runs of its own copy, so
// don't edit it: `fwos harness` puts it back. For every page state in docs/app/ia.json and every
// required state in design-system/components.json, it opens the state's fixture in the screens
// browser, notes what renders there, hovers whatever looks clickable and clicks it away from the
// controls inside it, and hands all that to `fwos harness record`, which judges it against the
// rendered-state contract and keeps the run, tied to this code, for `fwos check`.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';

interface Target {
  key: string;
  kind: 'page' | 'component';
  id: string;
  states: string[];
  /** Per state, where the app renders its fixture: the screens browser, or the comparison gallery for a component. Null when nothing does. */
  paths: Record<string, string | null>;
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
    // `fwos harness record` exits 1 when a state breaks its contract; its answer is still on stdout.
    const out = (e as { stdout?: string }).stdout;
    if (out) return out;
    throw new Error(`fwos ${args.join(' ')} failed: ${(e as { stderr?: string }).stderr || (e as Error).message}`);
  }
}

const plan = JSON.parse(fwos(['harness', 'targets', 'states'])) as { revision: string; targets: Target[] };
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const settle = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

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

interface Hit {
  text: string;
  paints: string[];
  controls: string[];
  click: string;
}

/**
 * Installed in the fixture's page: finds what looks clickable in the fixture (list items, table
 * rows and articles, whatever sets a pointer cursor, whatever carries a hover style) outside any
 * control, picks a point on each that no control inside it covers, and reads what a hover there
 * changes and what a click there does.
 */
function hitProbe() {
  const CONTROLS =
    'a[href], button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])';
  const PAINT = ['background-color', 'color', 'border-top-color', 'border-bottom-color', 'box-shadow', 'outline-style', 'text-decoration-line', 'opacity', 'transform', 'filter'];
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
  const shown = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[aria-hidden="true"]');
  const still = () => {
    for (const a of document.getAnimations()) {
      const t = a.effect?.getTiming();
      if (t && t.iterations === Infinity) a.cancel();
      else a.finish();
    }
  };
  const root = () => document.querySelector('[data-fwos-fixture]');
  let list: Element[] | null = null;
  let current: { el: Element; rest: string[] } | null = null;
  let watch: { observer: MutationObserver; changed: boolean; focus: Element | null } | null = null;
  const candidates = () => {
    const r = root();
    const out: Element[] = [];
    if (!r) return out;
    for (const e of r.querySelectorAll('*')) {
      if (e.closest(CONTROLS) || !shown(e)) continue;
      const parent = e.parentElement;
      const item = e.matches('li, [role="listitem"], [role="row"], article') || (e.tagName === 'TR' && !!e.querySelector('td'));
      const pointer = getComputedStyle(e).cursor === 'pointer' && (!parent || getComputedStyle(parent).cursor !== 'pointer');
      const styled = [...e.classList].some((c) => c.includes('hover:') || c === 'group' || c.startsWith('group/'));
      if (item || pointer || styled) out.push(e);
      if (out.length >= 24) break;
    }
    return out;
  };
  /** The styles a hover can change on `el` and the elements inside it, in document order. */
  const look = (el: Element) => {
    still();
    return [el, ...[...el.querySelectorAll('*')].slice(0, 60)].map((x) => {
      const cs = getComputedStyle(x);
      return PAINT.map((p) => cs.getPropertyValue(p)).join('|');
    });
  };
  const named = (c: Element) => {
    const role = c.matches('a[href], [role="link"]') ? 'link' : c.matches('button, [role="button"]') ? 'button' : (c.getAttribute('role') ?? c.tagName.toLowerCase());
    const name = squash(c.getAttribute('aria-label') ?? (c as HTMLElement).innerText ?? '').slice(0, 40);
    return `${role} "${name}"`;
  };
  (window as unknown as { __fwosHits: unknown }).__fwosHits = {
    count() {
      list = candidates();
      return list.length;
    },
    /** A point on candidate `i` that no control covers, with its rest look noted; null when the controls fill it. */
    probe(i: number) {
      const el = (list ??= candidates())[i];
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const box = el.getBoundingClientRect();
      for (const fy of [0.5, 0.25, 0.75]) {
        for (const fx of [0.5, 0.75, 0.9, 0.25, 0.1, 0.97, 0.03]) {
          const x = box.left + box.width * fx;
          const y = box.top + box.height * fy;
          const at = document.elementFromPoint(x, y);
          if (!at || !el.contains(at) || at.closest(CONTROLS)) continue;
          current = { el, rest: look(el) };
          const controls = [...el.querySelectorAll(CONTROLS)].filter(shown).slice(0, 4).map(named);
          return { x, y, text: squash((el as HTMLElement).innerText ?? '').slice(0, 80), controls };
        }
      }
      return null;
    },
    /** What the hover at (x, y) changed on the current candidate, and the pointer when it shows one. */
    paints(x: number, y: number) {
      if (!current) return [];
      const now = look(current.el);
      const changed = new Set<string>();
      now.forEach((row, n) => {
        const was = current!.rest[n]?.split('|') ?? [];
        row.split('|').forEach((v, k) => {
          if (v !== was[k]) changed.add(PAINT[k]!);
        });
      });
      const at = document.elementFromPoint(x, y);
      if (at && getComputedStyle(at).cursor === 'pointer') changed.add('cursor: pointer');
      return [...changed];
    },
    watch() {
      const w = { observer: new MutationObserver(() => (w.changed = true)), changed: false, focus: document.activeElement };
      w.observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      watch = w;
    },
    /** Whether the page changed or focus moved since watch(). */
    reacted() {
      const focus = document.activeElement;
      return !!watch && (watch.changed || (!!focus && focus !== watch.focus && focus !== document.body));
    },
    /** What the click did, short of leaving the page. */
    effect() {
      if (!watch) return 'nothing';
      watch.observer.disconnect();
      const focus = document.activeElement;
      if (watch.changed) return 'changed the page';
      if (focus && focus !== watch.focus && focus !== document.body) return `moved focus to ${named(focus)}`;
      return 'nothing';
    },
  };
}

/** Hovers each thing in the fixture that looks clickable, then clicks it away from its controls, and notes what each did. */
async function hits(page: Page, at: string): Promise<Hit[]> {
  const out: Hit[] = [];
  const reopen = async () => {
    await open(page, at);
    await settle(page);
    await page.evaluate(hitProbe);
  };
  await page.evaluate(hitProbe);
  const count = await page.evaluate(() => (window as any).__fwosHits.count() as number);
  for (let i = 0; i < count; i++) {
    await page.mouse.move(0, 0);
    await settle(page);
    const probe = (await page.evaluate((n) => (window as any).__fwosHits.probe(n), i)) as { x: number; y: number; text: string; controls: string[] } | null;
    if (!probe) continue;
    await page.mouse.move(probe.x, probe.y);
    await settle(page);
    const paints = (await page.evaluate(([x, y]) => (window as any).__fwosHits.paints(x, y), [probe.x, probe.y])) as string[];
    if (paints.length === 0) continue;
    const before = page.url();
    await page.evaluate(() => (window as any).__fwosHits.watch());
    const popup = page.context().waitForEvent('page', { timeout: 1_000 }).catch(() => null);
    await page.mouse.click(probe.x, probe.y);
    // Wait for the click to show: a new address, a change on the page, focus somewhere new. A dead one shows nothing, and waits out the second.
    await page.waitForFunction((was) => location.href !== was || (window as any).__fwosHits.reacted(), before, { timeout: 1_000 }).catch(() => undefined);
    const opened = await popup;
    let click: string;
    if (opened) {
      click = 'opened a window';
      await opened.close();
    } else if (page.url() !== before) click = `navigated to ${new URL(page.url()).pathname}`;
    else click = (await page.evaluate(() => (window as any).__fwosHits.effect())) as string;
    out.push({ text: probe.text, paints, controls: probe.controls, click });
    // Whatever the click did, the next one starts from the fixture as it first rendered.
    if (click !== 'nothing') await reopen();
  }
  await page.mouse.move(0, 0);
  return out;
}

/** What one state's fixture renders, inside its [data-fwos-fixture] container. */
async function observe(page: Page, t: Target, state: string) {
  const errors: string[] = [];
  const at = t.paths[state];
  const blank = { state, status: 0, nodes: 0, text: '', busy: 0, alerts: [], statuses: [], items: [], disabled: 0, invalid: 0, errors };
  // Nothing in the app renders it: no screens browser, and for a component no comparison gallery.
  if (!at) return { ...blank, found: false, missing: true };
  const onError = (e: Error) => errors.push(e.message.split('\n')[0]!);
  page.on('pageerror', onError);
  try {
    const response = await open(page, at);
    const status = response?.status() ?? 0;
    const fixture = page.locator('[data-fwos-fixture]');
    if ((await fixture.count()) === 0) {
      if (status === 404) throw new Error("The screens browser isn't served, so no state fixture renders: set FWOS_SCREENS=1 in the webServer env of playwright.config.ts.");
      return { ...blank, status, found: false };
    }
    if ((await fixture.first().getAttribute('data-fwos-missing')) !== null) return { ...blank, status, found: false, missing: true };
    // Let effects settle: two animation frames after the network went quiet.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const root = fixture.first();
    const facts = await root.evaluate((el) => {
      const chrome = 'nav, header, footer, [role="navigation"], [role="tablist"], [role="menu"], [role="menubar"], [role="toolbar"]';
      const controls =
        'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]';
      const shown = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[aria-hidden="true"]');
      const inside = (e: Element, selector: string) => {
        const hit = e.closest(selector);
        return hit !== null && hit !== el && el.contains(hit);
      };
      // An item's own words: its text outside links, buttons and other controls.
      const words = (item: Element) => {
        const walk = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
        let out = '';
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const parent = n.parentElement;
          const control = parent?.closest(controls);
          if (!parent || (control && item.contains(control)) || !shown(parent)) continue;
          out += ` ${n.textContent ?? ''}`;
        }
        return out.replace(/\s+/g, ' ').trim();
      };
      const items = [...el.querySelectorAll('li, tr, [role="listitem"], [role="row"], article')]
        .filter((e) => !inside(e, chrome) && !e.closest('thead') && !(e.tagName === 'TR' && !e.querySelector('td')) && shown(e))
        .map(words)
        .filter(Boolean);
      return {
        nodes: el.querySelectorAll('*').length,
        busy: el.querySelectorAll('[aria-busy="true"]').length + (el.getAttribute('aria-busy') === 'true' ? 1 : 0),
        disabled: el.querySelectorAll(':disabled, [aria-disabled="true"]').length,
        invalid: el.querySelectorAll('[aria-invalid="true"]').length,
        items: [...new Set(items)],
      };
    });
    const seen = {
      state,
      status,
      found: true,
      // What it threw while it rendered: a click below may throw too, which is no rendering error.
      errors: [...errors],
      text: squash(await root.innerText()),
      alerts: (await root.getByRole('alert').allInnerTexts()).map(squash),
      statuses: (await root.getByRole('status').allInnerTexts()).map(squash),
      ...facts,
    };
    return { ...seen, hits: await hits(page, at) };
  } finally {
    page.off('pageerror', onError);
  }
}

for (const t of plan.targets) {
  test(`${t.kind} ${t.id} renders each state as its contract says @fwos-harness`, async ({ page, browserName }) => {
    test.setTimeout(30_000 + t.states.length * 20_000);
    const observations = [];
    for (const state of t.states) observations.push(await observe(page, t, state));
    const size = page.viewportSize();
    const config = {
      server: process.env.FWOS_E2E_DEV === '1' ? 'next dev' : 'production build',
      browser: squash(`${browserName} ${page.context().browser()?.version() ?? ''}`),
      viewport: size ? `${size.width}x${size.height}` : 'default',
    };
    const answer = JSON.parse(fwos(['harness', 'record', 'states', t.key, '--revision', plan.revision], JSON.stringify({ config, observations }))) as { violations: string[] };
    expect(answer.violations, `${t.kind} ${t.id}`).toEqual([]);
  });
}
