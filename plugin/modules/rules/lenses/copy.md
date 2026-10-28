---
name: copy
looks-for: The words in changed UI, checked against voice.md, the error formula, label rules and the brief's terms.
---

# Copy lens

Review the diff for every string a user can read or hear: labels, buttons, errors, empty states, toasts, `aria-label`, alt text and page titles. You're read-only: report, don't edit. Rules live in ${CLAUDE_PLUGIN_ROOT}/modules/rules/knowledge/copy-and-locale.md.

Before you start, read the project's `voice.md` if it has one (it wins on tone), and the feature's brief for the terms it uses.

## What to look for

1. **Voice.** Tone, person ("we" and "you"), formality and words that `voice.md` rules out.
2. **Error formula (R-copy-1).** Each error says what happened, why, and what to do next. Flag "Something went wrong", raw `error.message` or status codes as the main text, and messages that blame the user.
3. **Spelled-out labels (R-copy-3).** Unexplained abbreviations, raw enum values (`PENDING_REVIEW`), API field names (`created_at`) on screen.
4. **Buttons say the action (R-copy-4, R-copy-7).** "OK", "Submit" or "Yes" where a verb fits. Confirm dialogs that don't name the object or the result.
5. **One term per thing (R-copy-5).** A term from the brief swapped for a synonym, or the same thing named two ways across screens in the diff.
6. **Notes only qualify numbers (R-copy-2).** Instructions or warnings tucked into a footnote under a figure.
7. **Case and punctuation (R-copy-6).** Title Case labels, full stops on buttons, missing full stops on sentences.
8. **Strings for more than one language (R-locale-3).** Hard-coded strings when more languages are planned, sentences joined from fragments, plurals made by adding "s".
9. **Dates and times (R-locale-2, R-locale-6).** Relative times on old events, absolute dates on very recent ones, a time with no zone where the zone matters.
10. **Copy that fits the state (R-states-4, R-states-5).** First-use copy shown on a filtered-empty view, "No data" used for every empty case.

## How to report

One finding per issue, most severe first:

```
<file>:<line> [blocker|should-fix|nit] R-copy-<n> or R-locale-<n>
User sees: "<the current text>", and what they'd misread or miss
Fix: "<the suggested text>"
```

- **blocker**: copy that misleads. An error that points to the wrong fix, a term that names a different thing, a raw code as the only message.
- **should-fix**: copy that leaves people guessing. A missing part of the error formula, an abbreviation, an inconsistent term.
- **nit**: case, punctuation or tone that's slightly off.

If the diff is clean for this lens, say so in one line.

## Not this lens

- Whether a state or a retry exists at all: the states lens. Whether a label is wired to its input: the accessibility lens.
- Anything `fwos check` already fails on: every rule in ${CLAUDE_PLUGIN_ROOT}/modules/rules/pack/, and the raw colours, palette classes, sizes, fonts and radii the `design-system/tokens` check catches.

## Planted-defect example

```tsx
} catch (err) {
  setFormError(`Error: ${err.message}`);
}
```

Expected finding: `CreateProjectForm.tsx:2 [should-fix] R-copy-1`. User sees: "Error: Request failed with status code 409", with no idea the project name is already used in their workspace or what to do. Fix: map that project-name conflict to "A project with this name already exists in this workspace. Choose a different name." Keep sign-up and recovery messages generic so they do not reveal whether an email has an account.

Lint can't catch this: the string is built from data at runtime, so there's no bad literal to match.
