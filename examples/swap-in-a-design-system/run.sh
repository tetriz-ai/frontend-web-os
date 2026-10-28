#!/bin/sh
# Copyright 2026 Workloom Solutions Private Limited
# SPDX-License-Identifier: MIT
# Starts an fwos project, drops in the Ember design system (its own token names, mapped onto
# fwos's slots), checks it, builds the CSS variables components use, and prints the outcomes the
# mapping report keeps apart.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
fwos() { node "$root/plugin/dist/fwos.mjs" "$@"; }
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
fwos init --name "Ember demo" >/dev/null
cp -R "$here/ember" design-system
fwos check design-system/schema design-system/contrast | grep -E '^(PASS|FAIL)'
fwos tokens build
grep -E -- '--ds-(surface-base|text-primary|brand-primary|font-sans):' packages/tokens/generated/tokens.css | head -4
fwos design-system report
