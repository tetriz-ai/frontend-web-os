// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// build/slices: every slice manifest is valid and matches reality: its modules exist, its
// components are registered, its screens are in ia.json, and the ACs it claims are proven.

import { posix } from 'node:path';
import { type Check, type Finding, off, result } from '../../../kernel/index.ts';
import { loadModuleMap } from '../../architecture/index.ts';
import { loadComponents } from '../../design-system/index.ts';
import { loadIa } from '../../screens/index.ts';
import { traceAcs } from '../../tests/index.ts';
import { SLICES_GLOB, loadSlices } from '../slices.ts';

export const slicesCheck: Check = {
  id: 'build/slices',
  title: 'Slice manifests match the results',
  catches: 'a slice claiming an AC that no test proves, an unregistered component, an unknown screen or module',
  platforms: ['web', 'electron', 'mac'],
  run({ project }) {
    const id = 'build/slices';
    const slices = loadSlices(project);
    if (slices.length === 0) {
      const writer = project.mode === 'adopt' ? "adopt mode checks the app as it is and doesn't build in slices" : 'the build step writes one per slice';
      return off(id, `no slice manifests yet; ${writer}`, [SLICES_GLOB]);
    }
    const modules = new Set((loadModuleMap(project.abs(posix.join(project.paths.docs, 'modules.json')))?.modules ?? []).map((m) => m.name));
    const components = new Set((loadComponents(project)?.components ?? []).map((c) => c.id));
    const ia = loadIa(project)?.ia;
    const pages = new Map((ia?.pages ?? []).map((p) => [p.id, p]));
    const trace = traceAcs(project);
    const verdicts = new Map((trace?.acs ?? []).map((t) => [t.ac.id, t.verdict]));
    const haveResults = (trace?.cases.length ?? 0) > 0;
    const findings: Finding[] = [];
    for (const s of slices) {
      if (!s.manifest) {
        for (const e of s.errors) findings.push({ file: s.path, rule: 'schema', message: e });
        continue;
      }
      const m = s.manifest;
      const at = (message: string, rule: string) => findings.push({ file: s.path, rule, message: `${m.slice}: ${message}` });
      for (const mod of m.modules) if (modules.size > 0 && !modules.has(mod)) at(`module "${mod}" isn't in modules.json`, 'module');
      for (const c of m.components ?? []) if (!components.has(c)) at(`component "${c}" isn't registered in components.json`, 'component');
      for (const p of m.screens ?? []) if (ia && !pages.has(p)) at(`screen "${p}" isn't in ia.json`, 'screen');
      for (const st of m.states ?? []) {
        const [page, state] = st.split(':') as [string, string];
        const def = pages.get(page);
        if (ia && def && !def.states.includes(state)) at(`state "${st}" isn't a state of ${page} in ia.json`, 'state');
      }
      for (const ac of m.acs) {
        const v = verdicts.get(ac);
        if (!v) at(`claims ${ac}, which the spec doesn't define`, 'ac');
        else if (m.status === 'done' && haveResults && v !== 'proven' && v !== 'manual') at(`is done but ${ac} is ${v}`, 'ac');
      }
    }
    const info = haveResults ? [] : ['no test results, so claimed ACs were checked against the spec only'];
    return result(id, findings, [SLICES_GLOB], undefined, [`${slices.length} slice${slices.length === 1 ? '' : 's'}`, ...info]);
  },
};
