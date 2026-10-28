# Accessibility

The target is WCAG 2.2 AA. Rule ids are stable: lenses, checks and test names cite them.

**R-a11y-1: Colour is never the only signal.**
Pair colour with text, an icon or a pattern. Status badges have a word, error fields have a message, chart series have labels. Check the screen in greyscale.
- Do: a red badge that reads "Failed" next to an alert icon.
- Don't: a red or green dot with no text.

**R-a11y-2: Meet the contrast ratio for each text role.**
Body and small text: at least 4.5:1 against its background. Large text (24px, or 18.7px bold) and UI parts (input borders, focus rings, icons that carry meaning): at least 3:1. Check muted text on every surface it sits on, in light and dark mode.
- Don't: use `text-fg-disabled` for text people need to read.

**R-a11y-3: Every icon-only button has an accessible name.**
Use `aria-label` or visually hidden text that names the action, not the picture. Mark the icon `aria-hidden="true"`.
- Do: `<button aria-label="Delete invoice"><TrashIcon aria-hidden="true" /></button>`
- Don't: `<button><TrashIcon /></button>`, or `aria-label="trash icon"`.

**R-a11y-4: Hit targets are at least 24x24 CSS px, and a clickable row responds everywhere.**
Pad small icons up to the `size.hit-target` slot. If a row or card has a hover style, the whole surface takes the click, not just the title text (R-interaction-8).

**R-a11y-5: Focus is always visible and follows the visual order.**
Every focusable element shows a ring on keyboard focus (`focus-visible:` with the focus colour, at least 2px, 3:1 against what's behind it). Never `outline-none` without a replacement. Fix the order in the DOM, not with `tabIndex`.

**R-a11y-6: Images have useful alt text. Decorative images have empty alt.**
Alt says what the image tells you in context ("Sign-ups doubled in May"), not "image of chart" or a file name. Decoration, and icons next to a text label, use `alt=""` or `aria-hidden="true"`.

**R-a11y-7: Progress and loading are exposed to assistive tech.**
A progress bar with a known amount uses `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and a label. A region that's loading or refreshing sets `aria-busy="true"`. Results that matter ("Saved", "12 results") go to a polite `role="status"` region.

**R-a11y-8: Dialogs trap focus and give it back.**
On open, focus moves into the dialog (the first field, or Cancel for a destructive confirm). Tab stays inside, Escape closes, and on close focus returns to the element that opened it. The dialog has `role="dialog"`, `aria-modal="true"` and `aria-labelledby` pointing at its heading.
- Do: use the registered Dialog component or native `<dialog>` with `showModal()`.

**R-a11y-9: Headings go in order.**
One `h1` per page, then `h2`, `h3` without skipping a level. Pick the level by structure and the look by type slot (`text-heading`), so a small heading can still be an `h2`.
- Don't: use `<h4>` because it's the right size.

**R-a11y-10: Every input has a label, and errors are tied to their input.**
Use a visible `<label htmlFor>`. A placeholder isn't a label. Link help and error text with `aria-describedby`, set `aria-invalid="true"` on a field in error, and say "required" in text, not only with a red asterisk.
- Do: `<input id="email" aria-invalid="true" aria-describedby="email-error" />` and `<p id="email-error">Enter an email like name@example.com.</p>`

**R-a11y-11: Respect prefers-reduced-motion: keep the fade, drop the movement.**
Under reduced motion, remove slides, zooms, parallax and looping animation. A short opacity fade can stay. Nothing should need motion to be understood.
- Do: `motion-safe:animate-slide-in motion-reduce:animate-fade-in`

**R-a11y-12: Everything works with a keyboard alone.**
Every action you can do with a mouse you can do with Tab, Enter, Space, arrows and Escape. Use native `button`, `a` and `input` before adding handlers to a `div`.
- Don't: `<div onClick={save}>Save</div>`

**R-a11y-13: Every page has a unique title and landmarks.**
Each route sets its own `<title>` ("Orders - App name"). Use `header`, `nav`, `main` and `footer`, with one `main` per page and a skip link to it as the first focusable element.

**R-a11y-14: The page works at 200% zoom and 320px wide.**
Content reflows into one column with no horizontal scrolling (data tables and charts may scroll inside their own frame). Nothing gets cut off or overlaps, and text sizes use `rem` through the type slots so browser text size settings apply.
