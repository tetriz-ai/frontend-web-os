// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { useId } from 'react';
import { cn } from '@/shared/lib';

export interface NumberStepperProps {
  label: string;
  /** What's in the field; a string so a half-typed value can be shown as typed. */
  value: string;
  min: number;
  max: number;
  onChange: (value: string) => void;
  onStep: (next: number) => void;
  decrementLabel: string;
  incrementLabel: string;
  error?: string;
  className?: string;
}

/**
 * − / + buttons around a whole-number field. A button turns off at its bound, so it can't push the
 * value out of range. The field still takes typing; the caller validates it.
 */
export function NumberStepper({ label, value, min, max, onChange, onStep, decrementLabel, incrementLabel, error, className }: NumberStepperProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const current = Number.parseInt(value, 10);
  const valid = Number.isInteger(current);
  const stepButton =
    'flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-surface-elevated text-heading text-fg hover:bg-hover ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60';
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-label text-fg">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={decrementLabel} className={stepButton} disabled={valid && current <= min} onClick={() => onStep(valid ? current - 1 : min)}>
          <span aria-hidden="true">−</span>
        </button>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? messageId : undefined}
          className={cn(
            'min-h-11 w-20 rounded-md border bg-surface px-3 text-center text-body text-fg',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
            error ? 'border-critical' : 'border-border',
          )}
        />
        <button type="button" aria-label={incrementLabel} className={stepButton} disabled={valid && current >= max} onClick={() => onStep(valid ? current + 1 : min)}>
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <p id={messageId} aria-live="polite" className="min-h-4 text-caption text-critical">
        {error}
      </p>
    </div>
  );
}
