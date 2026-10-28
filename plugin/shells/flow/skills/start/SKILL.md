---
name: start
description: 'Start or resume a Frontend Web OS project, from an app idea through requirements, tested implementation and acceptance. Use for /fwos:start, an app-building request or continuation of an fwos project.'
argument-hint: '"<idea>" [--quick] [--no-research] [--spike] [--answers <file>]'
---

# /fwos:start

Read ${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/house-rules.md first and follow it throughout. In this
skill, `fwos` means `node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

The user's input: `$ARGUMENTS`

You orchestrate. Each step's work lives in its own skill; your job is to find the current step,
load that skill, and keep the user oriented. You hold no step logic yourself.

## 1. Is this an fwos project yet?

Run `fwos next --json`.

**Not initialised** (`change` is null and `skill` is `fwos:start`): this is step 0.

1. Run `fwos doctor --json` quietly. Tell the user only what blocks a platform, with the fix
   ("Mac needs Xcode (not found): install it from the App Store"). Platforms marked "not in this
   release" can still be planned; say that once.
2. Detect the mode:
   - An empty folder (or only docs): a **new** app.
   - An existing app (a `package.json` with a framework, an `app/` or `src/` tree): fwos doesn't
     take it over. Hand over to `fwos:adopt` (/fwos:adopt), which reads the app and shows what fwos
     would reuse, add and change before it writes anything. The other options: build a new app in a
     subfolder, start a spike, or stop.
   - `--spike` in the input: run `fwos spike new <name>` and stop. Spikes have no approvals and
     no checks; app code can't import them.
3. Ask before each of these, one message listing them all with a yes/no each:
   - `git init` (if there's no repo),
   - `fwos init --name "<app name>" --platforms <web|...>` (platforms come from discovery T4; use
     `web` until then and add others later through the add-platform route),
   - installing the git commit check (`fwos git-hook install`), which runs `fwos check --staged`.
   - in Claude Code, writing a permission allowlist into `.claude/settings.json` so fwos commands
     don't prompt for the commands they choose. Offer each exact entry separately:
     `Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs" check)`,
     `Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs" check --staged)`,
     `Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs" status)`,
     `Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs" next --json)`,
     `Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs" doctor --json)`,
     `Bash(pnpm typecheck)`, `Bash(pnpm test)`, `Bash(pnpm e2e)`,
     `Bash(git status --short)`, `Bash(git diff)`. Explain that pnpm scripts execute project code.
     Expand the plugin folder to its real absolute path, using the same quotes as the command
     above (escape them in JSON). Never add arbitrary-argument prefixes or wildcard patterns.
     Additional commands, arguments, installs and approval writes need their own reviewed entry
     or a host prompt. Merge only the entries the user selected into existing `permissions.allow`;
     never remove their own entries. Exact entries are left and listed by eject for manual review,
     since it cannot distinguish these suggestions from user-chosen permissions. In Codex
     there's no allowlist file to write: its approval mode decides, and `fwos init` writes fwos's
     agents to `.codex/agents/` instead.
   In Codex, its sandbox keeps `.git/` and `.codex/` read-only even in a writable workspace. When
   `git init`, the commit hook or `fwos codex agents` is blocked, ask to run it outside the sandbox
   (Codex asks the user), or give the user the command to run in a terminal. Don't start the spec
   step without the agents: the test planner's isolation depends on them.
4. Then go to step 2 below.

**Initialised**: recap in exactly 3 lines, from files only (never chat history):
`Change <id> (<title>), step <step>.` / what was last approved or decided / what's next. Then
ask "Still right?" and wait.

If `fwos next` reports `stale`, show what changed (`fwos status`) before anything else, and ask:
re-approve as is, or route the edit as a change (/fwos:change).

## 2. Load the step

`fwos next --json` gives `skill` (e.g. `fwos:discovery`), `blocked` and `action`.

- If `blocked` isn't empty, follow `action`: it names the earlier approval that doesn't hold.
- Otherwise invoke the skill named in `skill` and follow it. It ends by recording an approval or a
  skip. Then run `fwos next --json` again and continue with the next skill, one step at a time.
- Between steps, say in one line what was just approved and what comes next.

Steps and their skills: discovery (`fwos:discovery`), research (`fwos:research`), architecture
(`fwos:architecture`), design-system (`fwos:design-system`), screens (`fwos:screens`), spec and test
plan (`fwos:spec`), build (`fwos:build`), accept (`fwos:accept`).

## 3. Flags

- `--quick`: discovery asks only topics T1 to T8 and defaults the rest as `[ASSUMED]`, then shows
  every assumption in one list before moving on. Tests are still required.
- `--spike`: run `fwos spike new <name>` and stop. A spike has no approvals and no checks.
- `--no-research`: skip research with `fwos skip research --reason "skipped with --no-research" --by "<name>"`.
- `--answers <file>`: scripted answers for CI. Refuse to run without the file. Every approval it
  gives is recorded with `--via autopilot --by autopilot`; the acceptance report flags them.

## 4. After acceptance

When `fwos next` says every change is done, treat any new request as a change: invoke
`fwos:change` with the user's text.

## What fwos doesn't build (say it up front, once)

- Phone apps (iOS, Android): offer responsive web or a PWA, and record the choice.
- Backends: offer an API contract with mocks, a local data mode (data saved on the device), or the
  user's existing API or hosted backend.
