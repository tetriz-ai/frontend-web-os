// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Acceptance proof "against: local" (D-29): a real browser, the production export, nothing mocked.

import { expect, type Locator, type Page, test } from '@playwright/test';

const HINT = 'Tip is on the amount you enter. Enter it before tax if you tip pre-tax.';
const BILL_ERROR = 'Enter an amount like 42.50, up to 9,999,999.99.';
const TIP_ERROR = 'Enter a tip from 0 to 100%, up to 2 decimals.';
const PEOPLE_ERROR = 'Enter 1 to 50 people.';

function ui(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    bill: main.getByRole('textbox', { name: 'Bill amount ($)' }),
    custom: main.getByRole('textbox', { name: 'Custom tip (%)' }),
    people: main.getByRole('textbox', { name: 'People' }),
    dec: main.getByRole('button', { name: 'Decrease people' }),
    inc: main.getByRole('button', { name: 'Increase people' }),
    reset: main.getByRole('button', { name: 'Reset' }),
    tip: main.locator('dt', { hasText: 'Tip' }).locator('xpath=following-sibling::dd[1]'),
    total: main.locator('dt', { hasText: 'Total' }).locator('xpath=following-sibling::dd[1]'),
    each: main.getByText('Each person pays').locator('xpath=following-sibling::*[1]'),
    pick: (label: string) => main.getByText(label, { exact: true }),
    radio: (label: string) => main.getByRole('radio', { name: label }),
  };
}

async function open(page: Page) {
  await page.goto('/');
  const u = ui(page);
  await expect(u.main.getByRole('heading', { level: 1, name: 'Split the bill' })).toBeVisible();
  return u;
}

async function expectResults(u: ReturnType<typeof ui>, tip: string, total: string, each: string) {
  await expect(u.tip).toHaveText(tip);
  await expect(u.total).toHaveText(total);
  await expect(u.each).toHaveText(each);
}

async function expectDashes(u: ReturnType<typeof ui>) {
  await expectResults(u, '—', '—', '—');
}

async function expectInvalid(field: Locator, message: string) {
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription(message);
}

async function expectNotInvalid(field: Locator) {
  await expect(field).not.toHaveAttribute('aria-invalid', 'true');
}

async function expectNoRadioChecked(u: ReturnType<typeof ui>) {
  for (const l of ['10%', '15%', '18%', '20%']) await expect(u.radio(l)).not.toBeChecked();
}

test('updates results live as I type and step @AC-calc-2 @state:calculator:ready', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('120.00');
  await u.inc.click();
  await u.inc.click();
  await expect(u.people).toHaveValue('4');
  await expectResults(u, '$21.60', '$141.60', '$35.40');
});

test('picking a tip updates the results @AC-calc-3 @state:calculator:ready', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('120.00');
  await u.people.fill('4');
  await u.pick('20%').click();
  await expect(u.radio('20%')).toBeChecked();
  await expectResults(u, '$24.00', '$144.00', '$36.00');
});

test('a custom tip replaces the pick and a pick clears it @AC-calc-4 @state:calculator:ready', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('120.00');
  await u.people.fill('4');
  await expect(u.radio('18%')).toBeChecked();
  await u.custom.fill('12.5');
  await expectNoRadioChecked(u);
  await expectResults(u, '$15.00', '$135.00', '$33.75');
  await u.pick('15%').click();
  await expect(u.custom).toHaveValue('');
  await expect(u.radio('15%')).toBeChecked();
  await expect(u.tip).toHaveText('$18.00');
});

test('a 0% tip is allowed with no error @AC-calc-5 @state:calculator:ready', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('50.00');
  await u.people.fill('2');
  await u.custom.fill('0');
  await expectResults(u, '$0.00', '$50.00', '$25.00');
  await page.keyboard.press('Tab');
  await expect(u.custom).not.toBeFocused();
  await expectNotInvalid(u.custom);
  await expect(u.custom).not.toHaveAccessibleDescription(TIP_ERROR);
  await expectNotInvalid(u.bill);
  await expect(u.bill).toHaveAccessibleDescription(HINT);
  await expectNotInvalid(u.people);
});

test('tells me when shares were rounded up @AC-calc-6 @state:calculator:rounded', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('100');
  await u.people.fill('3');
  await expect(u.each).toHaveText('$39.34');
  await expect(u.main.getByText('Rounded up: the group pays $118.02, $0.02 over the total.', { exact: true })).toBeVisible();
});

