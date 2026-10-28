# Releasing

Frontend Web OS is distributed through the
[`tetriz-ai/frontend-web-os`](https://github.com/tetriz-ai/frontend-web-os) GitHub marketplace and
GitHub Releases. The plugin bundles the CLI, and generated apps pin their own copy in `.fwos/cli/`.
No npm registry package or npm name reservation is required.

The marketplace installs the generated `distribution/plugin/` payload. `pnpm build` refreshes it
from `plugin/`, omitting development tests and fixtures. Commit it together with `plugin/dist/`.

The version in `plugin/.claude-plugin/plugin.json` and the root `package.json` must match.
The private package named `fwos-check` identifies the local CLI that apps install from disk.
The root package is marked `private: true` to prevent accidental registry publication.

## Before a release

1. `pnpm verify`, `pnpm test:e2e` and `scripts/run-examples.sh` all pass.
2. The evals run against the release candidate with a pinned model and a cost cap, and
   `plugin/evals/MODELS.md` records the models:
   `claude plugin eval plugin --trust-plugin --no-publish --max-cost-usd 10`.
3. Inspect the plugin's shipped files and any packed CLI artifact. Confirm their licenses and
   that the public installation commands in the README match the marketplace.

## Publishing to GitHub

1. Set the same version in `plugin/.claude-plugin/plugin.json` and `package.json`. In
   `CHANGELOG.md`, move the Unreleased entries under `## [<version>] - YYYY-MM-DD` using the actual
   release date, and add a link to the matching GitHub Release. Until the first release is tagged,
   keep its entries under Unreleased.
2. Confirm validation is green on the release commit. `claude plugin tag plugin --dry-run`
   checks that plugin.json and the marketplace entry agree without creating a tag.
3. In a disposable export, copy `scripts/npm/README.md` over `README.md` so the CLI archive
   includes its standalone documentation. Check it with `npm pack --dry-run`, then `npm pack`
   and an offline install into a temporary project. `npm pack` builds a local tarball without publishing to a
   registry.
4. Tag the release commit `v<version>` and push the tag. With Actions enabled, the release
   workflow creates a GitHub Release and attaches `fwos-check-<version>.tgz`. With Actions
   disabled, create the GitHub Release manually and upload the archive after the same local
   validation.
   Tagging is an explicit release action, separate from preparation.
5. Check the release notes against the changelog, then verify the marketplace installation
   and the release artifact from a clean environment.

The packed CLI must preserve the relative layout of `plugin/dist/` and
`plugin/modules/rules/pack/` under the same `plugin/` root because `fwos check` reads the rules from disk. Its usage is described in
[scripts/npm/README.md](../scripts/npm/README.md).

Updating the plugin does not replace an app's pinned CLI automatically. In an app, `fwos update`
previews the refresh and `fwos update --yes` applies it with backups.
