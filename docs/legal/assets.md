# Asset register

Every font, icon, image and video this repo bundles has a row here: its source and licence, our
right to redistribute it, and the attribution it needs. `pnpm repo-check` fails if a bundled asset
has no row.

The repo bundles no fonts or icon sets. The neutral starter uses system font stacks, the scaffold's
spinner is an inline SVG written for this project, and the Ember example names serif fonts by family
without shipping them.

## Bundled assets

| Path | Source and licence | Redistribution and attribution |
|---|---|---|
| `.github/assets/banner-light.svg` | Written for this project, system fonts only. MIT | Yes, our own work; no attribution needed |
| `.github/assets/banner-dark.svg` | Written for this project, system fonts only. MIT | Yes, our own work; no attribution needed |
| `.github/assets/badge-license.svg` | Static License badge written for this project, system fonts only. MIT | Yes, our own work; no attribution needed |
| `.github/assets/badge-node.svg` | Static Node badge written for this project, system fonts only. MIT | Yes, our own work; no attribution needed |
| `.github/assets/badge-claude.svg` | Static Claude Code badge written for this project, system fonts only. MIT | Yes, our own work; no attribution needed |
| `.github/assets/badge-codex.svg` | Static Codex CLI badge written for this project, system fonts only. MIT | Yes, our own work; no attribution needed |
| `.github/assets/demo.gif` | Actual bundled CLI recording using synthetic fixtures, captured with VHS and system Menlo. Reproduce with `scripts/capture-demo.sh`. MIT | Yes, our own output; no attribution needed |
| `.github/assets/tip-splitter.png` | Native Chromium capture of the unchanged first-party Tip Splitter sample running in an iframe, beside an original illustrated index of its checked-in workflow files. Captured for this README; system fonts, MIT | Yes, our own work; no attribution needed |
| `.github/assets/theme-adoption.svg` | Workflow diagram written for this project, system fonts only. MIT | Yes, our own work; no attribution needed |
| `examples/import-a-shadcn-theme/gallery/light-desktop.jpg` | A screenshot sheet of the import example's gallery run, written by `scripts/tests/gallery.test.ts`: fwos's starter components rendered in Chromium with system fonts. The components and the sheet are ours, MIT; the theme values are shadcn/ui's (MIT), credited below | Yes, our own work; no attribution needed |
| `examples/import-a-shadcn-theme/gallery/light-phone.jpg` | A screenshot sheet of the import example's gallery run, written by `scripts/tests/gallery.test.ts`: fwos's starter components rendered in Chromium with system fonts. The components and the sheet are ours, MIT; the theme values are shadcn/ui's (MIT), credited below | Yes, our own work; no attribution needed |
| `examples/import-a-shadcn-theme/gallery/dark-desktop.jpg` | A screenshot sheet of the import example's gallery run, written by `scripts/tests/gallery.test.ts`: fwos's starter components rendered in Chromium with system fonts. The components and the sheet are ours, MIT; the theme values are shadcn/ui's (MIT), credited below | Yes, our own work; no attribution needed |
| `examples/import-a-shadcn-theme/gallery/dark-phone.jpg` | A screenshot sheet of the import example's gallery run, written by `scripts/tests/gallery.test.ts`: fwos's starter components rendered in Chromium with system fonts. The components and the sheet are ours, MIT; the theme values are shadcn/ui's (MIT), credited below | Yes, our own work; no attribution needed |
| `examples/swap-in-a-design-system/gallery/light-desktop.jpg` | A screenshot sheet of the Ember example's gallery run, written by `scripts/tests/gallery.test.ts`: fwos's starter components rendered in Chromium with system fonts. The components and the sheet are ours, MIT | Yes, our own work; no attribution needed |
| `examples/swap-in-a-design-system/gallery/light-phone.jpg` | A screenshot sheet of the Ember example's gallery run, written by `scripts/tests/gallery.test.ts`: fwos's starter components rendered in Chromium with system fonts. The components and the sheet are ours, MIT | Yes, our own work; no attribution needed |
| `examples/swap-in-a-design-system/gallery/dark-desktop.jpg` | A screenshot sheet of the Ember example's gallery run, written by `scripts/tests/gallery.test.ts`: fwos's starter components rendered in Chromium with system fonts. The components and the sheet are ours, MIT | Yes, our own work; no attribution needed |
| `examples/swap-in-a-design-system/gallery/dark-phone.jpg` | A screenshot sheet of the Ember example's gallery run, written by `scripts/tests/gallery.test.ts`: fwos's starter components rendered in Chromium with system fonts. The components and the sheet are ours, MIT | Yes, our own work; no attribution needed |
| `plugin/kernel/tests/fixtures/pixel-0.png` | Synthetic 16 × 16 indexed PNG color fixture generated for this project. MIT | Yes, our own work; no attribution needed |
| `plugin/kernel/tests/fixtures/pixel-1.png` | Synthetic 16 × 16 indexed PNG color fixture generated for this project. MIT | Yes, our own work; no attribution needed |


## Derived material

Code and values taken from other projects. NOTICE carries the licence text where one is needed.

| What | Source and licence | Attribution |
|---|---|---|
| The theme values in `examples/import-a-shadcn-theme/globals.css`, in the gallery sample made from it (`examples/import-a-shadcn-theme/gallery/`), and in the shadcn intake test in `plugin/modules/design-system/tests/design-system.test.ts` | [shadcn/ui](https://github.com/shadcn-ui/ui), MIT | shadcn/ui's MIT notice, in NOTICE |
| The OKLab conversion in `plugin/modules/design-system/color.ts` | Björn Ottosson's [reference code](https://bottosson.github.io/posts/oklab/), public domain or MIT | Its MIT notice, in NOTICE |
| The neutral starter's hex values in `plugin/modules/design-system/starter/tokens/light.json` and `dark.json` | Most match Tailwind CSS's default palette (zinc, blue, green, red, yellow and orange, [MIT](https://github.com/tailwindlabs/tailwindcss)). The indigo brand shades match [Open Color](https://github.com/yeun/open-color)'s indigo, MIT | None needed: colour values are facts, not a copied work. Credited here |

When choosing assets for an app: SF Symbols and SF Pro are licensed for Apple platforms only, so a
web or Electron app needs another set. Lucide (ISC) and Geist (OFL) are common choices.
