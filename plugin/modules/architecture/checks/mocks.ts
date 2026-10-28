// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// architecture/mocks: the mocks each platform generates from the contract (the mock fetch on web)
// match openapi.yaml and its fixtures, so no test runs against a route the contract no longer has.
// `fwos contract mocks --check` asks the same, but CI runs `fwos check`.

import { type Check, type Finding, off, result } from '../../../kernel/index.ts';
import { loadContract } from '../contract.ts';

const REGENERATE = 'run `fwos contract mocks`';

export const mocksCheck: Check = {
  id: 'architecture/mocks',
  title: 'Generated contract mocks current',
  catches: 'generated contract mocks (the mock fetch on web) out of date with openapi.yaml or its fixtures',
  platforms: ['web', 'electron', 'mac'],
  run({ project, adapters }) {
    const id = 'architecture/mocks';
    let loaded;
    try {
      loaded = loadContract(project);
    } catch {
      return off(id, `the openapi file in ${project.paths.contract} can't be parsed (see architecture/contract)`, [project.paths.contract]);
    }
    if (!loaded) return off(id, `no ${project.paths.contract}/openapi.yaml (no API contract yet)`);
    const { model } = loaded;
    const inputs = [model.source, `${model.dir}/fixtures/*.json`];
    const generators = project.platforms.map((p) => adapters.get(p)?.fixtures).filter((g) => !!g);
    if (generators.length === 0) return off(id, `no mock generator for ${project.platforms.join(', ')}`, inputs);
    const outputs = generators.flatMap((g) => g.generate(project, model));
    if (outputs.length === 0) return off(id, `${model.source} has no operations yet, so there is no mock to generate`, inputs);
    // Never generated (an adopted app, or before the screens step): nothing can drift yet, so it's
    // off, not a "missing" finding a baseline would hide for good. Some generated and one gone still fails.
    if (outputs.every((o) => !project.exists(o.path))) return off(id, `mocks not generated yet (${outputs.map((o) => o.path).join(', ')}); ${REGENERATE}`, inputs);
    const findings: Finding[] = [];
    for (const o of outputs) {
      const disk = project.read(o.path);
      if (disk === null) findings.push({ file: o.path, rule: 'missing', message: `not generated yet; ${REGENERATE}` });
      else if (disk.replace(/\r\n/g, '\n') !== o.content) findings.push({ file: o.path, rule: 'drift', message: `out of date with ${model.source} and its fixtures; ${REGENERATE}` });
    }
    return result(id, findings, [...inputs, ...outputs.map((o) => o.path)]);
  },
};
