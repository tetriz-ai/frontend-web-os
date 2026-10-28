# Examples

| You want | Example |
|---|---|
| To see `fwos check` catch raw design values in app code | [catch-raw-design-values](catch-raw-design-values/) |
| To see `fwos check` fail a requirement no passing test proves | [prove-every-requirement](prove-every-requirement/) |
| To detect a test edited after locking it, then unlock and relock with a reason | [protect-locked-tests](protect-locked-tests/) |
| To enforce module walls from a `modules.json` | [enforce-module-walls](enforce-module-walls/) |
| To bring your own design system with its own token names | [swap-in-a-design-system](swap-in-a-design-system/) |
| To start from a shadcn theme you already have | [import-a-shadcn-theme](import-a-shadcn-theme/) |
| To see fwos follow a pack that differs from the sample's on every seam, across two surfaces | [second-pack](second-pack/) |
| A whole app built through every fwos step | [reading-list](reading-list/) |

`scripts/run-examples.sh` runs every example that has a `run.sh` and compares its output with the
last block of its README. They run against the CLI in `plugin/dist/`, offline, in temporary
folders. The reading list has its own README with the commands to install and run it.
