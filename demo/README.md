# Demo

A real run of Frontend Web OS, from one command in an empty folder to a tested app.

- [tip-splitter/](tip-splitter/): the app it built, a bill splitter that runs on the device, with
  every file fwos wrote along the way.

## What's in the app

- `docs/app/`: the brief, research, spec, test plan, decisions, `ia.json`, `modules.json` and the
  [acceptance report](tip-splitter/docs/app/reports/acceptance.md).
- `design-system/`: the neutral starter's tokens and the component registry.
- `apps/web/`: the Next.js app, its unit and component tests, and its Playwright tests.
- `.fwos/`: the change file with every approval as a content hash, the locked tests and the slice
  manifests.

The acceptance report shows 26 of the 27 requirements proven by passing tests in a real browser.
The 27th is a VoiceOver walkthrough that waits for a person's sign-off, so acceptance is still open.

## Run it

```sh
cd demo/tip-splitter
pnpm install --frozen-lockfile
pnpm test
pnpm e2e
pnpm check
```

`pnpm e2e` needs Playwright's Chromium: `pnpm --filter web exec playwright install chromium`
downloads it. Test results stay in `.fwos/local/`, which isn't committed, so `pnpm check` fails
until the tests have run. `pnpm dev` serves the app on http://localhost:3000.

`pnpm check` runs the CLI vendored in `.fwos/cli/`, which skips the static export that `next build`
writes to `apps/web/out/`.
