// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Public entry of the state module: change files, approvals, hashes, staleness, the lock,
// the baseline and file ownership.

export * from './model.ts';
export * from './store.ts';
export * from './approvals.ts';
export * from './owned.ts';
export * from './lock.ts';
export * from './baseline.ts';
export { hooks, unreadableGate } from './hooks.ts';
export { recordSchemas, unsupportedSchemas } from './checks/state.ts';
import { approvalsCheck, ownedCheck, schemaCheck } from './checks/state.ts';

export const checks = [schemaCheck, approvalsCheck, ownedCheck];
