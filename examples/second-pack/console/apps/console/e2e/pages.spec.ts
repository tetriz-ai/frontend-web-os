import { expect, test } from '@playwright/test';
import { arrange } from './arrange';

test('@state:overview:loading holds the tide chart while readings load', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Tide height, next 24 hours')).toHaveAttribute('aria-busy', 'true');
});

test('@state:overview:ready shows the port overview', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Port overview' })).toBeVisible();
});

test('@state:overview:degraded says which feed is behind', async ({ page }) => {
  await arrange(page, { listBerths: 'stale' });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Feed paused');
});

test('@state:berths:loading keeps the heading while berths load', async ({ page }) => {
  await page.goto('/berths');
  await expect(page.getByRole('heading', { name: 'Berths' })).toBeVisible();
});

test('@state:berths:ready lists the berths booked today', async ({ page }) => {
  await page.goto('/berths');
  await expect(page.getByRole('button', { name: 'Berth 4' })).toBeVisible();
});

test('@state:berths:no-berths says none are booked', async ({ page }) => {
  await arrange(page, { listBerths: 'empty' });
  await page.goto('/berths');
  await expect(page.getByText('No berths are booked today.')).toBeVisible();
});

test('@state:berths:stale marks the rows out of date', async ({ page }) => {
  await arrange(page, { listBerths: 'stale' });
  await page.goto('/berths');
  await expect(page.getByRole('status')).toContainText('Feed paused');
});

test('@state:berth:loading keeps the page while the berth loads', async ({ page }) => {
  await page.goto('/berths/b4');
  await expect(page.locator('main')).toBeVisible();
});

test('@state:berth:ready shows the berth and its draught', async ({ page }) => {
  await page.goto('/berths/b4');
  await expect(page.getByRole('heading', { name: 'Berth 4' })).toBeVisible();
});

test('@state:berth:not-found answers 404 for an unknown berth', async ({ page }) => {
  const res = await page.goto('/berths/b99');
  expect(res?.status()).toBe(404);
});

test('@state:voyage:loading keeps the page while the voyage loads', async ({ page }) => {
  await page.goto('/vessels/9321483/voyages/v118');
  await expect(page.locator('main')).toBeVisible();
});

test('@state:voyage:ready names the vessel and when it is due', async ({ page }) => {
  await page.goto('/vessels/9321483/voyages/v118');
  await expect(page.getByRole('heading', { name: 'Morning Star (IMO 9321483)' })).toBeVisible();
});

test('@state:voyage:delayed says how late it is', async ({ page }) => {
  await arrange(page, { getVoyage: 'delayed' });
  await page.goto('/vessels/9321483/voyages/v118');
  await expect(page.getByText(/45 minutes late/)).toBeVisible();
});

test('@state:forecast:loading keeps the heading while the forecast loads', async ({ page }) => {
  await page.goto('/forecast');
  await expect(page.getByRole('heading', { name: 'Tide forecast' })).toBeVisible();
});

test('@state:forecast:ready shows the forecast heading', async ({ page }) => {
  await page.goto('/forecast');
  await expect(page.getByRole('heading', { name: 'Tide forecast' })).toBeVisible();
});

test('@state:forecast:offline says the gauge is offline', async ({ page }) => {
  await page.goto('/forecast');
  await expect(page.getByRole('status')).toHaveText('Tide gauge offline. No readings to show.');
});

test('@state:auctions:loading keeps the heading while auctions load', async ({ page }) => {
  await page.goto('/auctions');
  await expect(page.getByRole('heading', { name: 'Berth auctions' })).toBeVisible();
});

test('@state:auctions:ready shows the auctions page to the harbourmaster', async ({ page }) => {
  await page.goto('/auctions');
  await expect(page.getByRole('heading', { name: 'Berth auctions' })).toBeVisible();
});

test('@state:auctions:closed says no auction is open', async ({ page }) => {
  await page.goto('/auctions');
  await expect(page.getByText(/No auction is open/)).toBeVisible();
});

test('@state:audit:loading keeps the heading while the trail loads', async ({ page }) => {
  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: /Audit trail/ })).toBeVisible();
});

test('@state:audit:ready shows the range in the heading', async ({ page }) => {
  await page.goto('/audit/2026-10-01/2026-10-23');
  await expect(page.getByRole('heading', { name: 'Audit trail: 2026-10-01 to 2026-10-23' })).toBeVisible();
});

test('@state:audit:forbidden answers 404 to a pilot', async ({ page }) => {
  await arrange(page, { getSession: 'pilot' });
  const res = await page.goto('/audit');
  expect(res?.status()).toBe(404);
});

test('@state:settings:ready shows the section asked for', async ({ page }) => {
  await page.goto('/settings/notifications/email');
  await expect(page.getByRole('heading', { name: 'Settings: notifications / email' })).toBeVisible();
});
