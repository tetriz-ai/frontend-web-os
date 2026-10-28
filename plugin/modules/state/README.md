# state

Change files, approvals as hashes, staleness, the lock, baseline, file ownership.

## Owns

Everything under `.fwos/`: `state.json` (with an adopted app's level and the stages its team keeps), change files (`changes/<id>.json`, with the links a change came from, each with the stage it is the team's artifact for, and for an adopted app's change its `base` criteria and its `map`), approvals recorded as content hashes (with the review a yes came from; in an adopted app only a change's own spec, once mapped, and acceptance), `based_on` staleness, the session lock, the baseline (adopt mode: it names the checks it covers, a covered check only shrinks, and no more is honoured than the last commit's baseline holds), the manifest of generated files and the provenance ledger of files fwos wrote that are yours, and the backups taken before a command replaces or removes one of fwos's files (`.fwos/local/backup/`).

## Public entry

`index.ts`: `initProject`, `setAdoptLevel`, `setKeptStages`, `keptStages`, `isAdoptionRecord`, `addLinks`, `createChange`, `currentChange`, `changesAtHead` (the change files as the last commit has them), `approve`, `skip`, `approvalState`, `changeApprovalState` (one change's own approval, for an adopted app), `baselineAtHead`, `honouredBaseline`, `docStaleness`, `stampBasedOn`, `writeOwned`, `writeOwnedAll` (a set of files, all or none), `ownedStatus` (what a write would do, read before any is made), `removeOwned`, `backupFiles`, `writeYours`, `recordSchemas` and `unsupportedSchemas` (each record's and pack file's schema against the one this fwos reads), `acquireLock`, `applyBaseline`, `writeBaseline`, plus `hooks`, `unreadableGate` (the edit gate while `.fwos/` can't be read) and `checks`.

## Skills and agents

None.

## Checks

`state/schema` (gate: fails closed on a record or pack file from a schema this fwos doesn't read), `state/approvals` (from build on, every approval the build rests on still matches its hash), `state/owned` (no generated file edited by hand). Hooks: the spec gate (PreToolUse; in an adopted app only at level delivery, only on that app, and only while a change is open), the records guard (the edit tools can't write fwos's own records in `.fwos/`; slice manifests, the quarantine and `.fwos/local/` stay writable, and so does a record state/schema rejects, for the repair), the generated-file warning, the SessionStart one-line summary, and a SessionStart line for each file from a schema this fwos doesn't read.

## Depends on

`kernel` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

An approval that looks stale: `fwos status` names the files whose hash changed. The schemas are in `schema/`. `.fwos/local/log.jsonl` in the user's project records every command.
