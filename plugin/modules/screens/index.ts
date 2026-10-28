// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Public entry of the screens module: the ia.json format, the IA diff, the scaffold and the
// screens checks.

export * from './ia.ts';
export * from './harness.ts';
export * from './prototype.ts';
export { loadIa, iaPath } from './checks/screens.ts';
export { renderTemplate, TEMPLATES_DIR, type ScaffoldVars, type TemplateFile } from './scaffold.ts';
import { iaCheck, statesCheck } from './checks/screens.ts';

export const checks = [iaCheck, statesCheck];