test('shows no rounding note on an exact split @AC-calc-7 @state:calculator:ready', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('120.00');
  await u.people.fill('4');
  await expectResults(u, '$21.60', '$141.60', '$35.40');
  await expect(page.getByText(/^Rounded up/)).toHaveCount(0);
});

test('rounds the tip to the nearest cent @AC-calc-8 @state:calculator:ready', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('33.33');
  await u.people.fill('1');
  await u.pick('15%').click();
  await expect(u.radio('15%')).toBeChecked();
  await expect(u.tip).toHaveText('$5.00');
  await expect(u.total).toHaveText('$38.33');
});

test('accepts amounts typed the way I am used to @AC-calc-9 @state:calculator:ready @state:calculator:invalid-bill', async ({ page }) => {
  const u = await open(page);
  await u.people.fill('1');
  await u.custom.fill('0');
  const valid: Array<[string, string]> = [
    ['42,50', '$42.50'],
    ['$1,234.50', '$1,234.50'],
    ['1,234', '$1,234.00'],
    [' 42.5 ', '$42.50'],
    ['1.234,50', '$1,234.50'],
    ['1,234,567', '$1,234,567.00'],
    ['1.234.567', '$1,234,567.00'],
    ['12,345.6', '$12,345.60'],
  ];
  for (const [typed, total] of valid) {
    await u.bill.fill(typed);
    await expect(u.total, `"${typed}"`).toHaveText(total);
  }
  for (const typed of ['1,2345', '1.234']) {
    await u.bill.fill(typed);
    await expectDashes(u);
    await page.keyboard.press('Tab');
    await expect(u.bill).not.toBeFocused();
    await expectInvalid(u.bill, BILL_ERROR);
    await u.bill.focus();
  }
});

test('flags a bill that is not a usable amount after I leave the field @AC-calc-10 @state:calculator:invalid-bill', async ({ page }) => {
  for (const typed of ['12..5', 'abc', '-5', '4.505', '10000000']) {
    const u = await open(page);
    await u.bill.fill(typed);
    await expectDashes(u);
    await expect(u.bill).toBeFocused();
    await expectNotInvalid(u.bill);
    await expect(u.bill).toHaveAccessibleDescription(HINT);
    await expect(u.main.getByText(BILL_ERROR)).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(u.bill).not.toBeFocused();
    await expectInvalid(u.bill, BILL_ERROR);
    await expect(u.main.getByText(BILL_ERROR)).toBeVisible();
    await expectDashes(u);
  }
});

test('fixing the bill brings the results back @AC-calc-11 @state:calculator:invalid-bill @state:calculator:rounded', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('12..5');
  await page.keyboard.press('Tab');
  await expectInvalid(u.bill, BILL_ERROR);
  await u.bill.fill('12.5');
  await page.keyboard.press('Tab');
  await expect(u.bill).not.toBeFocused();
  await expect(u.main.getByText(BILL_ERROR)).toHaveCount(0);
  await expectNotInvalid(u.bill);
  await expect(u.bill).toHaveAccessibleDescription(HINT);
  await expect(u.each).toHaveText('$7.38');
  await expect(u.total).toHaveText('$14.75');
});

test('a $0 bill shows $0.00 with no error @AC-calc-12 @state:calculator:ready', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('0');
  await expectResults(u, '$0.00', '$0.00', '$0.00');
  await page.keyboard.press('Tab');
  await expect(u.bill).not.toBeFocused();
  await expectNotInvalid(u.bill);
  await expect(u.bill).toHaveAccessibleDescription(HINT);
  await expect(u.main.getByText(BILL_ERROR)).toHaveCount(0);
  await expectNotInvalid(u.custom);
  await expect(u.custom).not.toHaveAccessibleDescription(TIP_ERROR);
});

test('flags a custom tip that is out of range @AC-calc-13 @state:calculator:invalid-tip', async ({ page }) => {
  for (const typed of ['150', '-1', 'abc', '12.345']) {
    const u = await open(page);
    await u.bill.fill('80.00');
    await u.people.fill('2');
    await u.custom.fill(typed);
    await page.keyboard.press('Tab');
    await expect(u.custom).not.toBeFocused();
    await expectInvalid(u.custom, TIP_ERROR);
    await expectNoRadioChecked(u);
    await expectDashes(u);
  }
  const u = await open(page);
  await u.bill.fill('80.00');
  await u.people.fill('2');
  for (const [typed, tip] of [['100', '$80.00'], ['12.5', '$10.00'], ['12.55', '$10.04']]) {
    await u.custom.fill(typed);
    await page.keyboard.press('Tab');
    await expect(u.custom).not.toBeFocused();
    await expectNotInvalid(u.custom);
    await expect(u.custom).not.toHaveAccessibleDescription(TIP_ERROR);
    await expect(u.tip, `"${typed}"`).toHaveText(tip);
    await u.custom.focus();
  }
});

