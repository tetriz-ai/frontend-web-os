#!/bin/sh
# Demonstrate an existing test's lock, a detected edit, and a reviewed unlock and relock.
set -eu
export NO_COLOR=1
root=$(cd "$(dirname "$0")/../.." && pwd)
project=$(mktemp -d)
trap 'rm -rf "$project"' EXIT HUP INT TERM
fwos() { node "$root/plugin/dist/fwos.mjs" "$@" --dir "$project"; }
fwos init --name "Test locks" >/dev/null
mkdir -p "$project/tests"
printf '%s\n' 'import assert from "node:assert/strict";' 'assert.deepEqual(["a"].toSorted(), ["a"]);' > "$project/tests/list.test.mjs"
node "$project/tests/list.test.mjs"
fwos tests lock tests/list.test.mjs --existing >/dev/null
fwos tests status
printf '%s\n' 'assert.deepEqual(["b", "a"].toSorted(), ["a", "b"]);' >> "$project/tests/list.test.mjs"
fwos tests status
# The real check fails even when a shell, rather than an editor hook, changes a locked file.
if fwos check tests/locked >"$project/check-output"; then
  echo "expected tests/locked to fail" >&2
  exit 1
else
  code=$?
  [ "$code" -eq 1 ] || exit "$code"
  grep -q '^FAIL  tests/locked' "$project/check-output"
  echo "check after edit: exit code $code"
fi
fwos tests unlock tests/list.test.mjs --reason "The requirement changed" --reviewer "Jane Doe" >/dev/null
fwos tests status
node "$project/tests/list.test.mjs"
fwos tests lock tests/list.test.mjs --existing >/dev/null
fwos tests status
fwos check tests/locked >/dev/null
echo "check after relock: exit code 0"
