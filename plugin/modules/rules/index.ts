// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Public entry of the rules module: the rule pack and its engine, the edit-time check, and the
// review lenses and knowledge (text, read by skills and agents).

export * from './engine.ts';
export { hooks, insertedText } from './hooks.ts';
import { packCheck } from './checks/pack.ts';

export const checks = [packCheck];
