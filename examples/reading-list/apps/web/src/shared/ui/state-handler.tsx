import type { ReactNode } from 'react';
import { Alert } from './alert';
import { Button } from './button';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

export type LoadStatus = 'loading' | 'error' | 'empty' | 'ready';

export interface StateHandlerProps {
  status: LoadStatus;
  /** What is loading, in words ("your reading list"). */
  label: string;
  error?: { message: string; onRetry?: () => void };
  empty?: ReactNode;
  skeleton?: ReactNode;
  children?: ReactNode;
}

/** The page-level state wrapper: a skeleton on first load, a reason and a retry on error, a real empty state. */
export function StateHandler({ status, label, error, empty, skeleton, children }: StateHandlerProps) {
  if (status === 'loading') {
    return (
      <div aria-busy="true" aria-label={`Loading ${label}`}>
        {skeleton ?? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <Alert
        tone="critical"
        title={`Couldn't load ${label}`}
        action={error?.onRetry ? <Button variant="secondary" onClick={error.onRetry}>Try again</Button> : undefined}
      >
        {error?.message ?? 'The request stopped before it finished.'}
      </Alert>
    );
  }
  if (status === 'empty') return <>{empty ?? <EmptyState kind="zero" title={`No ${label} yet`} />}</>;
  return <>{children}</>;
}
