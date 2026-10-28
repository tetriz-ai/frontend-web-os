# Adoption fidelity: the mapping report, the gallery and the decisions

An adopted design system (a shadcn theme imported with `--from-shadcn`, an adopted app's own theme,
or your own DTCG tokens such as Ember) is reviewed in three parts. `fwos design-system report`
writes `docs/app/reports/design-system.md` and prints the outcomes, which never stand in for each
other:

| Outcome | Says | Doesn't say |
|---|---|---|
| Token validity | `design-system/schema` and `design-system/contrast`: well formed, text readable | that the tokens match the source |
| Generated CSS | `design-system/generated`: the CSS variables and Tailwind theme match the tokens | anything about the source |
| Adoption coverage | how many slots, source entries and components came across as they were | how they render |
| Fidelity | the gallery's rendered comparison, every difference decided, and a person's approval | that anything else is correct |
| Preview | `/fwos-screens` shows the app on fake data | anything about the source |

## The mapping

Every slot has a row: the source file and key it reads (a theme variable, or a token path in your
files), its value in each mode in the source and in the design system, and a status:

- **preserved**: the source's value, where it means the same.
- **approximated**: the source's value where it only roughly fits (`text.secondary` from
  `--muted-foreground`), or your component replaced by another.
- **defaulted**: fwos's value where the source has none: the neutral starter's, a slot's fallback,
  or blank. A component is defaulted when it is fwos's starter component, not yours.
- **unsupported**: in the source, and nothing took it: a theme variable no slot reads, a token no
  slot reaches, or your component marked removed or left out of `components.json`.
- **changed**: the design system no longer holds the source's value, such as a contrast fix made
  after the import.

The component rows come from each component's own source, read without running it: its exports,
variant axes (`cva` variants or props typed with a string union), the states it can render
(props such as `loading` and `disabled`, and state classes such as `aria-invalid:`) and what a person
can do with it (press, type, open, check, hover, focus).

## The gallery

`fwos design-system gallery` writes a dev-only route at `/fwos-screens/fwos-gallery` into the app,
and a Playwright runner beside it, and prints the command that runs it. It needs `@playwright/test`
and Chromium in the app. Each component renders every variant and state twice:

- **original**: the source's own values. Your components read your theme's variables, and fwos's
  components read each slot as the source gives it.
- **adopted**: the design system fwos holds. Your components' variables read the slot that took
  them, so a variable no slot took has no value here.

The run compares computed styles at rest, hovered, focused and open, and what each interaction does,
in each mode at 390 and 1280 pixels wide. It writes `.fwos/local/results/fidelity.json` and a
screenshot sheet per mode and width in `.fwos/local/gallery/`. A difference names the variables
whose adopted value alone accounts for it, and the report names the rows behind them. Run the
gallery and the comparison again after any change: an older run is reported as out of date.

## Decisions and the approval

Every row and component that isn't preserved, and every rendered difference no row accounts for
(`render:<component>`), needs a decision a person makes, with a reason:

```sh
fwos design-system decide <item> --as replace|omit|intentional --reason "<why>" --by "<name>"
```

- **intentional**, for a token row or a rendered difference: the difference is accepted, such as an
  approved contrast correction.
- **replace**, for a component fwos's starter replaces or one of yours another replaces.
- **omit**, for a component of yours that isn't carried over.

A status in place of the item (`defaulted`) takes every undecided item of it that the decision fits.
Ask the user for each decision and its reason, and never decide for them. A decision covers what it
saw: once that row or difference changes, it needs deciding again.

`fwos approve fidelity --by "<name>"` is refused until a current comparison ran, nothing is
undecided and the report is current. Any later change to the design system or the report makes it
stale. Approving the design system (`fwos approve design-system`) accepts the tokens as they are,
and prints the outcomes so an undecided difference stays in view.

## What to show the user

The outcomes, the counts (faithful cells, intentional differences, unresolved ones), each
difference with the row behind it, the components that fwos's starter replaces, the source entries
nothing consumed, and the screenshot sheets. Say plainly what is not preserved: a PASS from the
schema and contrast checks is not a match with the source.
