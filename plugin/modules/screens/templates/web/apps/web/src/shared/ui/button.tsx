// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/lib';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-hover',
  secondary: 'border border-border bg-surface-elevated text-fg hover:bg-hover',
  ghost: 'bg-transparent text-fg hover:bg-hover',
  danger: 'bg-critical text-fg-inverted hover:opacity-90',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  children: ReactNode;
}

/** One primary action per view. While loading, the label keeps its space so the width doesn't jump. */
export function Button({ variant = 'primary', loading = false, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-4 text-label transition-colors ease-standard',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        className,
      )}
    >
      <span className={loading ? 'invisible' : undefined}>{children}</span>
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner />
          <span className="sr-only">Loading</span>
        </span>
      ) : null}
    </button>
  );
}
