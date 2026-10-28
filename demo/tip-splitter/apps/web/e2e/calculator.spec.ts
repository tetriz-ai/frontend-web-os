// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { expect, type Page, test } from '@playwright/test';

async function expectOpeningState(page: Page) {
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Split the bill' })).toBeVisible();
  await expect(main.getByRole('textbox', { name: 'Bill amount ($)' })).toHaveValue('');
  await expect(main.getByRole('radio', { name: '18%' })).toBeChecked();
  for (const other of ['10%', '15%', '20%']) {
    await expect(main.getByRole('radio', { name: other })).not.toBeChecked();
  }
  await expect(main.getByRole('textbox', { name: 'Custom tip (%)' })).toHaveValue('');
  await expect(main.getByRole('textbox', { name: 'People' })).toHaveValue('2');
  await expect(main.getByText('Each person pays').locator('xpath=following-sibling::*[1]')).toHaveText('—');
  await expect(main.locator('dt', { hasText: 'Tip' }).locator('xpath=following-sibling::dd[1]')).toHaveText('—');
  await expect(main.locator('dt', { hasText: 'Total' }).locator('xpath=following-sibling::dd[1]')).toHaveText('—');
  await expect(main.getByRole('alert')).toHaveCount(0);
}

test('a first visit shows the opening values @AC-calc-1 @state:calculator:empty', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await expectOpeningState(page);
  await context.close();
});

test('every request stays on the same origin and a CSP meta tag is set @AC-calc-25', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await page.goto('/', { waitUntil: 'networkidle' });

  const origin = new URL(page.url()).origin;
  const external = urls.filter((u) => /^https?:/.test(u) && new URL(u).origin !== origin);
  expect(urls.length).toBeGreaterThan(0);
  expect(external).toEqual([]);

  const csp = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(csp).toHaveCount(1);
  expect(await csp.getAttribute('content')).toContain("default-src 'self'");
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Split the bill' })).toBeVisible();
});

test('opening / directly shows the app name, one nav entry and the empty state @AC-calc-1 @state:calculator:empty', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('banner').getByText('Tip Splitter')).toBeVisible();
  const links = page.getByRole('navigation').getByRole('link');
  await expect(links).toHaveCount(1);
  await expect(links.first()).toHaveText('Split the bill');
  await expectOpeningState(page);
});
