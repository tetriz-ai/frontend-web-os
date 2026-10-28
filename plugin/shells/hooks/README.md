# shells/hooks

hooks.json and the one dispatcher.

## Owns

`hooks.json` and the one dispatcher. It routes each event to the module that owns the handler, merges outcomes (first deny wins) and stays silent unless the project has `.fwos/state.json`. Input it can't use (not JSON, or JSON that isn't an object) exits 0 with no output, so it never blocks a tool call. When fwos can't read its own state (a `.fwos/` file that doesn't parse, or a handler that throws), it can't tell what is approved or locked: it fails closed on app source and test files (state's `unreadableGate`), leaves the broken record, the docs and the design system writable for the repair, and warns once. An edited path is compared on disk: `..` is read as written, then symlinks are resolved and a disk that ignores case is read that way, so `E2E/` for `e2e/` or a link to the root is the same file. On such a disk the gated globs and locked paths also match in any case (`matchPath`, `samePath` in the kernel), so a folder first written as `Apps/` is still `apps/**`. `codex.ts` meets Codex's differences before the handlers run. A Codex `apply_patch` becomes one edit per file it touches, carrying the lines it adds there so the edit-time scans read them, and in an fwos project one whose files it can't read is denied. PreToolUse only denies (Codex treats context there as an error), and SessionStart tells the session where the plugin is, since Codex's shell has no `${CLAUDE_PLUGIN_ROOT}`.

The pre/post shell entry uses optional `jq` to read the payload working directory and checks its
ancestors for state before starting Node. Without `jq`, or for a working directory the shell cannot
check conservatively, it uses the Node entry. Both preserve every tool and its planner metadata.

SessionStart always loads the CLI so Codex learns its plugin folder even before an fwos project exists. PreToolUse keeps its
all-tools matcher because the test planner must also be denied reads and commands.

## Public entry

`index.ts`: `dispatch`, `HANDLERS`.

## Skills and agents

None.

## Checks

None. Handlers live in their modules: state (spec gate, records guard, generated-file warning, session summary), tests (planner sandbox, locked tests), design-system and rules (edit-time feedback).

## Depends on

Anything (`*`); nothing depends on a shell. Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

A blocked edit names the module and rule (`fwos [state/spec-gate]: ...`). Replay a hook by piping its JSON input into `node plugin/dist/fwos.mjs hook pre-tool-use`. `tests/hooks.test.ts` has the malformed-input and path-spelling cases, and `tests/codex.test.ts` the Codex payloads.
