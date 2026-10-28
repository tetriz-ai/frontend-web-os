---
name: eject
description: 'Preview and remove Frontend Web OS tooling while keeping the user''s docs, design system and code. Use for /fwos:eject. Exact-command permission entries stay for the user to review.'
---

# /fwos:eject

`fwos` means `node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

1. Run `fwos eject` (no flags). It prints what would be removed and changes nothing.
2. Show that list to the user, and say what stays: `docs/app/`, `design-system/`, the app code,
   tests and the rest of the CI workflow (they're the user's), and any `pnpm` and `git` entries in
   the `.claude/settings.json` allowlist, which they may still want. The test configs lose only the
   JUnit reporter fwos reads. Mention that `.fwos/` holds the approval history; if they want to
   keep a record, they can copy it first. If it lists lines or permission entries it left alone,
   say they still use fwos, so the user may want to edit them. Exact-command allowlist entries
   remain, while recognized historical fwos prefix entries can be removed: this preserves entries
   the user may have chosen independently. A workflow line among them fails in
   CI once the pin to `.fwos/cli` is gone. While one still sends test results to `.fwos/local/`,
   the `.gitignore` lines for it stay too; after the user edits that line, `fwos eject` takes them
   out.
3. Ask: "Remove these?" Only on a clear yes, run `fwos eject --yes`.
4. If it says to run `pnpm install`, ask first, then run it: CI installs with a frozen lockfile,
   which fails until `pnpm-lock.yaml` drops `fwos-check`. The user commits the new lockfile.
5. Tell them the plugin itself stays installed; uninstall it with `claude plugin uninstall fwos`.
