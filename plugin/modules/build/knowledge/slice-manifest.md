# The slice manifest

Each slice commits `.fwos/slices/<change-id>/<slice>.json` with its code. `fwos check` (build/slices)
validates it against the spec, ia.json, components.json and the test results.

```json
{
  "schema": 1,
  "slice": "S1",
  "change": "0001-initial",
  "title": "Save a link",
  "platform": "web",
  "modules": ["reading-list"],
  "screens": ["list"],
  "components": ["button", "text-field", "state-handler"],
  "states": ["list:empty", "list:ready"],
  "acs": ["AC-reading-1", "AC-reading-2"],
  "dependsOn": [],
  "status": "done"
}
```

- `modules`: the only modules this slice may change. `fwos slice drift S1 --base <ref>` lists files
  changed outside them, and new dependencies with no decision row.
- `status: "done"` means every AC it claims is proven by a passing, tagged test.
