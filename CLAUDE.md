# CLAUDE.md

## What this is

Frontend Web OS is a Claude Code and Codex plugin (`plugin/`) that takes an app idea to a tested Next.js app, plus `fwos`, a CLI whose 24 checks decide what "verified" means without calling a model.
It builds no backend, no phone app, and in this release no Electron or Mac app (those can be planned, not built).

## Layout

- `plugin/kernel/`: shared types and utilities, and the check, adapter and hook contracts.
- `plugin/modules/<step>/`: one folder per step (state, discovery, research, architecture, design-system, screens, spec, tests, build, accept, rules), each with its skills, agents, checks, schemas, templates, knowledge, tests and a README.
- `plugin/platforms/web/`: the Next.js adapters and web checks. `electron/` and `mac/` report "not in this release".
- `plugin/shells/`: `flow` (slash-command skills, next-step logic), `cli` (every command), `hooks` (`hooks.json` and the dispatcher).
- `distribution/plugin/`: the generated marketplace payload, with runtime and prompts but no development tests or fixtures. `pnpm build` refreshes it from `plugin/`.
- `plugin/modules.json`: the plugin's own module walls. `plugin/dist/fwos.mjs`: the bundle, built by `scripts/build.mjs`.
- `plugin/evals/`: `claude plugin eval` cases. `examples/`: runnable examples and the sample app.
- `demo/`: a real run of fwos: the tip-splitter app. It is project code under the root LICENSE, so its source files carry the header too, except the files its `.fwos/` records pin by hash (generated and vendored files, locked tests).
- `scripts/`: the build, the repo checks, the fixture generator, `run-examples.sh`, repo-level tests in `scripts/tests/`, and `npm/README.md`, the README for the packed CLI artifact distributed through GitHub Releases.

## Commands

