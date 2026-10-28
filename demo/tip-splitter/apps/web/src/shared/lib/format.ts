// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The one place dates and numbers are formatted, so every screen follows the locale slot (C15).
// The rule pack (no-raw-intl) bans Intl and toLocale* calls everywhere else.

export const LOCALE = 'en';

export function formatDate(value: Date | string | number, style: 'short' | 'medium' | 'long' = 'medium'): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: style }).format(new Date(value));
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LOCALE, options).format(value);
}

/** "3 minutes ago" within a week, an absolute date beyond that. */
export function formatRelative(value: Date | string | number, now: number = Date.now()): string {
  const then = new Date(value).getTime();
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs >= 7 * 24 * 3600) return formatDate(value);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86400), 'day');
}

/** Whole cents as en-US dollars: 123450 → "$1,234.50". */
export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
