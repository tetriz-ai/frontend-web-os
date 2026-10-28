// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Public entry of the shared-session module: who is asking, and the guard every page calls. Server only.

export { currentAccess, guardPage, testAccess } from './session';
