#!/bin/sh
# Copyright 2026 Workloom Solutions Private Limited
# SPDX-License-Identifier: MIT
# Runs fwos's token check on a component that uses raw colours, a default-palette class, a raw
# font size and a radius off the ladder.
set -u
root=$(cd "$(dirname "$0")/../.." && pwd)
fwos() { node "$root/plugin/dist/fwos.mjs" "$@"; }
fwos check design-system/tokens --dir "$root/examples/catch-raw-design-values/project"
echo "exit code: $?"
