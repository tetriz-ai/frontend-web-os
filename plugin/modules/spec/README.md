# spec

The spec sections, the AC format, the spec reviewer.

## Owns

Step 6a: the 13 spec sections (four for an adopted app's delta), the AC ID format (`AC-<feature>-<n>`), AC writing guidance, the spec reviewer, and a change's own criteria in an adopted app (`delta.ts`: those it added or changed against the spec when it began, apart from those it carries). The blocks that trace an adopted app's change (`request.ts`: its asks as `REQ-<n>`, its questions as `Q-<n>` with their answers, the `## States` table), and two readings of its words that need no model (`clarity.ts`: the terms in a criterion that need interpretation, after ISO/IEC/IEEE 29148, and the states a change's interactions bring).

## Public entry

`index.ts`: `parseAcs`, `parseBlocks`, `acReferences`, `acTexts`, `acHashes`, `acDelta`, `parseRequest`, `parseQuestions`, `parseStates`, `vagueTerms`, `statesBrought`, `SPEC_SECTIONS`, `specPath`, `checks`.

## Skills and agents

Skill `spec` (also runs the test planner from the tests module). Agent `spec-reviewer` (read-only verdict). Knowledge `knowledge/ac-writing.md`. Template `templates/spec.md`.

## Checks

`spec/format` (every section, ACs unique and well formed with "proven against", no dangling AC references, the size ceiling; in an adopted app's open change, criteria of its own and a Context that names each file it maps).

## Depends on

`kernel`, `state`, `discovery`, `architecture`, `design-system`, `screens` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

An AC the parser misses: the heading must be `### AC-<feature>-<n>: <title>`, the feature in lowercase letters, digits and hyphens. `spec/format` flags any other heading that starts with `AC-` as `ac-malformed`; see `tests/spec.test.ts`.
