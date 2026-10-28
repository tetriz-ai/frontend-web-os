# shells/cli

The fwos CLI: check, doctor, report and every command.

## Owns

The `fwos` CLI: the check runner (gates first, fail closed), doctor, the report, and every command. It wires module checks to platform profiles; no step logic lives here. `adopt.ts` turns a platform's inventory of an existing app into the proposal `fwos adopt` prints, applies it, and computes the capabilities of each adoption level that `fwos status` and `fwos doctor` show. `stages.ts` turns the same inventory into the six stages, from the idea to its acceptance, that the proposal and `fwos status` show: what the team does today, the gap, what fwos adds and the evidence, and which stages the team keeps (`--keep`, `--use`). `testrun.ts` runs an adopted app's own test scripts for `fwos tests run`, as the platform builds them, and records each run. `repo.ts` asks git and the repo's own tooling where the commit hook goes and which workflow lines run fwos. `codex.ts` writes fwos's agents for Codex (`.codex/agents/fwos-*.toml`), generated from the same agent files Claude Code reads. `vendor.ts` plans and writes the copy of this CLI in `.fwos/cli/` (every file read before any is written), and `update.ts` is `fwos update`: the schema of every pack file and record, migrations, and that refresh. `fwos harness` writes the web platform's harness into the app and is the other end of it: `targets` (`targets.ts`) tells each harness test what to render or open and where, and `record` judges what it saw and keeps the run. `doctor.ts` reads only, unless `--start` asks it to render the first of those targets through the platform's verify driver before it calls the driver active. `prototype.ts` is `fwos prototype`: it checks each bundle, promotes one once its inputs are committed (pinned in `.fwos/prototypes.json`), and compares its intended IA with the app and the fresh runs of the IA harness.

## Public entry

`main.ts` (bundled into `dist/fwos.mjs` by `scripts/build.mjs`).

## Skills and agents

None (the `doctor` skill runs `fwos doctor`).

## Checks

Runs all of them. `registry.ts` is the one place checks and profiles are listed.

## Depends on

Anything (`*`); nothing depends on a shell. Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

Run from source while developing: `node plugin/shells/cli/main.ts <command>` (Node 24+). Integration tests in `tests/` drive the real CLI against temp projects.
