# Extending fwos

fwos is built so you can add to it without forking. Each extension point has fixtures, so a new
piece proves itself.

## Add a rule to your project

Put it under `custom:` in `design-system/rules.yaml`. It needs passing fixtures, or `fwos check`
fails:

```yaml
schema: 1
custom:
  - id: no-moment
    title: Use date-fns, not moment
    hardness: check
    files: ["**/*.{ts,tsx}"]
    pattern: "from ['\"]moment['\"]"
    message: moment is large and mutable.
    fix: Import from date-fns.
    fixtures:
      bad: ["import m from 'moment';"]
      good: ["import { format } from 'date-fns';"]
```

Turn a pack rule off or soften it: `rules: { no-pie-chart: off }` or
`rules: { no-raw-intl: { hardness: review, exclude: ["src/legacy/**"] } }`.

## Add a rule to the pack

One YAML file in `plugin/modules/rules/pack/`, same shape as above
([schema](../plugin/modules/rules/schema/rule.schema.json)). The test suite runs every rule's
fixtures. Open a pull request titled `feat(rules): <rule id>`.

## Add a check

1. Write it in the module that owns its input: `plugin/modules/<module>/checks/<name>.ts`,
   implementing `Check` from `plugin/kernel/check.ts`. Return `off(id, reason)` whenever it can't
   run, and say why. Never pass on zero inputs.
2. Export it from the module's `index.ts` `checks` list. The CLI picks it up in
   `plugin/shells/cli/registry.ts` (module checks are listed once there).
3. Add a good and a bad fixture: describe them in `scripts/make-fixtures.ts`, run `pnpm fixtures`.
   `plugin/shells/cli/tests/fixtures.test.ts` then proves the bad one fails and the good one passes.
4. Document it in [checks.md](checks.md).

## Add a platform

A platform implements the 4 adapter interfaces in `plugin/kernel/adapters.ts`:

| Adapter | Does |
|---|---|
| Components | registry ID to the platform's component; which registered components are installed |
| Screens | walks the real app and returns every screen (routes, windows, scenes) |
| State fixtures | turns the contract's JSON fixtures into the platform's fakes |
| Verify driver | drives the real app for the verify loop |

Export a `PlatformProfile` (adapters, checks, tool probes, status) from
`plugin/platforms/<name>/index.ts`, add a profile skill, and register it in
`plugin/shells/cli/registry.ts`. No step module changes: they only see the interfaces. A platform
can also ship as a separate plugin that depends on fwos.

## Add a component to the registry

Components live in the user's project (`apps/web/src/shared/ui/`) and in
`design-system/components.json`. To offer one to everyone, add it to the scaffold template
(`plugin/modules/screens/templates/web/apps/web/src/shared/ui/`) and the starter registry
(`plugin/modules/design-system/starter/components.json`), with a render test per required state in
`ui.test.tsx`. Style it with slot classes only.

## Add or change a module

Follow the module shape: `README.md` with the six fixed headings, `index.ts` as the only public
entry, and an entry in `plugin/modules.json` saying who it may depend on. `pnpm repo-check` runs the
walls on the plugin itself, including file references inside skills and agents.
