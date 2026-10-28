#!/bin/sh
# Copyright 2026 Workloom Solutions Private Limited
# SPDX-License-Identifier: MIT
# Runs the walls check on a project where one feature reaches into another feature it may not
# depend on, and past a shared module's public entry.
set -u
root=$(cd "$(dirname "$0")/../.." && pwd)
fwos() { node "$root/plugin/dist/fwos.mjs" "$@"; }
fwos check architecture/walls --dir "$root/examples/enforce-module-walls/project"
echo "exit code: $?"
