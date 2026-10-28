import { expect, type Page, test } from '@playwright/test';

// The home page ("/", page id "list" in docs/app/ia.json) in a real browser, against the
// production build and real browser storage. Slice S1: TC-reading-2, TC-reading-12 and the
// keyboard journey for TC-default-keyboard.

const linkField = (page: Page) => page.getByLabel('Link', { exact: true });
const rows = (page: Page) => page.getByRole('list', { name: 'Saved links' }).getByRole('listitem');

test('the first visit shows the zero state, and a saved link survives a reload @AC-reading-1 @AC-reading-9 @state:list:empty', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Save your first link')).toBeVisible();

  await linkField(page).fill('https://example.com/articles/slow-reading');
  await page.getByLabel('Title (optional)').fill('The case for slow reading');
  await page.getByRole('button', { name: 'Save link' }).click();
  await expect(rows(page).first()).toContainText('The case for slow reading');

  await page.reload();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('The case for slow reading');
  await expect(rows(page).first()).toContainText('example.com');
});

test('a link can be saved with the keyboard alone @TC-default-keyboard @AC-reading-1', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Save your first link')).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(linkField(page)).toBeFocused();
  await page.keyboard.type('https://example.com/articles/keyboard');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Saved without a mouse');
  await page.keyboard.press('Enter');

  await expect(rows(page).first()).toContainText('Saved without a mouse');
  await expect(linkField(page)).toBeFocused();
});

test('blocked storage shows the reason, and Try again recovers @AC-reading-10 @state:list:error', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __blockStorage: boolean };
    const descriptor =
      Object.getOwnPropertyDescriptor(window, 'localStorage') ?? Object.getOwnPropertyDescriptor(Window.prototype, 'localStorage');
    w.__blockStorage = true;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        if (w.__blockStorage) throw new DOMException('The operation is insecure.', 'SecurityError');
        return descriptor!.get!.call(window);
      },
    });
  });
  await page.goto('/');

  // Scoped to main: Next.js keeps its own role=alert route announcer on every page.
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText("Couldn't load your reading list");
  await expect(alert).toContainText("This browser isn't letting the app use its storage");

  await page.evaluate(() => {
    (window as unknown as { __blockStorage: boolean }).__blockStorage = false;
  });
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Save your first link')).toBeVisible();
});
