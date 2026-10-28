// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The rule pack: one YAML file per rule, each with a pattern and its own bad/good fixtures.
// Projects override rules (off, softer, scoped) and add their own in design-system/rules.yaml.
// Only `check` rules fail `fwos check`; `review` rules feed the lenses; `guidance` is prose.

import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  type Finding,
  type Platform,
  type Project,
  lexFile,
  lineOf,
  matchAny,
  pluginPath,
  readText,
  sourceKind,
  validateWith,
} from '../../kernel/index.ts';
import configSchema from './schema/rules-config.schema.json' with { type: 'json' };
import ruleSchema from './schema/rule.schema.json' with { type: 'json' };

export type Hardness = 'check' | 'review' | 'guidance';

export interface Rule {
  id: string;
  title: string;
  rule?: string;
  platforms?: Platform[];
  hardness: Hardness;
  files: string[];
  exclude?: string[];
  pattern: string;
  flags?: string;
  message: string;
  fix?: string;
  knowledge?: string;
  fixtures: { bad: string[]; good: string[] };
  /** Where it came from: the pack, or the project's rules.yaml. */
  origin?: 'pack' | 'project';
}

export const PACK_DIR = pluginPath('modules', 'rules', 'pack');

export function loadPack(): Rule[] {
  return readdirSync(PACK_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => ({ ...(parseYaml(readText(join(PACK_DIR, f)) ?? '') as Rule), origin: 'pack' as const }));
}

export function ruleErrors(raw: unknown): string[] {
  const errors = validateWith(ruleSchema, raw);
  if (errors.length > 0) return errors;
  const rule = raw as Rule;
  try {
    new RegExp(rule.pattern, `g${rule.flags ?? ''}`);
  } catch (e) {
    return [`pattern doesn't compile: ${(e as Error).message}`];
  }
  return fixtureErrors(rule);
}

/** Matches of one rule in one text. Comments are masked first, so prose about a banned call is fine. */
export function matchRule(rule: Rule, file: string, text: string): Finding[] {
  const kind = sourceKind(file);
  const masked = lexFile(file, text)?.masked ?? text;
  const re = new RegExp(rule.pattern, `g${rule.flags ?? ''}`);
  const marker = new RegExp(`fwos-ignore\\s+${rule.id}\\b`, 'g');
  // The mask blanks comments, so a marker is in a comment where the masked text differs. With no
  // known source kind nothing is masked, and a marker anywhere on the line counts.
  const ignored = (at: number) => {
    const from = text.lastIndexOf('\n', at - 1) + 1;
    const end = text.indexOf('\n', at);
    for (const hit of text.slice(from, end === -1 ? text.length : end).matchAll(marker)) {
      if (!kind || masked[from + hit.index] !== text[from + hit.index]) return true;
    }
    return false;
  };
  const out: Finding[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    if (ignored(m.index)) continue;
    const line = lineOf(masked, m.index);
    out.push({ file, line, rule: rule.id, message: rule.fix ? `${rule.message} Fix: ${rule.fix}` : rule.message });
  }
  return out;
}

/** Every bad fixture must match and every good one must not. */
export function fixtureErrors(rule: Rule): string[] {
  const errors: string[] = [];
  const sample = rule.files.find((g) => /tsx/.test(g)) ? 'fixture.tsx' : 'fixture.ts';
  for (const bad of rule.fixtures.bad) if (matchRule(rule, sample, bad).length === 0) errors.push(`bad fixture doesn't match: ${bad}`);
  for (const good of rule.fixtures.good) if (matchRule(rule, sample, good).length > 0) errors.push(`good fixture matches: ${good}`);
  return errors;
}

export interface RulesConfig {
  schema: 1;
  rules?: Record<string, 'off' | { hardness?: Hardness | 'off'; exclude?: string[] }> | null;
  custom?: unknown[] | null;
  ignore?: string[] | null;
}

export const rulesConfigPath = (p: Project) => posix.join(p.paths.designSystem, 'rules.yaml');

export interface EffectiveRules {
  rules: Rule[];
  ignore: string[];
  errors: { file: string; message: string }[];
}

/** The pack with the project's overrides applied and its custom rules added. */
export function effectiveRules(project: Project): EffectiveRules {
  const pack = loadPack();
  const path = rulesConfigPath(project);
  const text = project.read(path);
  const errors: EffectiveRules['errors'] = [];
  let config: RulesConfig = { schema: 1 };
  if (text !== null) {
    try {
      config = (parseYaml(text) as RulesConfig) ?? { schema: 1 };
      for (const e of validateWith(configSchema, config)) errors.push({ file: path, message: e });
    } catch (e) {
      errors.push({ file: path, message: `not valid YAML: ${(e as Error).message}` });
    }
  }
  const overrides = config.rules ?? {};
  for (const id of Object.keys(overrides)) {
    if (!pack.some((r) => r.id === id)) errors.push({ file: path, message: `rules: "${id}" isn't in the rule pack` });
  }
  const rules: Rule[] = [];
  for (const r of pack) {
    const o = overrides[r.id];
    if (o === 'off' || (typeof o === 'object' && o.hardness === 'off')) continue;
    const next = { ...r };
    if (typeof o === 'object') {
      if (o.hardness) next.hardness = o.hardness as Hardness;
      if (o.exclude) next.exclude = [...(r.exclude ?? []), ...o.exclude];
    }
    rules.push(next);
  }
  (config.custom ?? []).forEach((raw, i) => {
    const problems = ruleErrors(raw);
    if (problems.length > 0) {
      for (const p of problems) errors.push({ file: path, message: `custom[${i}]${(raw as { id?: string })?.id ? ` (${(raw as { id: string }).id})` : ''}: ${p}` });
      return;
    }
    const rule = raw as Rule;
    if (rules.some((r) => r.id === rule.id) || pack.some((r) => r.id === rule.id)) {
      errors.push({ file: path, message: `custom rule "${rule.id}" clashes with a pack rule; pick another id` });
      return;
    }
    rules.push({ ...rule, origin: 'project' });
  });
  return { rules, ignore: config.ignore ?? [], errors };
}

export function rulesFor(platforms: Platform[], rules: Rule[], hardness: Hardness = 'check'): Rule[] {
  return rules.filter((r) => r.hardness === hardness && (!r.platforms || r.platforms.some((p) => platforms.includes(p))));
}

/** Runs the check rules against one file's text (the edit hook passes only the inserted text). */
export function checkText(rules: Rule[], file: string, text: string): Finding[] {
  return rules.filter((r) => matchAny(file, r.files) && !matchAny(file, r.exclude ?? [])).flatMap((r) => matchRule(r, file, text));
}
