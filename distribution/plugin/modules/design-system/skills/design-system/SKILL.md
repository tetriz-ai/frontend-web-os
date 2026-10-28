---
name: design-system
description: 'Step 4 of Frontend Web OS. Takes the user''s own design system (a shadcn or tweakcn theme, DTCG tokens, CSS variables, or nothing for the neutral starter), normalises it into DTCG under design-system/, fills or flags every slot, checks contrast, and generates the CSS and Tailwind outputs. Loaded by /fwos:start when the step is design-system.'
user-invocable: false
---

# Step 4: Design system

Goal: the user plugs in their own design system, and everything else adapts.

Read ${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/house-rules.md and
${CLAUDE_PLUGIN_ROOT}/modules/design-system/knowledge/slots.md (the contract).
`fwos` means `node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

## 1. What do they have?

Ask (with the brief's T8 answer as the suggestion):

| They have | Do |
|---|---|
| A shadcn or tweakcn theme (`globals.css`) | `fwos design-system init --from-shadcn <path> --name "<name>"`. The fastest path. |
| DTCG tokens, a Tokens Studio file, or a Figma variables export | `fwos design-system init --name "<name>"`, then replace `design-system/tokens/*.json` with theirs (converted to DTCG if needed) and map any differently named tokens in `design-system.json` `slots`. |
| A Tailwind config or plain CSS variables | Start from the starter as above, then copy their values into the token files, slot by slot. |
| Nothing | `fwos design-system init`: the neutral starter, light and dark, passing contrast, tagged `[ASSUMED]`. |

`design-system/` is the user's from now on: fwos never overwrites it.

## 2. Check it

Run `fwos check design-system`. Then:

- **design-system/schema FAIL**: a required slot is blank, an alias is broken, or a file is
  malformed. Fill what's given, and show the user the gaps in one list.
- **design-system/contrast FAIL**: show each failing pair with its ratio and the suggested nearest
  passing shade. The user decides; never change a brand colour silently.
- **OFF checks**: say which blank slots turned which checks off ("chart palette blank: chart colour
  check off").
- No dark mode given: propose dark values for approval, tagged `[ASSUMED]`.
- Read the `[ASSUMED]` list in design-system.json back to the user; remove items they confirm.
- With a design system they brought (a theme or their own tokens), run `fwos design-system report`
  and read ${CLAUDE_PLUGIN_ROOT}/modules/design-system/knowledge/fidelity.md. Show the outcomes, the
  counts, each row that isn't preserved and each source entry nothing consumed. Say plainly that a
  PASS means valid and readable, not a match with their old design: the gallery compares the two
  once the app is scaffolded.

## 3. Components and identity

- The registry is `design-system/components.json`: the starter set (button, text-field, card,
  badge, alert, skeleton, spinner, empty-state, state-handler), each with the states it must render.
  If the user has their own component library, record its components there with their states.
- With a design system they brought, each of fwos's starter components stands in for one of theirs:
  ask whether that is what they want, and record it (`fwos design-system decide <id> --as replace`,
  with their reason). A component of theirs marked superseded or removed needs a decision too.
- Icons and fonts must be licensed for every chosen platform (SF Symbols and SF Pro are Apple-only;
  Lucide is ISC). Note the choice in decisions.md.
- App identity (C18) may stay blank for now; it blocks release, not the build.

## 4. Generate

`fwos tokens build` writes `packages/tokens/generated/tokens.css` and `theme.css`. They're
generated: never edit them; change tokens and rebuild.

## Approval

Show: the name, modes, blank slots and the checks they turn off, the `[ASSUMED]` list, and with a
design system they brought, the outcomes `fwos design-system report` prints. The approval accepts
the design system as it is: it doesn't say the result matches their old one, and
`fwos approve design-system` prints the outcomes beside it. The fidelity approval comes later, at
the screens step, once the gallery has run.
"Approve the design system?" Yes: `fwos approve design-system --by "<name>"`, then
`fwos step screens`. To skip, still write and build the starter first (`fwos design-system init`,
`fwos tokens build`), then `fwos skip design-system --reason "<why>" --by "<name>"`: the app
needs tokens either way.
