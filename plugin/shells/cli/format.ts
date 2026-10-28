// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Human output for the CLI. Every check prints as PASS, FAIL or OFF with a reason.

import type { CheckResult } from '../../kernel/index.ts';

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
export const red = (s: string) => paint(31, s);
export const green = (s: string) => paint(32, s);
export const yellow = (s: string) => paint(33, s);
export const dim = (s: string) => paint(2, s);
export const bold = (s: string) => paint(1, s);

const LABEL = { pass: () => green('PASS'), fail: () => red('FAIL'), off: () => yellow('OFF ') };

export function formatResults(results: CheckResult[], opts: { maxFindings?: number } = {}): string {
  const max = opts.maxFindings ?? 20;
  const width = Math.max(...results.map((r) => r.id.length), 10);
  const lines: string[] = [];
  for (const r of results) {
    const why = [r.reason, ...(r.status === 'pass' ? (r.info ?? []) : [])].filter(Boolean).join('; ');
    lines.push(`${LABEL[r.status]()}  ${r.id.padEnd(width)}  ${dim(why)}`.trimEnd());
    for (const f of r.findings.slice(0, max)) {
      const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}  ` : '';
      lines.push(`      ${where}${f.message}`);
    }
    if (r.findings.length > max) lines.push(dim(`      ...and ${r.findings.length - max} more (use --json for all)`));
  }
  const n = (s: string) => results.filter((r) => r.status === s).length;
  lines.push('', `${bold(`${n('pass')} pass, ${n('fail')} fail, ${n('off')} off`)}${n('fail') > 0 ? red('  NOT VERIFIED') : ''}`);
  return lines.join('\n');
}
