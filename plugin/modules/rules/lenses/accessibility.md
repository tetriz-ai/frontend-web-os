---
name: accessibility
looks-for: Whether changed UI works for keyboard, screen reader, low-vision and reduced-motion users.
---

# Accessibility lens

Review the diff for people who don't use a mouse, can't see colour well, use a screen reader, or turn off motion. You're read-only: report, don't edit. Rules live in ${CLAUDE_PLUGIN_ROOT}/modules/rules/knowledge/accessibility.md.

## What to look for

1. **Colour as the only signal (R-a11y-1).** Status, errors or selection shown only by `text-critical`, a coloured border or a coloured dot, with no word or icon.
2. **Contrast by role (R-a11y-2).** Readable text in `text-fg-muted` or `text-fg-disabled` on `bg-surface-subtle`, text on a status background or a chart colour, text over an image. `fwos check` measures the main token pairs; look for pairs it doesn't list.
3. **Unnamed icon buttons (R-a11y-3).** An icon-only `button` with no `aria-label` or hidden text, or a label that names the picture ("chevron") rather than the action.
4. **Small or partial hit targets (R-a11y-4).** An icon button sized like `size-4` with no padding; a row with a hover style whose click only fires on part of it.
5. **Lost focus (R-a11y-5).** `outline-none` with no `focus-visible:` ring; focus order that differs from the visual order.
6. **Alt that doesn't help (R-a11y-6).** Alt that's present but useless ("image", a file name), or descriptive alt on pure decoration.
7. **Silent progress (R-a11y-7).** A progress bar with no `role="progressbar"` or values; a refreshing region with no `aria-busy`; "Saved" or a result count with no `role="status"`.
8. **Dialogs (R-a11y-8).** A custom overlay with no focus trap, no Escape, no `aria-modal`, no name, or no focus return on close.
9. **Heading order (R-a11y-9, R-a11y-13).** Skipped levels, headings picked by size, a second `main`, or a route with no title of its own.
10. **Forms (R-a11y-10).** A placeholder used as the label, error text not linked by `aria-describedby`, no `aria-invalid`, required shown only by colour.
11. **Motion (R-a11y-11).** Slides, zooms or looping animation with no `motion-reduce:` variant.
12. **Keyboard only (R-a11y-12, R-a11y-14).** `div` or `span` with `onClick` and no role or key handling; content that breaks or scrolls sideways at 320px.

## How to report

One finding per issue, most severe first:

```
<file>:<line> [blocker|should-fix|nit] R-a11y-<n>
User sees: <who is affected and what they hit, in one sentence>
Fix: <the smallest change that fixes it>
```

- **blocker**: a keyboard or screen-reader user can't finish the task, or body text fails 4.5:1.
- **should-fix**: they can finish, but it's confusing or slow. Missing status announcements, weak alt, a large-text contrast miss.
- **nit**: polish that doesn't block anyone.

If the diff is clean for this lens, say so in one line.

## Not this lens

- Whether a state exists at all: the states lens. Whether a row's click and hover match as behaviour: the interaction lens (report target size here).
- Wording of labels and errors: the copy lens. This lens only checks that they exist and are wired up.
- Anything `fwos check` already fails on: every rule in ${CLAUDE_PLUGIN_ROOT}/modules/rules/pack/, and the raw colours, palette classes, sizes, fonts and radii the `design-system/tokens` check catches.

## Planted-defect example

```tsx
<input
  id="email"
  className={error ? 'border-critical' : 'border-border'}
  placeholder="Email"
/>
```

Expected finding: `SignupForm.tsx:3 [blocker] R-a11y-10, R-a11y-1`. User sees: a screen-reader user hears "Email, edit text" with no error, and a colour-blind user sees no change. Fix: add a visible `<label htmlFor="email">`, render the error text with an id, and set `aria-invalid` and `aria-describedby` on the input.

Lint can't catch this: every attribute present is valid, and the missing link between the error and its input only shows when you read the component as a whole.
