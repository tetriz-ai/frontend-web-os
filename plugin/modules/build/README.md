# build

The builder agent, slice manifests, drift.

## Owns

Step 7: the builder agent (one shared core plus the platform profile), slice manifests, drift, and an adopted app's change drift (`scope.ts`: an existing source file the change edited outside what it maps).

## Public entry

`index.ts`: `loadSlices`, `sliceDrift`, `changedFiles`, `changeDrift`, `checks`.

## Skills and agents

Skill `build`. Agent `builder`. Knowledge `knowledge/slice-manifest.md`.

## Checks

`build/slices` (each manifest's modules, components, screens, states and claimed ACs match reality).

## Depends on

`kernel`, `state`, `tests`, `spec`, `architecture`, `design-system`, `screens`, `rules` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

`fwos slice drift <S1> --base <ref>` lists every file outside the slice's modules and new dependencies without a decision row. In an adopted app, `fwos change drift` lists the open change's edits outside what it maps, from git since the change began.
