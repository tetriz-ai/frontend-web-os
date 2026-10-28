# Enforce module walls

Two feature modules and a shared one, declared in `docs/app/modules.json`. The list feature imports the settings feature, which modules.json doesn't allow, and reaches past the shared module's public entry. The walls check reports both, with the file, the line and what modules.json does allow.

```sh
examples/enforce-module-walls/run.sh
```

```text
OFF   state/schema          not an fwos project (no .fwos/state.json); run /fwos:start
OFF   design-system/schema  no design-system/design-system.json yet; the design-system step writes it
FAIL  architecture/walls    2 findings
      apps/web/src/features/list/index.ts:1  imports ../../shared/ui/button, inside module "shared-ui"; import from its public entry apps/web/src/shared/ui/index.ts or apps/web/src/shared/ui/index.tsx
      apps/web/src/features/list/index.ts:2  module "list" may not depend on "settings" (imports ../settings); modules.json allows: shared-ui

0 pass, 1 fail, 2 off  NOT VERIFIED
exit code: 1
```
