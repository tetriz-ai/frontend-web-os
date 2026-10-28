import { expect, type Page, test } from '@playwright/test';

// Slice S2 in a real browser: TC-reading-15, 17 and 19. Data is saved through the form, so the
// tests use the app the way a person does.

const rows = (page: Page) => page.getByRole('list', { name: 'Saved links' }).getByRole('listitem');
const filter = (page: Page) => page.getByRole('navigation', { name: 'Filter links' });

async function save(page: Page, url: string, title: string) {
  await page.getByLabel('Link', { exact: true }).fill(url);
  await page.getByLabel('Title (optional)').fill(title);
  await page.getByRole('button', { name: 'Save link' }).click();
  await expect(rows(page).filter({ hasText: title })).toHaveCount(1);
}

test('read state survives a reload @AC-reading-5', async ({ page }) => {
  await page.goto('/');
  await save(page, 'https://example.com/articles/slow-reading', 'The case for slow reading');

  await page.getByRole('button', { name: 'Mark as read: The case for slow reading' }).click();
  await expect(page.getByRole('button', { name: 'Mark as unread: The case for slow reading' })).toBeVisible();

  await page.reload();
  const row = rows(page).filter({ hasText: 'The case for slow reading' });
  await expect(row.getByText('Read', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Mark as unread: The case for slow reading' })).toBeVisible();
});

test('the filter lives in the address @AC-reading-6', async ({ page }) => {
  await page.goto('/');
  await save(page, 'https://example.com/one', 'First link');
  await save(page, 'https://example.com/two', 'Second link');
  await save(page, 'https://example.com/three', 'Third link');
  await page.getByRole('button', { name: 'Mark as read: Second link' }).click();
  await expect(page.getByRole('button', { name: 'Mark as unread: Second link' })).toBeVisible();

  await filter(page).getByRole('link', { name: 'Unread' }).click();
  await expect(page).toHaveURL(/\/\?show=unread$/);
  await expect(filter(page).getByRole('link', { name: 'Unread' })).toHaveAttribute('aria-current', 'page');
  await expect(rows(page)).toHaveCount(2);

  await page.reload();
  await expect(filter(page).getByRole('link', { name: 'Unread' })).toHaveAttribute('aria-current', 'page');
  await expect(rows(page)).toHaveCount(2);

  await page.goto('/?show=read');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Second link');

  await page.goBack();
  await expect(page).toHaveURL(/\/\?show=unread$/);
  await expect(rows(page)).toHaveCount(2);
});

test('Show all brings every link back @AC-reading-7 @state:list:filtered-empty', async ({ page }) => {
  await page.goto('/');
  await save(page, 'https://example.com/one', 'First link');
  await save(page, 'https://example.com/two', 'Second link');

  await page.goto('/?show=read');
  await expect(page.getByText('No read links')).toBeVisible();
  await page.getByRole('link', { name: 'Show all' }).click();

  await expect(page).toHaveURL(/:\d+\/$/);
  await expect(rows(page)).toHaveCount(2);
});
