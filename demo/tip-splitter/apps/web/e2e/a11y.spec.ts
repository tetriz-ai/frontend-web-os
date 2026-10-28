// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

test('the status region updates once, after typing stops @AC-calc-18 @state:calculator:ready', async ({ page }) => {
  await page.goto('/');
  const main = page.getByRole('main');
  const region = main.getByRole('status');
  await expect(region).toHaveCount(1);

  await main.getByRole('textbox', { name: 'People' }).fill('4');
  await expect(main.getByRole('textbox', { name: 'People' })).toHaveValue('4');

  await region.evaluate((el) => {
    const w = window as unknown as { __texts: string[] };
    w.__texts = [];
    new MutationObserver(() => w.__texts.push(el.textContent ?? '')).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });

  await main.getByRole('textbox', { name: 'Bill amount ($)' }).pressSequentially('120.00', { delay: 40 });

  await expect(region).toHaveText('Tip $21.60, total $141.60, $35.40 each.', { timeout: 1000 });
  const texts = await page.evaluate(() => (window as unknown as { __texts: string[] }).__texts);
  expect(texts.filter((t) => t !== '')).toEqual(['Tip $21.60, total $141.60, $35.40 each.']);
});

test.describe('320px viewport', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('tip picks, steppers and Reset are at least 44x44 and nothing scrolls sideways @AC-calc-22 @state:calculator:empty', async ({ page }) => {
    await page.goto('/');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Split the bill' })).toBeVisible();

    const targets = [
      ...['10%', '15%', '18%', '20%'].map((l) => ({ name: l, loc: main.getByText(l, { exact: true }) })),
      { name: 'Decrease people', loc: main.getByRole('button', { name: 'Decrease people' }) },
      { name: 'Increase people', loc: main.getByRole('button', { name: 'Increase people' }) },
      { name: 'Reset', loc: main.getByRole('button', { name: 'Reset' }) },
    ];
    const sizes: Record<string, { width: number; height: number } | null> = {};
    for (const t of targets) {
      await expect(t.loc).toBeVisible();
      const box = await t.loc.boundingBox();
      sizes[t.name] = box && { width: box.width, height: box.height };
    }
    for (const t of targets) {
      expect(sizes[t.name], `${t.name} has a box`).not.toBeNull();
      expect(sizes[t.name]!.width, `${t.name} width`).toBeGreaterThanOrEqual(44);
      expect(sizes[t.name]!.height, `${t.name} height`).toBeGreaterThanOrEqual(44);
    }

    const { scroll, inner } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(inner);
  });
});
