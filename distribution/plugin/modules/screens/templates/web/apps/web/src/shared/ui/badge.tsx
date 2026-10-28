// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import type { ReactNode } from 'react';
import { cn } from '@/shared/lib';

export type Tone = 'neutral' | 'brand' | 'critical' | 'warning' | 'caution' | 'info' | 'success';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-subtle text-fg-secondary',
  brand: 'bg-accent text-on-accent',
  critical: 'bg-critical-bg text-critical',
  warning: 'bg-warning-bg text-warning',
  caution: 'bg-caution-bg text-caution',
  info: 'bg-info-bg text-info',
  success: 'bg-success-bg text-success',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-caption', TONES[tone])}>{children}</span>;
}
