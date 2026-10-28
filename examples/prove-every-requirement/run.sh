#!/bin/sh
# Copyright 2026 Workloom Solutions Private Limited
# SPDX-License-Identifier: MIT
# Runs the traceability check on a project at acceptance: one requirement has a passing test, one a
# failing test and one no test at all.
set -u
root=$(cd "$(dirname "$0")/../.." && pwd)
fwos() { node "$root/plugin/dist/fwos.mjs" "$@"; }
fwos check tests/traceability --dir "$root/examples/prove-every-requirement/project"
echo "exit code: $?"
