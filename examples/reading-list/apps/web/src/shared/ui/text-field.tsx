import { type InputHTMLAttributes, useId } from 'react';
import { cn } from '@/shared/lib';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> {
  label: string;
  hint?: string;
  /** Shown under the field and tied to it for screen readers. Validate on blur, not every keystroke. */
  error?: string;
}

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
      {message ? (
        <p id={messageId} className={cn('text-caption', error ? 'text-critical' : 'text-fg-muted')}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
