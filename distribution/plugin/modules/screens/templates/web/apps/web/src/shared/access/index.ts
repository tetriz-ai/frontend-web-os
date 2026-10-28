// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Public entry of the shared-access module: who may see a page, by docs/app/ia.json. The nav and
// the page guard share this one rule. Safe on the client.

export { type Access, TEST_ACCESS_COOKIE, canSee, defaultAccess, pageById, parseTestAccess } from './access';
