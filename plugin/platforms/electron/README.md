# platforms/electron

Not built in this release. An Electron app can be planned, not built.

## Owns

The Electron profile, not built in this release. Planning (brief, research, architecture, spec, test plan) already covers it.

## Public entry

`index.ts`: `profile` with status `unavailable` and the reason doctor shows.

## Skills and agents

None yet.

## Checks

None yet.

## Depends on

`kernel` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

`fwos doctor` prints the status and reason.
