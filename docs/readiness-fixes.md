# Readiness fixes

This records the scoped follow-up to the 27 October 2026 Frontend Web OS review.
The intended public distribution is `tetriz-ai/frontend-web-os`. Repository visibility, releases and registry names are
separate actions; this change does not publish a release or change visibility.

| Findings | Resolution |
|---|---|
| FW-B1, FW-S6, FW-M9 | README prose checks pass, the marketplace install leads, and command recipes live in the guide. |
| FW-B2, FW-S7 | Use GitHub marketplace distribution and optional GitHub Release CLI archives. Apps pin `file:.fwos/cli`. No npm registry publication or name reservation is required. The package is private and the changelog uses the actual tagged release date. |
| FW-S8 | Keep MIT and Workloom Solutions Private Limited copyright, including scaffold notices, consistent with the existing Tetriz convention. |
| FW-S5 | Pin the scaffold CI actions to current release commits and refresh the example, demo, marketplace and vendored copies. |
| FW-S11 | README links the privacy statement. |
| FW-M1 | Keep the generic payments exclusion in the historical demo brief. No demo requirements or approvals are changed. |
| FW-M2 | Regenerate the browser galleries. Identify the validation source by content hashes instead of a commit that may disappear when exported into new public Git history. |
| FW-M3 | Contributors have agreed to be listed, as confirmed by the owner. |
| FW-M4 | Marketplace installs a generated production payload, checked against source, excluding developer source, tests, fixtures and evals. |
| FW-M5 | Keep the all-tool matcher required by the independent test planner. A shell bootstrap uses optional jq to skip Node entirely outside fwos projects. Without jq, the existing Node entry remains the fallback. |
| FW-M6 | Keep `tetriz-ai` as publisher/author and Workloom Solutions Private Limited as legal copyright holder. These fields serve different purposes. |
| FW-M7 | Add `.nvmrc` at Node 24.11.0 and document the development floor. Runtime support remains Node 22+. |
| FW-M11 | Correct the three e2e files, place demo vendor instructions under their own heading, and align Codex validation descriptions. |

## Owner exclusions

GitHub settings, Actions hardening, security and permission findings are outside this follow-up:
FW-B3, FW-S1–S4, FW-S12, FW-M8 and the environment-file inspection in FW-M12.
FW-S10 (Dependabot), FW-M10 (demo CI) and FW-S9 (Code of Conduct contact) were explicitly declined.
The existing Code of Conduct remains unchanged.

Actions are intentionally disabled for this repository. The demo CI job (FW-M10) and
automated release validation (FW-S4) remain outside this follow-up under that policy.
Validation and releases are performed manually while Actions are disabled.

The release workflow changes only to replace npm publication with a GitHub Release archive, as
required by the distribution decision. This does not represent completion of the excluded CI or
security recommendations. The installation commands target `tetriz-ai/frontend-web-os`. Repository access is required
while its visibility is private.

## Validation

Run `pnpm verify`, `pnpm fixtures --check` and `scripts/run-examples.sh` against the final tree.
The suite includes isolated production-plugin installation, scaffold/vendor and Codex-agent
checks, offline packed-CLI checks, hook parity tests and gallery-source reconstruction.
The gallery browser samples are regenerated with
`FWOS_E2E=1 FWOS_GALLERY_SAMPLES=1 pnpm exec vitest run scripts/tests/gallery.test.ts -t 'the gallery on an app fwos scaffolds'`.

Hosted CI, live model evals and real Codex model sessions are not claimed by this scoped fix.

The final local run on Node 26.12.0 and pnpm 10.34.5 passed `pnpm verify`: typecheck, lint,
production build, 1,324 tests, all ten repository checks and demo-vendor validation. The ordinary
suite skipped 48 cases in four opt-in files. All three scaffold-gallery browser cases passed in
the separate regeneration run, and all seven runnable CLI examples passed. The reading-list app
has its own commands and is not counted as a CLI example. Fixture generation matched all 24 checks.
A packed CLI installed from a local tarball with an empty offline package store and printed version
0.1.0. The local-server tests required execution outside the filesystem/network sandbox, where a
minimal localhost bind otherwise fails with EPERM.

Independent code and documentation reviewers found no substantive issues. A final fresh review of
the staged source and generated payload found no findings; the only subsequent change is this
validation receipt. These scoped reviews do not replace the excluded security review or establish
full release readiness.


## S5 and M5 follow-up validation

On Node 26.12.0 and pnpm 10.34.5, typecheck, lint, ShellCheck, all ten repository checks,
fixture generation and demo-vendor verification passed. The ordinary suite excluding gallery
provenance passed 1,329 tests with 48 opt-in cases skipped. The four gallery-provenance tests
passed separately after all three scaffold-gallery browser cases regenerated the samples.
All seven runnable CLI examples passed.

The installed production payload denies planner reads, shell commands and custom tools through
the shell entry, including payload working-directory overrides. The outside-project fast path
also passed with a fake Node executable that fails if started. A separate test verifies the
Node fallback without jq.

A local outside-project benchmark measured 30 calls after five warmups per entry. Median hook
latency fell from 102.9 ms for the Node bootstrap to 17.84 ms for the shell bootstrap with jq.
This measures process startup on this Mac, not latency inside an fwos project or on other hosts.
