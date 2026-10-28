// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Public entry of the spec module: the AC ID format, the spec sections, a change's own criteria,
// the sections that trace an adopted app's change (its asks, questions and states), the words
// that leave a criterion open, and the spec format check.

export * from './acs.ts';
export * from './delta.ts';
export * from './request.ts';
export * from './clarity.ts';
export { specPath } from './checks/spec.ts';
import { formatCheck } from './checks/spec.ts';

export const checks = [formatCheck];
