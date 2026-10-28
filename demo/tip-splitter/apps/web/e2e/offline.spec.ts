// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

test('the calculator loads and works offline after one visit @AC-calc-20', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Split the bill' })).toBeVisible();

  // Wait for a service worker to be active, then make sure it controls the page.
  await page.evaluate(() => navigator.serviceWorker.ready);
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  if (!controlled) {
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  }

  await context.setOffline(true);
  await page.reload();

  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Split the bill' })).toBeVisible();
  await main.getByRole('textbox', { name: 'Bill amount ($)' }).fill('120.00');
  await main.getByRole('button', { name: 'Increase people' }).click();
  await main.getByRole('button', { name: 'Increase people' }).click();

  const each = main.getByText('Each person pays').locator('xpath=following-sibling::*[1]');
  await expect(each).toHaveText('$35.40');
});

test('the page links a web manifest named Tip Splitter @AC-calc-21', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('link[rel="manifest"]');
  await expect(link).toHaveCount(1);
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();

  const response = await page.request.get(new URL(href!, page.url()).toString());
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.name).toBe('Tip Splitter');
  expect(manifest.start_url).toBe('/');
  expect(manifest.display).toBe('standalone');
});
