# Copy and locale

The words on screen, and how dates, numbers and languages are handled. If the project has a `voice.md`, it wins on tone. These rules still apply. Rule ids are stable: lenses, checks and test names cite them.

## Copy

**R-copy-1: Error messages say what happened, why, and what to do next.**
Write from the user's side in plain words. Don't blame the user. Leave error codes out of the main text (put them in a details line if support needs them).
- Do: "We couldn't save your changes. The connection dropped. Check your network and try again."
- Don't: "Error 500: Internal Server Error", or "Oops! Something went wrong."

**R-copy-2: Notes only qualify numbers.**
A small note next to a figure tells you how to read it ("Excludes refunds", "Updated hourly", "Month to date"). Instructions, warnings and news go in the main copy, not in a note.

**R-copy-3: Spell out labels. No unexplained abbreviations.**
Write "Average order value", not "AOV". Short forms are fine only if everyone knows them ("Jan", "km") or the full term is one hover or one glance away. Never show raw enum values or API field names (`PENDING_REVIEW`, `created_at`).

**R-copy-4: Buttons say what they do.**
Use a verb and, where it helps, a noun: "Save draft", "Delete 3 files", "Send invite". Not "OK", "Submit" or "Yes".

**R-copy-5: One term for one thing.**
Use the term the brief uses, everywhere: nav, headings, buttons, errors, empty states. If it's a "project" in the nav, it's not a "workspace" in the dialog.

**R-copy-6: Sentence case for UI text.**
Capitalise the first word and proper nouns only ("Export to file", not "Export To File"), unless `voice.md` says otherwise. No full stop on labels and buttons. Full stops on sentences.

**R-copy-7: Confirm dialogs ask about the specific thing and say what happens.**
The title names the action and the object ("Delete 'Q3 report'?"). The body says the result in one line ("This can't be undone. 4 people lose access."). The buttons repeat the verb ("Delete report" and "Cancel").

## Locale

**R-locale-1: Dates and numbers go through one shared formatter.**
`formatDate`, `formatNumber`, `formatCurrency` and friends live in `shared/lib/format` and read the locale slot (`locale.default`, `locale.date-style`). Components never call `toLocaleString` or build an `Intl` formatter themselves. Currency and units come from the data, never assumed.
- Do: `formatDate(order.createdAt)`
- Don't: `order.createdAt.toLocaleDateString('en-US')`

**R-locale-2: Relative times for recent events, absolute dates beyond a week.**
"Just now", "5 min ago" and "Yesterday" up to 7 days old. Older than that, show the date ("12 Mar 2026"). Wrap it in `<time dateTime>` and show the full timestamp on hover. Both forms come from the shared formatter.

**R-locale-3: Never hard-code user-facing strings when more than one language is planned.**
Every string goes through the message catalogue by key, including `aria-label`, alt text, page titles and error messages. Use the library's plural and placeholder rules. Never build a sentence by joining fragments.
- Do: `t('orders.count', { count })`
- Don't: `` `${count} order${count === 1 ? '' : 's'}` ``

**R-locale-4: Use start and end, not left and right, when right-to-left is planned.**
Use logical classes: `ms-2`, `me-2`, `ps-4`, `pe-4`, `text-start`, `start-0`, `border-e`, `rounded-s-md`. Icons that point a direction (back arrows, chevrons) flip with `rtl:-scale-x-100`.
- Do: `className="ps-4 text-start"`
- Don't: `className="pl-4 text-left"`

**R-locale-5: Leave room for longer text.**
Translations often run 30% or more longer than English. Don't fix the width of buttons, tabs or labels to fit the English text. Let them grow or wrap, and test with a long pseudo-locale.

**R-locale-6: Store times in UTC, show them in the user's time zone.**
Convert at display time in the shared formatter. When the zone matters (deadlines, scheduled sends, people in other places), show it ("9:00 AM GMT+1"). Date-only values (a birthday, a due date) stay as plain dates, with no time zone shift.
