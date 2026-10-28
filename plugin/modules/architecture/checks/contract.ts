// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// architecture/contract: fixtures validate against openapi.yaml, so mocks can't drift from the
// contract both sides test against.

import { type Check, off, result } from '../../../kernel/index.ts';
import { loadContract, validateFixtures } from '../contract.ts';

/** "1 fixture", "2 fixtures". */
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export const contractCheck: Check = {
  id: 'architecture/contract',
  title: 'API contract and fixtures',
  catches: 'a fixture that no longer matches openapi.yaml (unknown operation, undeclared status, wrong body shape)',
  platforms: ['web', 'electron', 'mac'],
  run({ project }) {
    const id = 'architecture/contract';
    let loaded;
    try {
      loaded = loadContract(project);
    } catch (e) {
      return result(id, [{ file: project.paths.contract, message: `openapi file can't be parsed: ${(e as Error).message}` }], [project.paths.contract]);
    }
    if (!loaded) return off(id, `no ${project.paths.contract}/openapi.yaml (no API contract yet)`);
    const { model, doc, problems, findings } = loaded;
    const inputs = [model.source, `${model.dir}/fixtures/*.json`];
    if (model.operations.length === 0 && model.fixtures.length === 0 && problems.length + findings.length === 0) {
      return off(id, `${model.source} has no operations yet (${project.mode === 'adopt' ? 'add the operations your app calls' : 'the architecture step fills it in'})`, inputs);
    }
    const all = [...problems.map((message) => ({ file: model.source, message })), ...findings, ...validateFixtures(project, doc, model)];
    const covered = new Set(model.fixtures.map((f) => f.operationId));
    const bare = model.operations.filter((o) => !covered.has(o.operationId)).map((o) => o.operationId);
    const info = [`${count(model.operations.length, 'operation')}, ${count(model.fixtures.length, 'fixture')}`];
    if (bare.length > 0) info.push(`no fixtures yet: ${bare.join(', ')}`);
    return result(id, all, inputs, undefined, info);
  },
};
