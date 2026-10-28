// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { type Access, TEST_ACCESS_COOKIE, canSee, defaultAccess, pageById, parseTestAccess } from '@/shared/access';

/** Whether fwos's IA harness may pick the role and flags with a cookie. Set only for the end-to-end tests, never for a real deployment. */
export const testAccess = () => process.env.FWOS_TEST_ACCESS === '1';

/**
 * Who is asking. Until sign-in exists, the default; read the session here once it does. While
 * FWOS_TEST_ACCESS=1, the harness's cookie picks the role and flags instead.
 */
export async function currentAccess(): Promise<Access> {
  if (testAccess()) {
    const asked = parseTestAccess((await cookies()).get(TEST_ACCESS_COOKIE)?.value);
    if (asked) return asked;
  }
  return defaultAccess;
}

/**
 * Declares the page's stable ID from docs/app/ia.json and lets through only the roles and flag
 * setting ia.json shows it to: anyone else gets the not-found page. Call it first in every page.
 */
export async function guardPage(id: string): Promise<Access> {
  const page = pageById(id);
  const access = await currentAccess();
  if (!page || !canSee(page, access)) notFound();
  return access;
}
