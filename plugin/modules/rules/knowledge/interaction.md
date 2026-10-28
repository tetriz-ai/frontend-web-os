# Interaction

How the UI responds when people act on it. Rule ids are stable: lenses, checks and test names cite them.

## Saving

**R-interaction-1: Saves are pessimistic by default: show "Saving...", then "Saved".**
Wait for the server before showing success. Disable the trigger while the request is in flight, and keep the user's input if it fails so they can retry.
- Do: the button reads "Saving..." and is disabled, then a "Saved" status shows once the response is OK.
- Don't: close the form and say "Saved" before the request returns.

**R-interaction-2: Go optimistic only for cheap, reversible actions, and always roll back on failure.**
Fine for a star, a checkbox, a reorder. On failure, put the old value back and say so ("Couldn't star this. Try again."). Never optimistic for payments, deletes, sends, or anything another person sees at once.
- Don't: `setStarred(true); await api.star(id)` with no `catch` that restores the old value.

## Forms

**R-interaction-3: Validate on blur and on submit, not on every keystroke.**
Check a field when it loses focus, and check every field on submit. Once a field shows an error, re-check it as the user types so the error clears the moment it's fixed.
- Don't: show "Invalid email" after the first letter.

**R-interaction-4: On a failed submit, keep the input and focus the first field with an error.**
Never clear what the user typed. With several errors, show a short summary above the form too. Map server errors back to the fields they belong to.

## Destructive actions

**R-interaction-5: Confirm destructive actions, or offer undo.**
Undo suits frequent, recoverable actions (archive, remove from a list). A confirm dialog is for things that can't be reversed (delete forever, revoke access). The confirm button names the action ("Delete 3 files"), never "OK", and focus starts on Cancel.
- Don't: delete on one click with no confirm and no undo.

## URL state

**R-interaction-6: State that should survive a reload lives in the URL.**
Filters, sort, search text, the active tab, the page number and the selected item go in the path or query string, so reload, Back and a shared link all restore the view. Push for steps Back should undo; replace while typing in a search box. Hover, open menus and unsaved drafts stay out of the URL.
- Do: `/orders?status=late&sort=date&selected=ord_42`
- Don't: keep the active tab in `useState` only, so a reload jumps back to the first tab.

## Rows and links

**R-interaction-7: No clickable element nested inside a clickable row.**
Nested interactive elements are invalid HTML and confuse screen readers and click handling. Make the title a link whose `::after` covers the row, and lift secondary buttons above it with `relative z-10`.
- Don't: `<tr onClick={open}>` holding a `<button>` that calls `stopPropagation()`.

**R-interaction-8: If a row looks clickable, all of it is clickable.**
A hover background or pointer cursor on a row or card promises the whole surface. If only the title text responds, drop the row hover or stretch the link (R-interaction-7).

**R-interaction-9: External links look different from drill-in links.**
A link that leaves the app shows an external icon, says "opens in a new tab" to screen readers if it does, and sets `rel="noopener noreferrer"`. Links into the app have no icon and open in the same tab.
- Don't: open in-app pages in a new tab, or send people off-site with no sign.

## Menus

**R-interaction-10: Dropdowns and menus follow the standard keyboard map.**
- Enter, Space or ArrowDown on the trigger opens the menu and focuses the first item (ArrowUp: the last).
- ArrowUp and ArrowDown move between items; Home and End jump to the ends.
- Enter selects. Escape closes and returns focus to the trigger. Tab closes and moves on.
- Typing a letter jumps to the next item that starts with it (typeahead).
Use the registered menu or select component (R-components-1) rather than building this again.

## Suggestions

**R-interaction-11: Suggestions need a clear accept and a clear skip.**
A suggested value (a category, a reply, a filled field) looks different from user input until it's accepted. Give Accept and Skip equal weight, and remember a skip so the same suggestion doesn't come back on the next render.
- Don't: write a suggestion into the field so it saves as if the user typed it.
