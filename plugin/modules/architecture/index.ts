// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Public entry of the architecture module: the modules.json format, the walls check, and the
// API contract and the mocks generated from it.

export * from './modules.ts';
export { extractImports, extractPromptRefs, type ImportRef } from './imports.ts';
export { Resolver, readWorkspace } from './resolve.ts';
export { runWalls, wallsCheck, type WallsOptions } from './checks/walls.ts';
export { loadContract, validateFixtures, wrapSchema, contractSource, type OpenApiDoc } from './contract.ts';
import { contractCheck } from './checks/contract.ts';
import { mocksCheck } from './checks/mocks.ts';
import { wallsCheck } from './checks/walls.ts';

export const checks = [wallsCheck, contractCheck, mocksCheck];
