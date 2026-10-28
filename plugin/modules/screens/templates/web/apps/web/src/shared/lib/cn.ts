// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

/** Joins class names, skipping falsy ones. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
