import type { Page } from '@playwright/test';

/** Answers the port API from these fixture variants (packages/port-api/fixtures/<op>.<variant>.json) for one test. */
export async function arrange(page: Page, variants: Record<string, string>): Promise<void> {
  await page.context().addCookies([{ name: 'port-api-fixtures', value: encodeURIComponent(JSON.stringify(variants)), url: 'http://localhost:3300' }]);
}
