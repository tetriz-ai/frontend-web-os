// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Public entry of the build module: slice manifests, drift, a mapped change's drift, and the
// builder agent (text).

export * from './slices.ts';
export * from './scope.ts';
import { slicesCheck } from './checks/slices.ts';

export const checks = [slicesCheck];
