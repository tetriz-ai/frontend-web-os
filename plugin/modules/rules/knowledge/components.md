# Components

How to pick, build and style components. Rule ids are stable: lenses, checks and test names cite them.

**R-components-1: Reuse a registered component before making a new one.**
Look in `shared/ui` and the component registry first. If something close exists, add a prop or variant. Make a new component only when nothing fits, and register it. Two components that do the same job always drift apart.
- Don't: build a fresh modal in a feature folder when `shared/ui/Dialog` exists.

**R-components-2: Style only with design-token slot classes.**
Colour, radius and type come from the slot classes the theme generates: `bg-surface`, `bg-surface-elevated`, `text-fg`, `text-fg-muted`, `border-border`, `bg-brand`, `text-on-brand`, `text-critical`, `rounded-md`, `text-body`, `text-label`. Spacing uses the spacing scale (`p-4`, `gap-2`). No hex, rgb, palette colours (`bg-blue-600`) or arbitrary sizes (`text-[13px]`, `rounded-[6px]`). If a value you need has no token, raise it as a missing token. Don't hard-code it.
- Do: `className="bg-surface text-fg rounded-md text-body"`
- Don't: `className="bg-white text-gray-900 rounded-[6px] text-[13px]"`

**R-components-3: One primary button per view.**
The primary (`bg-brand`) button marks the main next step. Everything else is secondary or ghost. A dialog counts as its own view with its own single primary.
- Don't: "Save", "Publish" and "Export" all filled with the brand colour in one toolbar.

**R-components-4: A loading button keeps its width.**
Keep the label in the layout and hide it with `invisible`, then place the spinner on top, or set a min width. Disable it and keep the accessible name ("Saving...").
- Do: `<span className={saving ? 'invisible' : undefined}>Save changes</span>` with an absolutely placed spinner.
- Don't: swap "Save changes" for a 16px spinner so the button shrinks and the row jumps.

**R-components-5: Tooltips only for icon buttons and truncated text.**
Show them after a short delay (300 to 500 ms) on hover, at once on keyboard focus, and hide them on Escape. Keep them to a few words. Never put required information in a tooltip: touch users can't hover.
- Don't: hide a field's format ("Use DD/MM/YYYY") in a tooltip on a help icon. Put it under the field.

**R-components-6: Truncated text has a way to see the full value.**
Truncate with an ellipsis (`truncate` or `line-clamp-2`) and give the full text in a tooltip or an expand control. Never truncate a number, an amount or an id in a way that changes what it says.

**R-components-7: Columns of numbers use tabular figures and align right.**
Add `tabular-nums` so digits line up and values don't jitter when they update. Right-align numbers and their headers, and keep the same decimal places down a column.
- Don't: left-aligned amounts in proportional digits, so 1,111 looks narrower than 8,888.

**R-components-8: Side panel for a quick look or a short edit. Page for a deep task.**
A panel suits viewing or editing one item while the list stays in view: details, a preview, a short form. Use a page when the task has several steps, needs its own shareable URL, or would scroll more than about two screens. Either way, the selected item is in the URL (R-interaction-6), Escape closes a panel, and focus goes back to the row that opened it.
- Don't: a multi-step wizard inside a 400px side panel.

**R-components-9: A disabled control says why.**
Show the reason next to it, or in a tooltip on an `aria-disabled` button (a native `disabled` button can't take focus or hover, so its tooltip never shows). If the user can never use it, hide it instead.

**R-components-10: Every interactive component covers every state it can be in.**
Default, hover, focus-visible, active and disabled always; loading if it acts async; selected if it can be selected. Use the state slot classes (`bg-hover`, `bg-selected`, the focus colour) so states match across components.

**R-components-11: Status badges use the status pairs.**
A status shows as the matching background and text pair (`bg-critical-bg text-critical`, `bg-success-bg text-success`) plus a word (R-a11y-1). Use the five status kinds as they're meant: critical, warning, caution, info, success. Don't invent a sixth with a one-off colour.

**R-components-12: Form fields use the registered field component.**
It already wires the label, help text, error text and required marker together (R-a11y-10). A bare `<input>` in a feature form skips all of that.
- Do: `<TextField label="Email" error={errors.email} />`

**R-components-13: Icons come from one set, sized to the text beside them.**
One icon library across the app. An icon next to `text-body` uses the matching size and sits on the text's centre line. Decorative icons are `aria-hidden="true"`.

**R-components-14: Tables keep their controls in fixed places.**
The header row stays visible when the table scrolls. Sortable headers show the sort direction and set `aria-sort`. Row actions sit in the last column, in the same order on every row.
