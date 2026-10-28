# Writing acceptance criteria

An AC is checkable without interpretation: two people reading it agree whether the app passes.

## Format

```
### AC-<feature>-<n>: <what the user can do, in their words>
- Journey: J<n>
- Given <a starting state>, when <the user does one thing>, then <what they see>.
- Proven against: mock | local | real
- Release: first | later
- Manual: <why a person must check it>   (only when it truly can't be automated)
```

IDs are stable across branches: number per feature, never reuse a number, never renumber.

## Good and bad

| Bad (interpretation needed) | Good (checkable) |
|---|---|
| The list feels fast | The first screen shows within 1 second on the reference machine (median of 5 runs) |
| Errors are handled | When saving fails, the item stays in the form, an alert says why, and "Try again" retries the save |
| Works offline | After one visit, with the network off, the list shows the saved items and an offline banner |
| Easy to use | A first-time user saves a link from the empty state without help, using only the keyboard |

## Every state gets an AC

Each state in ia.json for a first-release page needs at least one AC that covers it (zero state,
filtered-empty, error with retry, offline, no permission). The spec review checks this.

## "Proven against"

Say where the data comes from when the passing test runs: `mock` (the generated mock fetch),
`local` (data saved on the device) or `real` (a real backend). An app with no data layer, where
nothing is fetched or saved, uses `local`. A mock never counts as proof of the real thing; the
acceptance report shows which it was.

It names the data, never the test level. Whether a test runs as a unit, a component or end to end
is the test plan's call, made from the behaviour the AC describes. So the spec doesn't define these
words any other way: a spec that says `local` means "in a real browser" contradicts its own test
plan.

## Manual checks

Only for what can't be automated, with the reason (a VoiceOver walkthrough, a print layout). A
manual AC needs a named sign-off (`fwos signoff AC-x-n --by "<name>"`) before acceptance.
