// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The import resolver lives in the kernel, so the design-system registry resolves imports the
// same way the walls check does. This keeps the walls check's import path.

export { Resolver, readWorkspace, type Resolved } from '../../kernel/index.ts';
