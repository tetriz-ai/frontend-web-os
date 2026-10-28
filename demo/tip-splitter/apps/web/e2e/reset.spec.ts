// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

test('Reset restores the opening values and focuses Bill amount @AC-calc-17 @state:calculator:empty', async ({ page }) => {
  await page.goto('/');
  const main = page.getByRole('main');
  await main.getByRole('textbox', { name: 'Bill amount ($)' }).fill('100');
  await main.getByRole('textbox', { name: 'Custom tip (%)' }).fill('12.5');
  await main.getByRole('textbox', { name: 'People' }).fill('5');
  await expect(main.getByText('Each person pays').locator('xpath=following-sibling::*[1]')).not.toHaveText('—');

  await main.getByRole('button', { name: 'Reset' }).click();

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
  await expect(main.getByRole('textbox', { name: 'Bill amount ($)' })).toBeFocused();
});