test('asks me to pick a tip when none is chosen @AC-calc-14 @state:calculator:invalid-tip', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('80.00');
  await u.custom.fill('12');
  await expectNoRadioChecked(u);
  await u.custom.fill('');
  await expectDashes(u);
  await expect(u.main.getByText('Pick a tip or type one.')).toBeVisible();
  await u.pick('18%').click();
  await expect(u.radio('18%')).toBeChecked();
  await expect(u.tip).toHaveText('$14.40');
  await expect(u.main.getByText('Pick a tip or type one.')).toHaveCount(0);
});

test('the people stepper stops at 1 and 50 @AC-calc-15 @state:calculator:people-bounds', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('64.50');
  await u.pick('20%').click();
  await expect(u.radio('20%')).toBeChecked();
  await u.dec.click();
  await expect(u.people).toHaveValue('1');
  await expect(u.dec).toBeDisabled();
  await expect(u.each).toHaveText('$77.40');
  await expect(u.main.getByText('Just you, so you pay the whole total.')).toBeVisible();

  await u.people.fill('49');
  await u.inc.click();
  await expect(u.people).toHaveValue('50');
  await expect(u.inc).toBeDisabled();
});

test('flags a head count that is not 1 to 50 @AC-calc-16 @state:calculator:people-bounds', async ({ page }) => {
  for (const typed of ['0', '51', '2.5', 'abc']) {
    const u = await open(page);
    await u.bill.fill('80.00');
    await u.people.fill(typed);
    await page.keyboard.press('Tab');
    await expect(u.people).not.toBeFocused();
    await expectInvalid(u.people, PEOPLE_ERROR);
    await expectDashes(u);
    await expect(u.people).toHaveValue(typed);
  }
});

test('the status region reads the rounded result exactly @AC-calc-18 @state:calculator:rounded', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('100');
  await u.people.fill('3');
  await expect(u.main.getByRole('status')).toHaveText('Tip $18.00, total $118.00, $39.34 each, rounded up.');
});

test('a tiny bill split 50 ways rounds up per person @AC-calc-24 @state:calculator:rounded @state:calculator:people-bounds', async ({ page }) => {
  const u = await open(page);
  await u.bill.fill('0.01');
  await u.custom.fill('0');
  await u.people.fill('50');
  await expect(u.each).toHaveText('$0.01');
  await expect(u.main.getByText('Rounded up: the group pays $0.50, $0.49 over the total.', { exact: true })).toBeVisible();
  await expect(u.inc).toBeDisabled();
});

test('the pre-tax hint shows under Bill amount and describes the field @AC-calc-26 @state:calculator:empty', async ({ page }) => {
  const u = await open(page);
  await expect(u.main.getByText(HINT, { exact: true })).toBeVisible();
  await expect(u.bill).toHaveAccessibleDescription(HINT);
});

test('every request, including service worker requests, is same-origin and CSP is strict @AC-calc-25 @state:calculator:empty', async ({ page, context }) => {
  const urls: string[] = [];
  context.on('request', (request) => urls.push(request.url()));
  page.on('request', (request) => urls.push(request.url()));
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Split the bill' })).toBeVisible();

  const origin = new URL(page.url()).origin;
  const remote = urls.filter((u) => /^(https?|wss?):/.test(u));
  expect(remote.length).toBeGreaterThan(0);
  expect(remote.filter((u) => new URL(u).origin !== origin)).toEqual([]);

  const csp = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(csp).toHaveCount(1);
  expect(await csp.getAttribute('content')).toContain("default-src 'self'");
});

test('splitting a bill sends no request, even from the service worker @AC-calc-27 @state:calculator:ready', async ({ page, context }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const u = ui(page);
  await expect(u.main.getByRole('heading', { level: 1, name: 'Split the bill' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForLoadState('networkidle');

  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  page.on('request', (request) => requests.push(request.url()));

  await u.bill.fill('120.00');
  await u.pick('20%').click();
  await u.inc.click();
  await expect(u.total).toHaveText('$144.00');
  await expect(u.people).toHaveValue('3');
  await expect(u.main.getByRole('status')).toHaveText(/\$144\.00/);
  expect(requests).toEqual([]);
});
