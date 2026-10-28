# platforms/mac

Not built in this release. A native Mac app can be planned, not built.

## Owns

The native Mac (SwiftUI) profile, not built in this release. Doctor already reports Xcode so you know what a Mac build will need.

## Public entry

`index.ts`: `profile` with status `unavailable` and an Xcode tool probe.

## Skills and agents

None yet.

## Checks

None yet.

## Depends on

`kernel` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

`fwos doctor` prints the status, the reason and whether Xcode is installed.
