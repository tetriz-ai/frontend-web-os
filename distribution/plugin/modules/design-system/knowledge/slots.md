# The design-system contract (slots)

fwos ships the contract; the values are yours. Each slot maps to a token in your DTCG files (by
default the path shown; `design-system.json` `slots` can point it elsewhere, so your token names can
differ). Components use only the generated slot classes, so swapping design systems needs no code
change.

Level: **required** (needed to start), **default** (has a fallback), **optional** (blank turns its
check off, and doctor says so).

| Contract | Slots | Default token path | Level | Tailwind class |
|---|---|---|---|---|
| C2 light and dark | every colour slot, per mode file | `tokens.modes` in design-system.json | required | `[data-theme]`, `prefers-color-scheme` |
| C3 surfaces | surface.base, surface.elevated, surface.subtle, surface.interactive | color.surface.* | required | bg-surface, bg-surface-elevated, bg-surface-subtle, bg-surface-interactive |
| C4 text | text.primary, text.secondary, text.muted, text.disabled, text.inverted | color.text.* | required | text-fg, text-fg-secondary, text-fg-muted, text-fg-disabled, text-fg-inverted |
| C5 borders | border.faint, border.default | color.border.* | required | border-border-faint, border-border |
| C6 brand | brand.primary, brand.primary-foreground, brand.accent, brand.accent-foreground | color.brand.* | required | bg-brand, text-on-brand, bg-accent, text-on-accent |
| C6 brand | brand.primary-hover | color.brand.primary-hover | default (brand.primary) | bg-brand-hover |
| C7 states | state.hover, state.selected, state.disabled, state.overlay, state.focus | color.state.* | default | bg-hover, bg-selected, bg-disabled, bg-overlay, outline-focus |
| C8 status pairs | status.critical.bg/.text, status.warning.*, status.caution.*, status.info.*, status.success.* | color.status.* | required | bg-critical-bg + text-critical, and the same per status |
| C9 chart palette | chart.1, chart.2, chart.3, chart.4, chart.other | color.chart.* | optional (chart check) | bg-chart-1 ... |
| C10 radius | radius.sm, radius.md, radius.lg (rounder means more clickable; nested items step down) | radius.* | required | rounded-sm, rounded-md, rounded-lg |
| C10 radius | radius.full | radius.full | default (9999px) | rounded-full |
| C11 fonts | font.sans, font.mono | font.* | required | font-sans, font-mono |
| C11 type roles | type.display, type.title, type.heading, type.subheading, type.body, type.body-strong, type.label, type.caption, type.overline, type.code, type.metric | type.* | default (a built-in scale) | text-display, text-title ... text-metric |
| C12 motion | motion.fast, motion.normal, motion.slow, motion.easing | motion.* | default | ease-standard |
| C13 minimum sizes | size.hit-target, size.text-min | size.* | default (24px, 12px) | |
| C14 voice | `voice.md` (banned phrases, the error formula) | | optional (copy lens) | |
| C15 locale | locale.default, locale.date-style | locale.* | default (en, medium) | |
| C16 components | `components.json` (id, status, superseded-by, required states) | | default (the starter set) | |
| C18 app identity | name, app ID, icons, favicon, social image | | optional (blocks release while blank) | |

## Files

- `design-system/design-system.json`: schema version, token files per mode, slot mapping, `[ASSUMED]` list.
- `design-system/tokens/*.json`: DTCG 2025.10 values (`$value`, `$type`, aliases like `{color.brand.primary}`).
  Older string forms (`"#fff"`, `"4px"`) are accepted too.
- `design-system/components.json`: the registry.
- `design-system/rules.yaml`: rule-pack overrides and your own rules.
- `design-system/voice.md`: optional.

Generated (don't edit; `fwos tokens build` rebuilds them and `fwos check` catches drift):
`packages/tokens/generated/tokens.css` (one `--ds-*` variable per slot, per mode) and
`packages/tokens/generated/theme.css` (a Tailwind v4 theme with the default palette cleared, so only
slot classes exist).
