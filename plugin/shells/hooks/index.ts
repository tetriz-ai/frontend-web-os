// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Public entry of the hooks shell: the dispatcher that routes each hook event to the modules
// that own it. hooks.json (next to this file) is what Claude Code reads.

export { dispatch, readStdin, HANDLERS, type HookEvent, type HookResult } from './dispatch.ts';
