// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// rules/pack: the generic rules (raw Intl and dates, banned chart forms, fixed sleeps...) plus the
// project's own rules from design-system/rules.yaml. Project rules must carry passing fixtures.

import { type Check, type Finding, off, result } from '../../../kernel/index.ts';
import { effectiveRules, matchRule, rulesConfigPath, rulesFor } from '../engine.ts';

export const packCheck: Check = {
  id: 'rules/pack',
  title: 'Rule pack',
  catches: 'a pattern from any check-hardness rule in the rule pack (plugin/modules/rules/pack/) or in your design-system/rules.yaml',
  platforms: ['web', 'electron'],
  run({ project, staged }) {
    const id = 'rules/pack';
    const { rules, ignore, errors } = effectiveRules(project);
    const active = rulesFor(project.platforms, rules);
    const findings: Finding[] = errors.map((e) => ({ file: e.file, rule: 'rules.yaml', message: e.message }));
    if (active.length === 0) return errors.length > 0 ? result(id, findings, [rulesConfigPath(project)]) : off(id, 'every rule is turned off in rules.yaml');
    let scanned = 0;
    for (const rule of active) {
      // Generated output is skipped by where fwos writes it, never by a header a source file could copy.
      let files = project.files(rule.files, [...(rule.exclude ?? []), ...ignore, `${project.paths.tokensOut}/**`, `${project.paths.contract}/generated/**`]);
      if (staged) files = files.filter((f) => staged.includes(f));
      for (const f of files) {
        scanned++;
        findings.push(...matchRule(rule, f, project.read(f) ?? ''));
      }
    }
    if (scanned === 0 && findings.length === 0) return off(id, `no files match the ${active.length === 1 ? 'active rule' : `${active.length} active rules`}`, [rulesConfigPath(project)]);
    return result(id, findings, [rulesConfigPath(project), ...new Set(active.flatMap((r) => r.files))], undefined, [
      `${active.length} rule${active.length === 1 ? '' : 's'} active (${active.filter((r) => r.origin === 'project').length} from rules.yaml)`,
    ]);
  },
};

