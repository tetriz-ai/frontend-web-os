# shells/flow

Next-step logic, change routing and the user-facing skills.

## Owns

Orchestration only: which step a change is at, what blocks it, what to do next (`nextStep`, `setStep`, step gates), the change routing table, and the user-facing skills.

## Public entry

`index.ts`: `nextStep`, `setStep`, `gatesFor`, `adoptedEntry`, `STEP_SKILL`, `ROUTE_TABLE`, `ROUTE_ENTRY`, `ADOPTED_ROUTE_ENTRY`.

## Skills and agents

Skills `start`, `adopt`, `status`, `change`, `eject`, `doctor`. In an adopted app, a change enters at its own spec (or the build, for `code-only`) and answers only for the approvals it records (`ADOPTED_ROUTE_ENTRY`, `adoptedEntry`).

## Checks

None.

## Depends on

Anything (`*`); nothing depends on a shell. Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

`fwos next --json` shows exactly what `/fwos:start` will do and why. Gate logic is tested in `shells/cli/tests`.
