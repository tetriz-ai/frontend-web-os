# Registry checks

How the researcher confirms a library is real, current and allowed before suggesting it, by asking the npm registry live.

## Why

- A package name from memory can be made up, or one letter off a real one.
- Attackers publish packages under names people (and AI tools) are likely to type by mistake.
- Memory goes stale: a package may be deprecated, renamed or abandoned since it was last seen.
- So every candidate is checked live, on the day it is suggested. No check, no pick.

## Step 1: fetch the package document

- Use WebFetch on `https://registry.npmjs.org/<name>`; no shell or local tools are needed.
- Scoped names: keep the `@` and encode the slash as `%2F`. `@scope/name` becomes `https://registry.npmjs.org/@scope%2Fname`.
- HTTP 404 with `{"error":"Not found"}` means the package does not exist. Drop it and say so.
- The document can be large. Pull out only the fields below:

Read `dist-tags.latest`, then the release fields below from the returned document. If WebFetch
cannot expose a required field, mark that field `[UNVERIFIED]` with the reason; do not substitute
memory or run a shell command to retrieve it.

## Step 2: read these fields

- Latest version: `dist-tags.latest`. Suggest this version, not one from memory.
- Last release: `time[<latest version>]`, reported as `YYYY-MM-DD`. Do not use `time.modified`; it also changes for pre-releases and metadata edits.
- First publish: `time.created`. This shows how old the package is.
- Repository: `repository.url`. Strip `git+` from the start and `.git` from the end, open it, and check it is the same project.
- License: `license`, or the latest version's `license` if the top one is missing.
- Deprecation: `versions[<latest>].deprecated`. Any text here means the author says not to use it.
- Maintainers: the length of `maintainers`. One maintainer is common; note it, but it is not a red flag by itself.
- Install scripts: `preinstall`, `install` or `postinstall` in the latest version run code on install. Note them and look at what they do.

## Step 3: fetch weekly downloads

- Use WebFetch on `https://api.npmjs.org/downloads/point/last-week/<name>` and read `downloads`.
- Scoped names work here as they are (`@scope/name`).
- Downloads show use, not quality. Compare candidates for the same job with each other.

## Red flags

Any one of these means: not a pick, unless the report says plainly why it is still worth a look.

- The name is one character off a popular package: a letter added, dropped or swapped, `-` versus `_`, or an unscoped copy of a scoped name.
- First published days ago, especially with big claims or a README copied from another package.
- No repository, a repository that does not exist, or one that belongs to a different project.
- Deprecated, or the repository is archived.
- Very low downloads compared with other candidates for the same job.
- No release in over two years for something that handles security, sign-in, payments or files.
- Install scripts that download or run code from the internet.
- A license not allowed for the chosen channels:
  - Never: AGPL, SSPL, no license, `UNLICENSED`, or "SEE LICENSE IN" pointing to terms that are not open source.
  - Not for the Mac App Store: GPL of any version. Treat LGPL as a question for a person there too.
  - Usually fine everywhere: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD.

## How to report a candidate

One line per candidate, in exactly this shape:

```
- <name>@<version> | last release <YYYY-MM-DD> | <N>/week | <license> | <repo url> | checked <YYYY-MM-DD>
```

- `<N>` is the whole number from `downloads`, without commas.
- `checked` is the date the registry was asked, not the date of the report.
- Anything that could not be confirmed (no answer, timeout, rate limit, a field missing) gets `?` in that field and `[UNVERIFIED]` plus the reason at the end of the line. It is never suggested as a pick:

```
- some-lib@? | last release ? | ?/week | ? | ? | checked 2026-10-07 [UNVERIFIED] registry did not answer
```

- A failed request is [UNVERIFIED], not "does not exist". Only a 404 means "does not exist".

## Swift packages (Mac)

- Swift packages come from a Git repository, not a registry, so the repository is the package.
- Look it up on Swift Package Index (`https://swiftpackageindex.com/<owner>/<repo>`): latest release, last activity, license, and whether it supports macOS and the Swift version in use.
- Confirm on GitHub: `https://api.github.com/repos/<owner>/<repo>/releases/latest` gives `tag_name` and `published_at`; `https://api.github.com/repos/<owner>/<repo>` gives `license.spdx_id`, `archived` and `pushed_at`. Some projects only push tags; then use the newest tag from `/tags`.
- Use WebFetch for these public endpoints. A 403 that mentions a rate limit means mark the line [UNVERIFIED] and try later; do not use credentials or shell tools.
- There are no download counts: write `n/a` in place of `<N>/week`.
- Check that `Package.swift` at that tag lists `.macOS` at or below the app's minimum version.
- The same license rules apply, and GPL is never allowed in a Mac App Store build.
