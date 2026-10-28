'use client';

import { type Item, ReadingListView, type ReadingListViewProps } from '@/features/reading-list';
import { fixtures } from '../../../../packages/api-contract/generated/mock-fetch';
import type { ScreenProps } from './registry';

// The list page ("/") in every state from docs/app/ia.json, drawn by the feature's own view on the
// contract's fixtures. Nothing here saves: the handlers are no-ops.

const listBody = <T,>(variant: string): T => fixtures.listItems![variant]!.body as T;

const noop = () => {};
const handlers = { onSave: async () => false, onRetry: noop, onToggleRead: noop } satisfies Partial<ReadingListViewProps>;

export function ListScreen({ state }: ScreenProps) {
  switch (state) {
    case 'loading':
      return <ReadingListView status="loading" items={[]} {...handlers} />;
    case 'empty':
      return <ReadingListView status="ready" items={listBody<Item[]>('empty')} {...handlers} />;
    case 'error':
      return (
        <ReadingListView status="error" items={[]} loadError={listBody<{ message: string }>('unavailable').message} {...handlers} />
      );
    case 'filtered-empty':
      return <ReadingListView status="ready" items={listBody<Item[]>('default')} filter="read" {...handlers} />;
    case 'ready':
    default:
      return <ReadingListView status="ready" items={listBody<Item[]>('many')} {...handlers} />;
  }
}
