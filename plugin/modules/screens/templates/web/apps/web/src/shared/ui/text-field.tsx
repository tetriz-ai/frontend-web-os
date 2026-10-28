// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { type ComponentPropsWithRef, useId } from 'react';
import { cn } from '@/shared/lib';

export interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'children'> {
  label: string;
  hint?: string;
  /** Shown under the field and tied to it for screen readers. Validate on blur, not every keystroke. */
  error?: string;
}

/**
 * A labelled input. Pass `ref` to move focus back after a failed save. The message line always
 * keeps its space, so an error appearing never shifts what's below it (a click there still lands).
 */
export function TextField({ label, hint, error, id, className, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={inputId} className="text-label text-fg">
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className={cn(
          'min-h-9 rounded-md border bg-surface px-3 text-body text-fg placeholder:text-fg-muted',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          'disabled:cursor-not-allowed disabled:bg-disabled disabled:text-fg-disabled',
          error ? 'border-critical' : 'border-border',
        )}
      />
      <p id={messageId} aria-live="polite" className={cn('min-h-4 text-caption', error ? 'text-critical' : 'text-fg-muted')}>
        {message}
      </p>
    </div>
  );
}
