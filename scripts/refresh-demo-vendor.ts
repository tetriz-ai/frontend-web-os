// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Keep the runnable demo's distributed CLI on the current generated runtime. Update behavior is
// tested with controlled previous-vendor inputs in update.test.ts, not a historical executable.
import { fileURLToPath } from 'node:url';
import { applyVendor, planVendor } from '../plugin/shells/cli/vendor.ts';
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--check')) throw new Error('usage: node scripts/refresh-demo-vendor.ts [--check]');
const root = fileURLToPath(new URL('../demo/tip-splitter/', import.meta.url));
const plan = planVendor(root);
if (plan.refused.length) throw new Error(`demo vendor is edited: ${plan.refused.map((file) => file.path).join(', ')}`);
const changed = plan.writes.filter((file) => file.status !== 'unchanged').map((file) => file.path).concat(plan.removes);
if (args.includes('--check')) {
  if (changed.length) throw new Error(`stale demo vendor: ${changed.join(', ')}`);
  console.log('demo vendor: current generated runtime');
} else {
  const result = applyVendor(root, plan);
  console.log(`demo vendor: ${result.written.length} files refreshed; backup: ${result.backup ?? 'none'}`);
}
