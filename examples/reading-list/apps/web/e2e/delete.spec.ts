import { expect, type Page, test } from '@playwright/test';

// Slice S3 in a real browser: TC-reading-21. The page clock stands in for the 5-second undo window.

const rows = (page: Page) => page.getByRole('list', { name: 'Saved links' }).getByRole('listitem');

async function save(page: Page, url: string, title: string) {
  await page.getByLabel('Link', { exact: true }).fill(url);
  await page.getByLabel('Title (optional)').fill(title);
  await page.getByRole('button', { name: 'Save link' }).click();
  await expect(rows(page).filter({ hasText: title })).toHaveCount(1);
}

test('a deletion is final after the undo window, after a reload too @AC-reading-8', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await save(page, 'https://example.com/one', 'First link');
  await save(page, 'https://example.com/two', 'Second link');

  await page.getByRole('button', { name: 'Delete: First link' }).click();
  await expect(rows(page)).toHaveCount(1);
  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeFocused();
  await undo.click();
  await expect(rows(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Delete: First link' }).click();
  await expect(undo).toBeVisible();
  await page.clock.runFor(5_000);
  await expect(undo).toBeHidden();

  await page.reload();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Second link');
});
