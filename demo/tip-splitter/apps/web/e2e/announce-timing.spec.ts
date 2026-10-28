// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

test('the status region waits 500 ms after the last change @AC-calc-18 @state:calculator:ready', async ({ page }) => {
  await page.goto('/');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Split the bill' })).toBeVisible();
  const bill = main.getByRole('textbox', { name: 'Bill amount ($)' });
  const region = main.getByRole('status');
  await main.getByRole('textbox', { name: 'People' }).fill('4');
  await expect(region).toHaveText('');

  await page.evaluate(() => {
    const el = document.querySelector('main [role="status"]') as HTMLElement;
    const w = window as unknown as { __log: { text: string; t: number }[]; __lastInput: number };
    w.__log = [];
    w.__lastInput = 0;
    new MutationObserver(() => w.__log.push({ text: el.textContent ?? '', t: performance.now() })).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    document.addEventListener('input', () => (w.__lastInput = performance.now()), true);
  });

  await bill.click();
  await bill.pressSequentially('120.00', { delay: 400 });
  await expect(region).toHaveText('Tip $21.60, total $141.60, $35.40 each.');

  const { log, lastInput } = await page.evaluate(() => {
    const w = window as unknown as { __log: { text: string; t: number }[]; __lastInput: number };
    return { log: w.__log, lastInput: w.__lastInput };
  });
  const nonEmpty = log.filter((e) => e.text.trim() !== '');
  expect(nonEmpty.map((e) => e.text)).toEqual(['Tip $21.60, total $141.60, $35.40 each.']);
  const delay = nonEmpty[0]!.t - lastInput;
  expect(delay).toBeGreaterThanOrEqual(450);
  expect(delay).toBeLessThanOrEqual(1000);
});
