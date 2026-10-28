# Catch raw design values

A component that styles itself with a raw hex colour, Tailwind's default palette, a raw font size and a radius off the ladder. `fwos check` names each one with its line and the slot class to use instead. It needs no fwos project, so it works on any folder of app code, and the same scan runs on every edit while Claude writes code.

```sh
examples/catch-raw-design-values/run.sh
```

```text
OFF   state/schema          not an fwos project (no .fwos/state.json); run /fwos:start
OFF   design-system/schema  no design-system/design-system.json yet; the design-system step writes it
FAIL  design-system/tokens  4 findings
      apps/web/src/features/list/row.tsx:3  "bg-white" uses Tailwind's default palette; use a slot colour (bg-surface, text-fg, bg-brand, text-critical...)
      apps/web/src/features/list/row.tsx:3  "text-[#1f2937]" hard-codes a colour; use a slot colour class
      apps/web/src/features/list/row.tsx:3  "text-sm" is a raw font size; use a type role (text-body, text-label, text-heading...)
      apps/web/src/features/list/row.tsx:3  "rounded-xl" isn't on the radius ladder; use rounded-sm, rounded-md, rounded-lg or rounded-full

0 pass, 1 fail, 2 off  NOT VERIFIED
exit code: 1
```
