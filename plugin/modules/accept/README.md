# accept

The adjudicator, QA explorer and the acceptance report.

## Owns

Step 8: the acceptance report (generated, never hand-edited, deterministic; in an adopted app it keeps what people approved in the change apart from what it builds on, and lists the team's test runs, the criteria seen in a browser and the regression scope), the adjudicator and the exploratory QA agent, release readiness. And an adopted app's change traced from its request to its evidence (`trace.ts`: who served each stage, each ask and its criteria, the questions and their answers, the states, each criterion's cases and verdict), with what is still open at each handoff, for `fwos change trace`, `fwos next` and the report's `## Traceability`.

## Public entry

`index.ts`: `buildReport`, `reportPath`, `traceChange`, `traceText`, `openItems`, `openSummary`, `openLines`, `handoffName`.

## Skills and agents

Skill `accept`. Agents `adjudicator` (defaults to fail, tries to refute every pass) and `qa-explorer` (read-only, local app, mock or seed data). Knowledge `knowledge/release-readiness.md`.

## Checks

None of its own: `fwos report` runs every check and writes `docs/app/reports/acceptance.md`.

## Depends on

`kernel`, `state`, `tests`, `spec`, `build`, `design-system`, `rules` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

"Not done yet": the report's first section lists every blocker. The report is the same file for the same evidence, so an acceptance approval stays valid until the evidence changes.
