# design-system

The slot contract, DTCG intake, token build, registry, design checks.

## Owns

Step 4: the slot contract ([knowledge/slots.md](knowledge/slots.md)), DTCG loading and alias resolution, colour maths (hex, rgb, hsl, oklch, DTCG colour objects) and WCAG contrast, intake from a shadcn theme or the neutral starter, the generated CSS variables and Tailwind theme, and the component registry. Adoption fidelity ([knowledge/fidelity.md](knowledge/fidelity.md)): the source-to-target mapping for every input (`adoption.ts`), the gallery model, the decisions in `.fwos/fidelity.json` and the report that keeps the outcomes apart (`fidelity.ts`).

## Public entry

`index.ts`: `SLOTS`, `loadDesignSystem`, `loadComponents`, `tokenOutputs`, `fromShadcn`, `starterFiles`, `parseColor`, `contrast`, `nearestPassing`, `scanRawValues`, `checks`, `hooks`, and for fidelity `mapDesignSystem`, `galleryModel`, `decide`, `readDecisions`, `adoptionReport` and `formatOutcomes`.

## Skills and agents

Skill `design-system`. Knowledge `knowledge/slots.md` and `knowledge/fidelity.md`. The neutral starter in `starter/`.

## Checks

`design-system/schema` (gate), `design-system/contrast`, `design-system/chart-palette` (off while C9 is blank), `design-system/tokens` (raw colours, palette classes, raw sizes, fonts, radii), `design-system/generated` (drift), `design-system/registry` (imports resolved with the kernel's `Resolver`, as TypeScript resolves them), `design-system/required-states` (each required state has a passing test tagged `@state:<id>:<state>`, and its fixture from `src/screens/components.tsx` renders as its contract says in a fresh run of fwos's state harness; off, naming what's unproven, while a render proof is missing, and failing from the accept step on). Hook: raw-value feedback after each edit.

## Depends on

`kernel`, `state` (whether the change is at acceptance) Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

`fwos doctor` lists blank slots and the checks they turn off. Contrast findings print the ratio and the nearest passing shade. Scanner cases live in `tests/design-system.test.ts`, the mapping in `tests/adoption.test.ts`, and decisions, outcomes and the report in `tests/fidelity.test.ts`. `fwos design-system report --json` prints the outcomes and every undecided item.
