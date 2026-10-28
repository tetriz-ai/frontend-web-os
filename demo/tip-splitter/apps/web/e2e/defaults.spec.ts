// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

// The default rows every fwos test plan gets (TC-default-*): crawl, accessibility, keyboard,
// both themes, a phone viewport, and (because the config runs `next start`) the production build.

interface IaPage {
  id: string;
  route?: string;
  kind: string;
}
const ia = JSON.parse(readFileSync(new URL('../../../docs/app/ia.json', import.meta.url), 'utf8')) as { pages: IaPage[] };
const routes = ia.pages.filter((p) => p.route && p.kind !== 'redirect' && !p.route.includes('[')).map((p) => p.route!);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('every route loads with no console errors or broken links @TC-default-crawl @TC-default-prod', async ({ page, request }) => {
  const errors = collectErrors(page);
  for (const route of routes) {
    const res = await page.goto(route);
    expect(res?.status(), route).toBeLessThan(400);
    for (const href of await page.locator('a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!))) {
      expect((await request.get(href)).status(), `${route} links to ${href}`).toBeLessThan(400);
    }
  }
  expect(errors).toEqual([]);
});

test('no serious accessibility violations on any route @TC-default-a11y', async ({ page }) => {
  for (const route of routes) {
    await page.goto(route);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${route}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  }
});

test('the keyboard reaches the skip link and the main content @TC-default-keyboard', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('light and dark themes both apply @TC-default-themes', async ({ browser }) => {
  const surface: Record<string, string> = {};
  for (const colorScheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ colorScheme });
    const page = await context.newPage();
    await page.goto('/');
    surface[colorScheme] = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.screenshot({ path: test.info().outputPath(`home-${colorScheme}.png`), fullPage: true });
    await context.close();
  }
  expect(surface.light).not.toBe(surface.dark);
});

test('no sideways scrolling on a phone @TC-default-phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  for (const route of routes) {
    await page.goto(route);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, route).toBeLessThanOrEqual(0);
  }
  await context.close();
});
