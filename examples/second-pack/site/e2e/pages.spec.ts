import { expect, test } from '@playwright/test';

test('@state:home:ready leads with the outcome and one call to action', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Berths booked without a phone call.');
  await expect(page.getByRole('link', { name: 'Book a demo' })).toBeVisible();
});

test('@state:pricing:ready shows the plans', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible();
});

test('@state:pricing:quote-sent confirms the request', async ({ page }) => {
  await page.route('**/api/quote', (route) => route.fulfill({ status: 204 }));
  await page.goto('/pricing');
  await page.getByRole('button', { name: "Ask for your port's quote" }).click();
  await expect(page.getByRole('status')).toContainText('Request sent');
});

test('@state:docs:ready renders a docs page', async ({ page }) => {
  await page.goto('/docs/getting-started');
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
});

test('@state:docs:missing-page points to the docs start', async ({ page }) => {
  await page.goto('/docs/old/page');
  await expect(page.getByRole('link', { name: 'Getting started' })).toBeVisible();
});

test('@state:changelog:ready lists releases, newest first', async ({ page }) => {
  await page.goto('/changelog');
  await expect(page.getByRole('heading', { name: '2026.10' })).toBeVisible();
});

test('@state:changelog:no-releases says there are none yet', async ({ page }) => {
  await page.goto('/changelog/2099.01');
  await expect(page.getByText('No releases yet.')).toBeVisible();
});

test('@state:blog:ready lists the posts', async ({ page }) => {
  await page.goto('/blog');
  await expect(page.getByRole('link', { name: 'Berths booked without a phone call' })).toBeVisible();
});

test('@state:blog:no-posts says there are none yet', async ({ page }) => {
  await page.goto('/blog?fixture=empty');
  await expect(page.getByText('No posts yet.')).toBeVisible();
});

test('@state:post:ready shows the post', async ({ page }) => {
  await page.goto('/blog/berths-without-phone-calls');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Berths booked without a phone call');
});

test('@state:legal:ready shows the document asked for', async ({ page }) => {
  await page.goto('/legal/terms');
  await expect(page.getByRole('heading', { name: 'Terms of service' })).toBeVisible();
});
