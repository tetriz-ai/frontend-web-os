#!/bin/sh
# Copyright 2026 Workloom Solutions Private Limited
# SPDX-License-Identifier: MIT

# jq is optional. Without it, or when cwd cannot be checked conservatively, the Node
# entry retains its full parsing and dispatch behavior. Never narrow the all-tool matcher.
entry=${0%/*}/entry.mjs
case "$#:$1" in
  1:pre-tool-use|1:post-tool-use) ;;
  *) exec node "$entry" "$@" ;;
esac
# The usual in-project call needs no JSON preflight; Node reads the original stdin.
dir=$(pwd -P)
while :; do
  if [ -e "$dir/.fwos/state.json" ]; then exec node "$entry" "$@"; fi
  if [ "$dir" = / ]; then break; fi
  dir=${dir%/*}
  dir=${dir:-/}
done
input=$(cat)
if command -v jq >/dev/null 2>&1; then
  if dir=$(printf '%s' "$input" | jq -ser --arg cwd "$(pwd -P)" '
    select(length == 1) | .[0] | select(type == "object") |
    (if (.cwd | type) == "string" then .cwd else $cwd end) |
    select(startswith("/") and (test("[\u0000-\u001f]") | not)) |
    split("/") | reduce .[] as $part ([];
      if $part == ".." then .[:-1]
      elif $part == "" or $part == "." then .
      else . + [$part] end) | "/" + join("/")
  ' 2>/dev/null); then
    while :; do
      if [ -e "$dir/.fwos/state.json" ]; then break; fi
      if [ "$dir" = / ]; then exit 0; fi
      dir=${dir%/*}
      dir=${dir:-/}
    done
  fi
fi
printf '%s' "$input" | node "$entry" "$@"
