# kernel

Shared types and utilities: the check, adapter and hook contracts. No step logic.

## Owns

Shared types and utilities that every module uses, and no step logic: the check contract (`Check`, `CheckResult`, PASS/FAIL/OFF), the 4 adapter interfaces every platform implements (components, screens with the links, page IDs, access and redirects of their routes, state fixtures, and the verify driver with fwos's harness files, the path that renders each state fixture, and the render `fwos doctor --start` runs) and the adopted-app ones a platform may add (the app's own test commands, a change's map onto the code), what a run of the app as one role and flag setting showed (`IaRun`), the hook contract, the inventory a platform reads from an existing app for `fwos adopt` (`inventory.ts`), the comparison gallery's contract and its results file (`gallery.ts`), a team's review workflow (`workflow.ts`: branch prefixes, pull request template) and code owners (`owners.ts`, CODEOWNERS read as GitHub does), project paths and an adopted app's level and the stages its team keeps (`ADOPT_STAGES`, `STAGE_LABELS`), the pack (`pack.ts`: the five files of yours fwos reads, each with the schema this release reads), file walking, globs, the source lexer (`text.ts`), the import reader built on it (`imports.ts`) and the resolver (`resolve.ts`), hashing, JSON Schema validation, JUnit result parsing (and Jest's JSON turned into JUnit), the harness's run records bound to a content-hash revision of the app (`runs.ts`, with `schema/run.schema.json`), the rendered-state contract that judges what a state's fixture showed, its dead hit areas included, and the classes of defect a set of states lets the harness catch (`rendered.ts`), the verdict both state checks share, a passing tagged test plus a fresh render proof (`proofs.ts`), and the house rules every skill links to.

## Public entry

`index.ts` (runtime) and `testing.ts` (test helpers: temp projects, check contexts, a stand-in harness and its run records).

## Skills and agents

None. `knowledge/house-rules.md` (how to ask, approvals, what fwos never does) and `knowledge/cli.md` (every command) are linked from every skill. `knowledge/adopted-app.md` (how a change works in an app fwos didn't create) is linked from the adopt, change, spec, build and accept skills.

## Checks

None of its own. `check.ts` defines what a check is; `off()` and `result()` build results.

## Depends on

Nothing. Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

`tests/kernel.test.ts` covers globs, JSONC, front matter, hashing, walking and the project loader; `tests/rendered.test.ts` the state contract; `tests/runs.test.ts` the revision and when a run counts. `fwos harness status` says why a run no longer counts. A path that a check "can't see" is usually `paths.ignore` or a glob in `project.ts` defaults.
