'use client';

import Link from 'next/link';
import { useEffect, useId, useRef } from 'react';
import { formatNumber } from '@/shared/lib';
import { Alert, Button, EmptyState, StateHandler } from '@/shared/ui';
import type { Item, NewItem } from '../data/types';
import { type Filter, applyFilter, filterLabel } from '../model/filter';
import { FilterBar } from './filter-bar';
import { ItemRow } from './item-row';
import { ListSkeleton } from './list-skeleton';
import { SaveLinkForm } from './save-link-form';

export interface ReadingListViewProps {
  /** loading: the first read hasn't finished. error: it failed. ready: the list is here (maybe empty). */
  status: 'loading' | 'error' | 'ready';
  /** Every saved link, newest first. The view applies the filter. */
  items: Item[];
  filter?: Filter;
  /** Why the list couldn't be loaded. */
  loadError?: string;
  onRetry?: () => void;
  /** Resolves true when the link was saved. */
  onSave: (input: NewItem) => Promise<boolean>;
  saving?: boolean;
  /** Why the last save failed. */
  saveError?: string;
  onToggleRead?: (item: Item) => void;
  /** Why the last change to a link failed (it has been put back). */
  changeError?: string;
  onDelete?: (item: Item) => void;
  /** The link just deleted, while it can still be undone (it's already left `items`). */
  pendingDelete?: Item | null;
  onUndo?: () => void;
  /** After an undo: the restored row, whose Delete button takes focus again. */
  focusDeleteOf?: string | null;
}

const savedLinks = (n: number) => (n === 1 ? 'your 1 saved link' : `all ${formatNumber(n)} saved links`);

/**
 * The list page, drawn from props only. The page wires real data into it; the dev-only screens
 * route draws it on the contract's fixtures, so the two can't drift apart.
 */
export function ReadingListView({
  status,
  items,
  filter = 'all',
  loadError,
  onRetry,
  onSave,
  saving,
  saveError,
  onToggleRead,
  changeError,
  onDelete,
  pendingDelete = null,
  onUndo,
  focusDeleteOf = null,
}: ReadingListViewProps) {
  const linkId = useId();
  const headingId = useId();

  // When the undo message goes on its own while it had focus, focus would fall to the page; keep it nearby.
  const hadUndo = useRef(false);
  useEffect(() => {
    if (pendingDelete) {
      hadUndo.current = true;
      return;
    }
    if (!hadUndo.current) return;
    hadUndo.current = false;
    if (!document.activeElement || document.activeElement === document.body) document.getElementById(headingId)?.focus();
  }, [pendingDelete, headingId]);
  const listStatus = status === 'ready' && items.length === 0 ? 'empty' : status;
  const visible = applyFilter(items, filter);

  // A row that leaves the current filter takes keyboard focus with it; hand focus to the heading.
  const toggle = (item: Item) => {
    onToggleRead?.(item);
    if (filter !== 'all') document.getElementById(headingId)?.focus();
  };

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-title text-fg">Your reading list</h1>
        <p className="text-body text-fg-secondary">Links to read later, saved in this browser on this device.</p>
      </header>

      <SaveLinkForm linkId={linkId} onSave={onSave} saving={saving} error={saveError} />

      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id={headingId}
            tabIndex={-1}
            className="rounded-sm text-heading text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Saved links
          </h2>
          {listStatus === 'ready' ? <FilterBar current={filter} /> : null}
        </div>
        {pendingDelete ? (
          <Alert
            key={pendingDelete.id}
            tone="info"
            title="Deleted."
            action={
              <Button variant="secondary" autoFocus onClick={onUndo}>
                Undo
              </Button>
            }
          >
            {pendingDelete.title}
          </Alert>
        ) : null}
        {changeError ? (
          <Alert tone="critical" title="Couldn't change that link">
            {changeError}
          </Alert>
        ) : null}
        <StateHandler
          status={listStatus}
          label="your reading list"
          skeleton={<ListSkeleton />}
          error={{ message: loadError ?? 'The list stopped loading before it finished.', ...(onRetry ? { onRetry } : {}) }}
          empty={
            <EmptyState
              kind="zero"
              title="Save your first link"
              action={
                <Button variant="secondary" onClick={() => document.getElementById(linkId)?.focus()}>
                  Add a link
                </Button>
              }
            >
              Paste a web address in the form above. Your links stay in this browser, newest first.
            </EmptyState>
          }
        >
          {visible.length === 0 ? (
            <EmptyState
              kind="filtered"
              title={`No ${filterLabel(filter).toLowerCase()} links`}
              action={
                <Link
                  href="/"
                  className="inline-flex min-h-9 items-center rounded-md border border-border bg-surface-elevated px-4 text-label text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  Show all
                </Link>
              }
            >
              The {filterLabel(filter)} filter is hiding {savedLinks(items.length)}.
            </EmptyState>
          ) : (
            <ul aria-label="Saved links" className="flex flex-col gap-3">
              {visible.map((item) => (
                <ItemRow key={item.id} item={item} onToggleRead={toggle} onDelete={onDelete} focusDelete={item.id === focusDeleteOf} />
              ))}
            </ul>
          )}
        </StateHandler>
      </section>
    </section>
  );
}
