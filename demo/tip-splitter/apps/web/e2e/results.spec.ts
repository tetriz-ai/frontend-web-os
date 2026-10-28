// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

test.describe('narrow viewport', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('a huge bill fits at 320px without sideways scroll @AC-calc-23 @state:calculator:ready', async ({ page }) => {
    await page.goto('/');
    const main = page.getByRole('main');
    await main.getByRole('textbox', { name: 'Bill amount ($)' }).fill('9999999.99');
    await main.getByRole('button', { name: 'Decrease people' }).click();

    await expect(main.locator('dt', { hasText: 'Tip' }).locator('xpath=following-sibling::dd[1]')).toHaveText('$1,800,000.00');
    await expect(main.locator('dt', { hasText: 'Total' }).locator('xpath=following-sibling::dd[1]')).toHaveText('$11,799,999.99');
    const each = main.getByText('Each person pays').locator('xpath=following-sibling::*[1]');
    await expect(each).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await each.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    const clipped = await each.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(clipped).toBe(false);
  });
});

test('using the calculator makes no network request after load @AC-calc-27', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Split the bill' })).toBeVisible();

  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await main.getByRole('textbox', { name: 'Bill amount ($)' }).fill('120.00');
  await main.getByText('20%', { exact: true }).click();
  await main.getByRole('button', { name: 'Increase people' }).click();

  await expect(main.locator('dt', { hasText: 'Total' }).locator('xpath=following-sibling::dd[1]')).toHaveText('$144.00');
  expect(requests).toEqual([]);
});
