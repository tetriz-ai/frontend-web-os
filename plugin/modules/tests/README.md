# tests

The test planner and writer, test plan, traceability, locked tests.

## Owns

Step 6b and the test side of 7: the test-planner and test-writer agents, the test-plan format (with an adopted app's regression scope), the level router, traceability from JUnit results, locked tests, red-run evidence, quarantine, and the record of the project's own test runs (run records of kind `tests` in `.fwos/local/runs/tests/`, written by `fwos tests run` and counted at acceptance only while input and produced-result hashes match).

## Public entry

`index.ts`: `parseTestPlan`, `parseRegressionScope`, `runnersOf` (which levels the app's own test scripts can run), `traceAcs`, `lockTests`, `unlockTest`, `lockedFiles`, `locksLostSinceCommit`, `isLocked`, `readQuarantine`, `readTestRuns`, `recordRun`, `browserResults`, `regressionResults`, `checks`, `hooks`.

## Skills and agents

Agents `test-planner` (no tools; it never sees code) and `test-writer`. Knowledge `knowledge/level-router.md`. Template `templates/test-plan.md`.

## Checks

`tests/plan` (every AC has a case; default rows present), `tests/traceability` (every first-release AC has a passing, tagged test that ran; quarantined and flaky ones don't count), `tests/locked` (no locked test changed without a recorded unlock, by any tool, and no lock the last commit holds dropped or re-hashed), `tests/regression` (in an adopted app, the existing tests a change names as its regression scope passed, and by acceptance all ran). In an adopted app's open change, `tests/plan` also wants a browser case for one of its own criteria (or `GAP-browser`) and a regression scope naming each test `fwos change map` found, and `tests/traceability` proves a criterion with a browser case only by a test from a browser run. Hooks: deny every tool call from the test planner; deny edits to locked tests.

## Depends on

`kernel`, `state`, `spec`, `rules` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

"No test ran": the test name must carry `@AC-<id>` and its JUnit file must land in `.fwos/local/results/`. At acceptance run `fwos tests run` to bind it to current application/test inputs and result bytes; copied or edited XML does not count. `fwos tests status` lists locks.
