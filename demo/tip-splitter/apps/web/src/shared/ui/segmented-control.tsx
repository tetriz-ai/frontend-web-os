// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { useId } from 'react';
import { cn } from '@/shared/lib';

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  legend: string;
  options: SegmentedOption[];
  /** The picked value, or null when nothing is picked (e.g. a custom value is typed elsewhere). */
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A row of real radio inputs styled as buttons, so screen readers announce "radio, 2 of 4, checked".
 * Each segment is at least 44px tall for thumbs at the table.
 */
export function SegmentedControl({ legend, options, value, onChange, disabled, className }: SegmentedControlProps) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className={cn('flex flex-col gap-1', className)}>
      <legend className="mb-1 text-label text-fg">{legend}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-md border border-border bg-surface-subtle p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex min-h-11 cursor-pointer items-center justify-center rounded-sm text-label text-fg transition-colors ease-standard',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus',
              'has-[:checked]:bg-brand has-[:checked]:text-on-brand has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
              value === option.value ? null : 'hover:bg-hover',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
