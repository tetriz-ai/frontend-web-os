import { cn, formatDate, formatRelative } from '@/shared/lib';
import { Badge, Button } from '@/shared/ui';
import { hostnameOf } from '../model/link';
import type { Item } from '../data/types';

export interface ItemRowProps {
  item: Item;
  onToggleRead?: (item: Item) => void;
  onDelete?: (item: Item) => void;
  /** Focus the Delete button when the row appears (after Undo puts it back). */
  focusDelete?: boolean;
}

/** One saved link: its title (opens the site in a new tab), hostname, when it was saved, and its read state. */
export function ItemRow({ item, onToggleRead, onDelete, focusDelete = false }: ItemRowProps) {
  // The visible label starts the accessible name, which adds the title so each row's button is unique.
  const toggleLabel = item.read ? 'Mark as unread' : 'Mark as read';
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface-elevated p-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'wrap-anywhere py-0.5 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            item.read ? 'text-body text-fg-secondary' : 'text-body-strong text-fg',
          )}
        >
          {item.title} <span className="sr-only">(opens in a new tab)</span>
        </a>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-muted">
          <span className="min-w-0 truncate">{hostnameOf(item.url)}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.savedAt} title={formatDate(item.savedAt, 'long')}>
            Saved {formatRelative(item.savedAt)}
          </time>
          {item.read ? <Badge>Read</Badge> : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          variant="secondary"
          className="min-w-36"
          aria-label={`${toggleLabel}: ${item.title}`}
          onClick={() => onToggleRead?.(item)}
        >
          {toggleLabel}
        </Button>
        <Button variant="ghost" aria-label={`Delete: ${item.title}`} autoFocus={focusDelete} onClick={() => onDelete?.(item)}>
          Delete
        </Button>
      </div>
    </li>
  );
}
