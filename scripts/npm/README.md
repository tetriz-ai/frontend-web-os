# fwos-check CLI artifact

The `fwos` CLI from [Frontend Web OS](https://github.com/tetriz-ai/frontend-web-os) runs 24 checks
for CI without a model. It catches raw design values where a token belongs, imports across module
walls and requirements that no passing test proves.

Frontend Web OS is distributed through GitHub. The name `fwos-check` identifies its local
package, and installation does not require a package published to the npm registry.

Each check prints PASS, FAIL or OFF with its reason. OFF means the check could not run yet and
never counts as a pass. `fwos check` exits 1 when a check fails.

## Use it in an existing app

Use Node.js 22 or newer and an existing Next.js app. App Router is supported, while Pages Router
and Tailwind CSS 3 have partial coverage that the adoption proposal lists. Other frameworks are
unsupported.

Clone the source beside your existing app:

```sh
git clone https://github.com/tetriz-ai/frontend-web-os.git ../frontend-web-os
```

From the existing app's root, preview adoption before writing its records:

```sh
node ../frontend-web-os/plugin/dist/fwos.mjs adopt
node ../frontend-web-os/plugin/dist/fwos.mjs adopt --yes
node ../frontend-web-os/plugin/dist/fwos.mjs vendor
pnpm add -D file:.fwos/cli
pnpm exec fwos check
```

`adopt` previews the detected app, coverage and proposed files without writes. `adopt --yes`
records a baseline of current findings, so `fwos check` fails only on new ones. Unsupported apps
are refused without writes.

Commit `.fwos/cli/`, its package pin and the lockfile with the app. CI can then install the pinned
CLI without cloning Frontend Web OS or downloading a registry package. Apps scaffolded by the
plugin already have this local copy.

`fwos doctor` explains what turns each check on. Run `fwos tests run` before `fwos check` to
record the current application and test inputs and exact JUnit result hashes. At acceptance,
unrecorded or stale XML alone does not prove a requirement.

## GitHub Release tarball

GitHub Releases carry the CLI tarball produced by `npm pack`. Install a downloaded artifact
with `pnpm add -D ./fwos-check-<version>.tgz`, using its actual version. This installs a local file
without contacting npm for an fwos package.

## More

- [Frontend Web OS and its plugin installation](https://github.com/tetriz-ai/frontend-web-os#quick-start)
- [What each check catches](https://github.com/tetriz-ai/frontend-web-os/blob/main/docs/checks.md)
- [Every command](https://github.com/tetriz-ai/frontend-web-os/blob/main/plugin/kernel/knowledge/cli.md)
- [Changelog](https://github.com/tetriz-ai/frontend-web-os/blob/main/CHANGELOG.md)

The license terms are in [LICENSE](https://github.com/tetriz-ai/frontend-web-os/blob/main/LICENSE)
and [NOTICE](https://github.com/tetriz-ai/frontend-web-os/blob/main/NOTICE), both included in the
packed artifact.
