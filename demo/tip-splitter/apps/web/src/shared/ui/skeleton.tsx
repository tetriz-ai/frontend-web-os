// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { cn } from '@/shared/lib';

/** First-load placeholder only. On a refetch, keep showing the old data instead. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-surface-subtle motion-reduce:animate-none', className ?? 'h-4 w-full')} />;
}
