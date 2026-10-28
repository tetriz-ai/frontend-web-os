# Contributing

Thank you for helping. Please open an issue before starting on a new check, rule, step or
platform, so we can agree on the scope before you write the code.

## Run the checks

Use `nvm use` to select the version in `.nvmrc`. These match the checked-in CI workflow. Run them locally while repository Actions are disabled.
Development needs Node 24.11 or newer (the repo runs its
TypeScript scripts with Node directly), pnpm 10 and [ShellCheck](https://www.shellcheck.net/)
0.11.0, the version CI pins.

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

`pnpm test:e2e` scaffolds a real app, installs it and runs its whole suite against a production
build. It also adopts an unrelated open-source app (nextjs/saas-starter, pinned to one commit) and
proves that every check `fwos doctor` calls ON there catches a planted violation. It needs the
network. Run it when you touch the scaffold template in
`plugin/modules/screens/templates/web/`, adopt mode, or what turns a check on or off.

`pnpm test` runs the same proof on `examples/reading-list` (`scripts/tests/doctor-truth.test.ts`).
A new check needs a planted violation in `scripts/tests/support/truth.ts`, or that test fails.

`pnpm test:codex` installs the plugin into a throwaway Codex home and checks it in real Codex CLI
sessions. It needs a logged-in Codex CLI and spends a little usage. Run it when you touch the
hooks, the agents or anything Codex reads (`plugin/shells/hooks/codex.ts`, `plugin/shells/cli/codex.ts`).

To try the plugin from your checkout, open a terminal in an empty folder and run
`claude --plugin-dir <path-to-your-clone>/plugin`.

## Every change needs a test

A pull request without a test is not merged. A behaviour change needs a test that fails before
the change and passes after it.

- **A check** gets a good and a bad fixture: describe them in `scripts/make-fixtures.ts` and run
  `pnpm fixtures`. The suite proves the bad one fails and the good one passes, and CI's
  `pnpm fixtures --check` fails when the committed fixtures differ from what the script writes.
- **An example** is a folder in `examples/` with an executable `run.sh` and a README whose `sh`
  block runs from the repo root and whose last block is the expected output. Add it to
  `examples/README.md`.
- **A rule** is one YAML file in `plugin/modules/rules/pack/`, named after its `id`, with its own
  `bad` and `good` fixtures that the suite runs.
  - `rule` names the knowledge rule it enforces (`R-<group>-<n>`, from `plugin/modules/rules/knowledge/`).
  - `hardness: check` is for a pattern that is wrong wherever it appears in the files the rule
    names. Use `review` for anything else, so a lens weighs it.
  - Add a test to `plugin/modules/rules/tests/rules.test.ts` that fails before the rule exists.
- **A change to what a check catches, a file format or a command's output** is a breaking change
  (see "Versioning and compatibility" in the README), so it also needs a `CHANGELOG.md` line
  under Unreleased.

## How the code is organised

The plugin is a modular monolith. Each module's `README.md` says what it owns, its public entry,
its skills and agents, its checks, what it may depend on and how to debug it.

- **One home for everything.** Text two prompts need goes in a `knowledge/` file once, and both
  link to it. `pnpm repo-check` fails on repeated paragraphs and code blocks.
- **Walls.** A module is used only through its `index.ts`, and only by modules that
  `plugin/modules.json` allows. The walls check runs on the plugin itself, prompts included.
- **No model calls in `fwos check`.** Anything that needs judgement is a lens or an agent.
- **Off, never a fake pass.** A check that can't run returns `off(id, reason)`.
- **Build output is committed.** `pnpm build` refreshes `plugin/dist/fwos.mjs` and the lightweight
  marketplace payload in `distribution/plugin/`. Commit both with your change. The repo check
  fails if either is stale.
- **Plain writing** in docs and prompts: short sentences, everyday words, no em-dashes.

## Refresh the demo CLI

The CLI in `demo/tip-splitter/.fwos/cli/` stays on the current generated runtime. After `pnpm build`,
`node scripts/refresh-demo-vendor.ts` refreshes it through the normal vendor path, backing up replacements in the demo's ignored local directory. `pnpm fixtures:vendor` checks without writes.

Update tests construct explicitly synthetic stale vendor inputs from the current runtime and verify backup, preservation, refusal and runnable upgrades.

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): a short subject such
as `fix(walls): resolve tsconfig paths in nested apps`, a blank line, then a body that says why.

ESLint 10.13.0 and Babel parser 8.0.7 are locked dev dependencies. `pnpm lint` checks
semantic errors; the TypeScript compiler checks types.

## Licensing of contributions

No sign-off line and no separately signed agreement are needed. Contributions are accepted under
the terms in [LICENSE](LICENSE).
