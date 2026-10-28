#!/usr/bin/env node
// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The GitHub Release archive contains the checks CLI. Full agent definitions belong to the installed host plugin.
import { fileURLToPath } from 'node:url';
globalThis[Symbol.for('fwos.cliOnlyDistribution')] = true;
const entry = new URL('../../plugin/dist/fwos.mjs', import.meta.url);
process.argv[1] = fileURLToPath(entry);
await import(entry.href);
