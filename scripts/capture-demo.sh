#!/bin/sh
# Copyright 2026 Workloom Solutions Private Limited
# SPDX-License-Identifier: MIT
# Requires Node.js 22+, VHS, ttyd, ffmpeg and a Chromium browser available to VHS.
set -eu
repo=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo"
vhs scripts/demo.tape
