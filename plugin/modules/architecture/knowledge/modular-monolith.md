# The modular monolith, as data

`docs/app/modules.json` lists each module, its path, its public entry and which modules it may
depend on. `fwos check walls` enforces it on every file: an import is allowed only into another
module's public entry, and only if `dependsOn` names that module. No cycles, in `dependsOn` or
in the imports themselves, so even modules with `"*"` can't import each other in a circle.

```json
{
  "schema": 1,
  "modules": [
    { "name": "app", "path": "apps/web/app", "kind": "app", "dependsOn": ["*"] },
    { "name": "reading-list", "path": "apps/web/src/features/reading-list", "kind": "feature",
      "dependsOn": ["shared-ui", "shared-lib", "api-contract"] },
    { "name": "shared-ui", "path": "apps/web/src/shared/ui", "kind": "shared", "dependsOn": ["shared-lib"] }
  ]
}
```

Fields: `name` (kebab-case), `path` (from the project root), `kind` (feature, shared, app, shell),
`entry` (public files relative to `path`, default `index.ts`/`index.tsx`), `dependsOn` (module
names, or `"*"` for route files that wire everything), `bannedImports` (globs matched against
the import as written and the package it names, a workspace package too, e.g. `"next/*"` in a
package shared with Electron), `description`.

## Rules of thumb

- One feature, one folder, one `index.ts`. Other code imports only that.
- Features don't import each other unless the spec says one builds on the other; then name it.
- Shared code lives in `shared/` (ui, lib, data) and depends on nothing feature-shaped.
- Route files (`app/`) are thin and may import any feature's entry.
- The scaffold's default modules.json covers app, screens, shared-ui, shared-lib, shared-nav,
  shared-data and api-contract. Add one entry per feature.
- `spikes/` is outside every module, and nothing may import from it.

## Changing it

The architecture changes only when the user asks. Update modules.json, run `fwos check walls`,
and record the decision. The plugin itself is built the same way; see its own modules.json.
