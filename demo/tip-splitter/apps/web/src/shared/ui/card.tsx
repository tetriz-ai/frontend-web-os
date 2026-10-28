// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cn('rounded-lg border border-border bg-surface-elevated p-4', className)} />;
}