Development needs Node 24.11 or newer, pnpm 10 and ShellCheck (or Docker, for the ShellCheck
fallback below). Install, typecheck, build and test also run on Node 22, and CI runs them on 22,
24 and 26. ESLint 10.13.0 uses Babel parser 8.0.7 for TypeScript syntax; tsc checks types. `pnpm repo-check` and `pnpm fixtures` run TypeScript
with Node directly, so they need Node 24.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm repo-check
pnpm fixtures:vendor
scripts/run-examples.sh
shellcheck scripts/*.sh examples/*/run.sh
```

Without ShellCheck installed, run it as CI does:
`docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.11.0 scripts/*.sh examples/*/run.sh`.

`pnpm fixtures:vendor` verifies the demo's vendored CLI against the current generated runtime; CONTRIBUTING.md describes regeneration. The CLI from source is `node plugin/shells/cli/main.ts`, and from the bundle `node plugin/dist/fwos.mjs`. `--help` lists every command, and `plugin/kernel/knowledge/cli.md` is the reference.

`pnpm test` skips four files, whose tests show as skipped. `pnpm test:e2e` runs `scripts/tests/e2e.test.ts`, `scripts/tests/adopt-unrelated-app.test.ts` and `scripts/tests/gallery.test.ts`: they scaffold a real app, adopt an unrelated open-source one and verify the rendered design-system gallery. They install dependencies and run browser suites, so they need the network. `pnpm test:codex` runs `scripts/tests/codex-live.test.ts` in real Codex CLI sessions: it needs a logged-in Codex CLI and spends a little usage.

## Contract to keep

- Every check passes its good fixture and fails its bad one. Pinned by `plugin/shells/cli/tests/fixtures.test.ts`.
- A gate check that fails stops every other check, which then report OFF. Pinned by `plugin/shells/cli/tests/cli.test.ts`.
- A pack file or `.fwos/` record from a schema fwos doesn't read fails closed: `state/schema` fails and nothing else runs. Pinned by `plugin/shells/cli/tests/pack.test.ts`.
- Refreshing `.fwos/cli` (`fwos vendor`, `fwos update`) writes nothing while a file there was patched, and backs up what it replaces. Pinned by `plugin/shells/cli/tests/vendor.test.ts` and `update.test.ts`.
- The checks and generated files follow the pack, with no fwos code naming it: the second pack (`examples/second-pack/`) differs from the sample's on every seam. Pinned by `scripts/tests/second-pack.test.ts`.
- A check that cannot run returns OFF with its reason, never a pass on zero inputs. Pinned by each module's tests, for example `plugin/modules/design-system/tests/design-system.test.ts`.
- Approvals are content hashes, and any later edit makes them stale. Pinned by `plugin/modules/state/tests/state.test.ts`.
- A locked test that changes without a recorded unlock fails `fwos check`, whatever tool edited it. Pinned by `plugin/modules/tests/tests/tests.test.ts`.
- fwos never overwrites a user's file or a hand-edited generated file. Pinned by `plugin/modules/state/tests/state.test.ts`.
- Hooks stay silent outside an fwos project and never break a session on bad state. Pinned by `plugin/shells/cli/tests/cli.test.ts`.
- The acceptance report is the same file for the same evidence. Pinned by `plugin/modules/accept/tests/accept.test.ts` and `plugin/shells/cli/tests/flow.test.ts`.
- A fresh scaffold passes its own `fwos check` with no failures. Pinned by `scripts/tests/e2e.test.ts` (`pnpm test:e2e`).
- Every source file starts with `Copyright 2026 Workloom Solutions Private Limited` and the SPDX line, and `plugin/` carries copies of LICENSE and NOTICE. Generated check fixtures, all files under examples/ and files an fwos record pins by hash are exempt. Pinned by `pnpm repo-check` (headers, manifest).

## Making a change

- Write the test first. A behaviour change needs a test that fails before the change and passes after it.
- A new or changed check needs fixtures: describe them in `scripts/make-fixtures.ts`, then run `pnpm fixtures`. CI runs `pnpm fixtures --check`, which fails when the committed fixtures differ from what the script writes.
- A new rule is one YAML file in `plugin/modules/rules/pack/` named after its id, with its own fixtures. CONTRIBUTING.md says how to set `rule` and `hardness`. Lenses point at the pack folder, so they need no edit.
- A change to what a check catches, a file format or a command's output needs a `CHANGELOG.md` line under Unreleased.
- Run `pnpm build` and commit `plugin/dist/` and `distribution/plugin/` with the change. `pnpm repo-check` fails when the bundle or `plugin.json` is stale.
- Text two prompts need goes in one `knowledge/` file that both link to. `pnpm repo-check` fails on repeated paragraphs.
- A module is used only through its `index.ts`, as `plugin/modules.json` allows. Prompts count: `${CLAUDE_PLUGIN_ROOT}/...` references are checked too.
- Each example is a folder under `examples/` with an executable `run.sh` (`chmod +x`) and a `README.md`: a paragraph, a `sh` block that runs from the repo root, then a `text` block with the expected output. `scripts/run-examples.sh` runs the `sh` block and compares. Copy `examples/catch-raw-design-values/` as the template: its `run.sh` finds the repo root and wraps the bundled CLI in an `fwos()` function. For code the token check should pass, use the slot classes `docs/checks.md` names under `design-system/tokens` (`bg-surface`, `text-fg`, `text-body`, `rounded-md`). Add a row to `examples/README.md` in the same form as the others (a goal, then a link to the folder), or `pnpm repo-check` fails.
- Commits use Conventional Commits.

## Do not

- Do not edit `plugin/dist/` by hand. It is generated by `pnpm build`.
- Do not leave a colon followed by a space unquoted in YAML front matter or workflows. `scripts/tests/yaml.test.ts` parses every YAML file.
- Do not delete `node_modules/` under `plugin/platforms/web/checks/fixtures/licences/`. They are fixtures, kept by a `.gitignore` exception.
- Do not add a runtime dependency that the bundle cannot inline. `dist/fwos.mjs` must run with no install.
- Do not put a header comment above a SKILL.md or agent front matter. The front matter must be line 1.
