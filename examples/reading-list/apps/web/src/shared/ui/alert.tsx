import type { ReactNode } from 'react';
import { cn } from '@/shared/lib';

export type AlertTone = 'critical' | 'warning' | 'caution' | 'info' | 'success';

const TONES: Record<AlertTone, string> = {
  critical: 'bg-critical-bg text-critical',
  warning: 'bg-warning-bg text-warning',
  caution: 'bg-caution-bg text-caution',
  info: 'bg-info-bg text-info',
  success: 'bg-success-bg text-success',
};

export interface AlertProps {
  tone?: AlertTone;
  title: string;
  /** What happened and why; for errors, what to do next. */
  children?: ReactNode;
  /** For errors: a retry. */
  action?: ReactNode;
}

/** An inline message that stays until the problem is gone (a toast is for passing confirmations). */
export function Alert({ tone = 'info', title, children, action }: AlertProps) {
  return (
    <div role={tone === 'critical' ? 'alert' : 'status'} className={cn('flex flex-col gap-2 rounded-lg border border-border-faint p-4', TONES[tone])}>
      <p className="text-body-strong">{title}</p>
      {children ? <div className="text-body">{children}</div> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}
