# architecture

Stack defaults, modules.json, the walls check, the API contract.

## Owns

Step 3: stack defaults, the modular monolith as data (`modules.json`), the walls check, and the API contract (OpenAPI plus JSON fixtures).

## Public entry

`index.ts`: `validateModuleMap`, `findCycles`, `ownerOf`, `runWalls`, `extractImports` (on the kernel's lexer, no parser dependency), `Resolver` (relative, tsconfig `paths`, `baseUrl` and `extends`, package.json `#imports`, workspace and installed packages; anything else is unresolved), `loadContract`, `validateFixtures`, `checks`.

## Skills and agents

Skill `architecture`. Knowledge `knowledge/stack-defaults.md`, `knowledge/modular-monolith.md`. Template `templates/decisions.md`.

## Checks

`architecture/walls` (imports and prompt references against modules.json: dependency, deep import, banned import, spikes, a relative import to no file, and cycles, in `dependsOn` and in the imports a `"*"` lets through; the same check runs on this plugin), `architecture/contract` (fixtures validate against openapi.yaml), `architecture/mocks` (the mocks generated from the contract match it and its fixtures).

## Depends on

`kernel`, `discovery` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

A wall finding names the file, line, the two modules and what modules.json allows. `tests/architecture.test.ts` has the resolver cases and exercises the import lexer. Both live in the kernel (`plugin/kernel/imports.ts`, `plugin/kernel/resolve.ts`), so the registry check reads imports the same way; add a case for any import form they misread.
