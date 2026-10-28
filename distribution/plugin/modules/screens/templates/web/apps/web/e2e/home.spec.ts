// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

// The home page's states from docs/app/ia.json. Each state a page promises needs a passing test
// tagged @state:<page-id>:<state>, or `fwos check` (screens/states) fails.

test('home shows its welcome @state:home:ready', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
