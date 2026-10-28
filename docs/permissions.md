# Permissions

At step 0, fwos can offer exact command entries for the project's `.claude/settings.json`. It
shows each entry and asks before merging it into `permissions.allow`, preserving your existing
entries. Choose only the commands you want to run without another prompt.

## What runs

| Command | Why |
|---|---|
| `node <plugin>/dist/fwos.mjs check`, `check --staged`, `status`, `next --json`, `doctor --json` | Inspect checks and workflow state; approve each exact invocation separately |
| `pnpm typecheck`, `pnpm test`, `pnpm e2e` | Run the app's own scripts; these execute project code |
| `pnpm install`, `pnpm --filter web exec playwright install chromium` | Install dependencies or the browser, after asking each time |
| `git status --short`, `git diff` | Read working-tree state and changes |
| `git init`, `git switch -c <branch>`, `git commit` | Change repository state, only after your yes |

## Example entries

Replace the plugin path with its real absolute path, preserving the quotes. Each entry approves
one full command line, including its arguments; it does not approve another subcommand or flags.

```json
{
  "permissions": {
    "allow": [
      "Bash(node \"/absolute/path/to/the/plugin/dist/fwos.mjs\" check)",
      "Bash(node \"/absolute/path/to/the/plugin/dist/fwos.mjs\" check --staged)",
      "Bash(node \"/absolute/path/to/the/plugin/dist/fwos.mjs\" status)",
      "Bash(node \"/absolute/path/to/the/plugin/dist/fwos.mjs\" next --json)",
      "Bash(node \"/absolute/path/to/the/plugin/dist/fwos.mjs\" doctor --json)",
      "Bash(pnpm typecheck)",
      "Bash(pnpm test)",
      "Bash(pnpm e2e)",
      "Bash(git status --short)",
      "Bash(git diff)"
    ]
  }
}
```

Commands that write approvals, install packages, run arbitrary test scripts or change git state
are not covered by these fwos inspection entries. If you want another invocation pre-approved,
review and add that exact command separately; never use an arbitrary-argument prefix or a pattern
such as `Bash(node:*fwos.mjs*)` that also matches another script with that name.

After a plugin update moves its versioned folder, these absolute paths stop matching. Review the
new path before updating each entry.

## Removing entries

`fwos eject` previews the permission entries it recognizes and removes only those on confirmation.
It recognizes the absolute-path arbitrary-argument prefix used by older step 0 versions and the
older `Bash(node:*fwos.mjs*)` pattern. Exact-command entries stay and are listed as still using fwos,
because eject cannot distinguish its suggested entries from ones you chose yourself.

Review that list and remove unwanted exact-command entries yourself after ejecting. The `pnpm`
and `git` entries stay too. The hooks are guardrails, not a security boundary; a shell command can
write past them, and bypass mode removes further host approval checks.
