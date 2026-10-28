// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** zero: nothing here yet. filtered: things exist, but the filters hide them all. */
  kind: 'zero' | 'filtered';
  title: string;
  children?: ReactNode;
  /** The next step: create the first item, or clear the filters. */
  action?: ReactNode;
}

export function EmptyState({ kind, title, children, action }: EmptyStateProps) {
  return (
    <div
      role="status"
      data-kind={kind}
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center"
    >
      <p className="text-heading text-fg">{title}</p>
      {children ? <div className="max-w-prose text-body text-fg-muted">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
