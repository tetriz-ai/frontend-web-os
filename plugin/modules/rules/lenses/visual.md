---
name: visual
looks-for: Layout, spacing rhythm, hierarchy, density, alignment, dark mode parity and design drift in changed UI.
---

# Visual lens

Review the diff for how the screen looks and holds together next to its neighbours. You're read-only: report, don't edit. Rules live in ${CLAUDE_PLUGIN_ROOT}/modules/rules/knowledge/components.md, with layout parts of states.md and charts.md. Compare each changed screen with an existing screen of the same kind before judging it.

## What to look for

1. **Hierarchy.** More than one primary button in a view (R-components-3). No clear page title. Type roles picked by size rather than meaning (`text-heading` used for body copy). Too many type roles in one card.
2. **Spacing rhythm.** Arbitrary values (`p-[13px]`, `gap-[18px]`). Related items spaced as far apart as unrelated ones. A new screen whose padding or section gaps differ from its siblings.
3. **Alignment.** Content that doesn't share a left (start) edge. Numbers not right-aligned or missing `tabular-nums` (R-components-7). Icons off the text's centre line (R-components-13).
4. **Density.** Rows or cards much denser or looser than nearby views. Text lines wider than about 75 characters.
5. **Layout under stress.** Breaks at 320px, 768px or wide screens (R-a11y-14). Long text that pushes the layout (R-states-13). A button that changes width while loading (R-components-4). A skeleton that doesn't match the loaded layout (R-states-3).
6. **Dark mode parity.** `dark:` overrides with one-off values instead of slot classes. Shadows, borders or illustrations that vanish or glare in dark mode. Surface layers that stand apart in one theme but merge in the other.
7. **Copies of existing components (R-components-1).** New markup that rebuilds a registered component by hand.
8. **Design drift.** Classify each drift as one of:
   - **missing token**: the design needs a value the token set lacks (a fourth surface level, a new status kind). Fix: add the token, not a one-off.
   - **one-off**: a token already covers it but the code doesn't use it (`rounded-[10px]` beside `rounded-md`). Fix: use the token.
   - **conceptual gap**: the design system has no pattern for this at all, and the diff invents one. Fix: flag it for a design decision; don't block the code on taste.

## How to report

One finding per issue, most severe first:

```
<file>:<line> [blocker|should-fix|nit] <rule id, or drift: missing-token|one-off|conceptual-gap>
User sees: <what looks wrong, in one sentence>
Fix: <the smallest change that fixes it>
```

- **blocker**: content is hidden, overlaps, or can't be read (a layout that breaks at 320px, text invisible in dark mode).
- **should-fix**: the screen works but looks off next to its neighbours (two primaries, broken rhythm, a one-off value).
- **nit**: a pixel-level mismatch most people won't notice.

If the diff is clean for this lens, say so in one line.

## Not this lens

- Contrast ratios and focus rings: the accessibility lens. Report a dark-mode element that disappears here.
- Whether states exist and behave: the states lens. Words: the copy lens.
- Anything `fwos check` already fails on: every rule in ${CLAUDE_PLUGIN_ROOT}/modules/rules/pack/, and the raw colours, palette classes, sizes, fonts and radii the `design-system/tokens` check catches.

## Planted-defect example

```tsx
<button className="bg-brand text-on-brand rounded-md px-4 py-2 text-label" disabled={saving}>
  {saving ? <Spinner className="size-4" /> : 'Save changes'}
</button>
```

Expected finding: `ProfileForm.tsx:2 [should-fix] R-components-4`. User sees: the button shrinks to the width of the spinner, the Cancel button beside it jumps left, and a second click can land on Cancel. Fix: keep the label in place with `invisible` while saving and lay the spinner over it, or give the button a min width.

Lint can't catch this: only slot classes are used, so every class passes. The defect is in the geometry.
