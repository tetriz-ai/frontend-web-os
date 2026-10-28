#!/bin/sh
# Copyright 2026 Workloom Solutions Private Limited
# SPDX-License-Identifier: MIT
# Runs the same fwos on both surfaces of the second pack, then puts one file of the first pack (the
# reading list's) in place of the second's, to show the checks read the pack, not fwos's defaults.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
fwos() { node "$root/plugin/dist/fwos.mjs" "$@"; }
here=$(cd "$(dirname "$0")" && pwd)
first="$root/examples/reading-list"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R "$here/console" "$here/site" "$work/"
echo "console"
fwos check design-system/contrast design-system/chart-palette architecture/walls rules/pack --dir "$work/console" | grep -E '^(PASS|FAIL|OFF) '
echo
echo "site"
fwos check design-system/contrast design-system/chart-palette screens/ia rules/pack --dir "$work/site" | grep -E '^(PASS|FAIL|OFF) '
echo
echo "console, with the reading list's components.json"
cp "$first/design-system/components.json" "$work/console/design/components.json"
fwos check design-system/registry design-system/required-states --dir "$work/console" | grep -E '^(FAIL|      )' | head -8
echo
echo "site, ia diff from the reading list's ia.json"
fwos ia diff --from "$first/docs/app/ia.json" --dir "$work/site"
