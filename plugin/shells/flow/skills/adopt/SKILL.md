---
name: adopt
description: 'Preview what fwos would reuse, add and change in an existing Next.js app, then enable checks, design-system adoption or change delivery after approval. Use for /fwos:adopt or a request to adopt an existing app.'
argument-hint: '[--app <dir>] [--level checks|design|delivery]'
---

# /fwos:adopt

Read ${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/house-rules.md and
${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/adopted-app.md first. `fwos` means
`node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

The user's input: `$ARGUMENTS`

## 1. Read before you propose

Run `fwos adopt --json`, with `--app` or `--level` if the input has them. It writes nothing.

- `support` is `unsupported`: say why in one line (the `limits` text) and stop. Offer a new app in
  a subfolder with /fwos:start, or nothing.
- `adopted` is true: the app is adopted already. Show `change` (what the new level does) and the
  capabilities, then go to step 4.

## 2. Show the proposal

Short, in this order, quoting paths exactly as `fwos adopt` gives them:

- **Found**: one line per area, with the file it came from, then the **Not found** areas. Never fill
  a gap with a guess: an unknown stays unknown until the user tells you.
- **Partly supported**: each limit, verbatim, if there are any.
- **What fwos would do** at that level: what it reuses, adds and changes, and what it leaves alone.
- **Hooks and config**: the `.fwos/state.json` it would write, and the agent hook, commit hook and
  CI previews, verbatim.
- **Levels**: the capabilities, on or off with why. Each level includes the ones before it.
  Suggest checks to start, unless the user asked for more.
- **Stages**: from `stages`, one line each: what the team has today (with the file), the gap fwos
  addresses, what it adds and the evidence that would show it helped. Quote them; claim nothing more.

## 3. Ask only what the repo can't answer

`decisions` lists what only the user can decide: which app in a monorepo, where fwos keeps its docs
when `docs/app/` is theirs, or a `design-system/` folder of their own. Ask each one at a time, with
your suggestion and why. Ask nothing the repo already answered. Then ask which level, and, once, whether the team already
serves any stage well enough to keep its own practice there (${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/adopted-app.md
says what keeping each stage means). Then "Adopt?".

## 4. Do it, on a yes

Run `fwos adopt --yes` with the flags the user chose (a kept stage is `--keep <stage> --reason
"<their words>"`), and show its output, then `fwos status`. It
writes `.fwos/` and the `.gitignore` line, records today's findings as the baseline, and at level
design imports the app's own theme, keeping a copy of it in `design-system/source/`. It never writes
fwos's starter design system.

At level design, offer the comparison: `fwos design-system report`, then `fwos design-system
gallery` and the command it prints, which renders the team's own components with their theme and
with the adopted tokens, side by side. ${CLAUDE_PLUGIN_ROOT}/modules/design-system/knowledge/fidelity.md
says what to show and what needs a decision. The gallery writes a dev-only route into the app and
needs Playwright there, so ask first.

Then offer these in one message, a yes or no each (house rules: ask first):

- the commit check: `fwos git-hook install`, or the line `fwos adopt` named for husky or lefthook,
- in Claude Code, the permission allowlist, with the entries and rules /fwos:start step 0 gives,
- the CLI in the project, which CI and the commit hook need: `fwos vendor`, then the package
  manager's add (`pnpm add -D file:.fwos/cli`). That edits package.json and the lockfile, so it's
  the user's call.

Never edit the team's package.json scripts, CI workflows, hooks, lint config or agent guidance
yourself. If they want fwos in CI, show the line and where it goes.

## Later

- `fwos adopt --level <level>` previews a level change, and `--yes` does it, keeping every record.
  A higher level takes the findings of the checks it turns on into the baseline, and nothing else.
- `fwos adopt --keep <stage> --reason "<why>"` keeps a stage the team's later, and `--use <stage>`
  gives it back to fwos. Neither touches a record.
- At level delivery, a request goes through /fwos:change.
- /fwos:eject removes fwos and leaves the app as the team had it.
