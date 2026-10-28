#!/bin/sh
# Copyright 2026 Workloom Solutions Private Limited
# SPDX-License-Identifier: MIT
# Imports a plain shadcn theme into DTCG tokens, lists what fwos had to assume, runs the contrast
# check on the result, then prints the outcomes the mapping report keeps apart.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
fwos() { node "$root/plugin/dist/fwos.mjs" "$@"; }
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
cp "$here/globals.css" .
fwos init --name "shadcn demo" >/dev/null
fwos design-system init --from-shadcn globals.css --name "shadcn default"
fwos check design-system/contrast || echo "exit code: $?"
fwos design-system report
