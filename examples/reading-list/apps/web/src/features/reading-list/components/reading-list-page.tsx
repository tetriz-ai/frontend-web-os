'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createLocalRepository } from '../data/local-repository';
import { useCreateItem, useDeleteItem, useItems, useUpdateItem } from '../data/queries';
import type { ReadingListRepository } from '../data/repository';
import type { Item, NewItem } from '../data/types';
import { parseFilter } from '../model/filter';
import { ReadingListView } from './reading-list-view';

export interface ReadingListPageProps {
  /** The `show` value from the address: "unread", "read", or anything else for All. */
  show?: string;
  /** Which backend the page talks to. Defaults to local mode: this browser's storage (D-6). */
  repository?: ReadingListRepository;
}

/** How long "Deleted. Undo" stays (D-2). */
export const UNDO_MS = 5_000;

const reason = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something stopped the change before it finished. Try again.');

const without = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

/** The list page with real data: the one place that picks the repository and wires it into the view. */
export function ReadingListPage({ show, repository }: ReadingListPageProps) {
  const [repo] = useState(() => repository ?? createLocalRepository());
  const items = useItems(repo);
  const create = useCreateItem(repo);
  const update = useUpdateItem(repo);
  const [saveError, setSaveError] = useState<string>();
  const [changeError, setChangeError] = useState<string>();

  // Delete with undo (D-14): a deleted link is hidden at once and deleted for good when the window
  // ends, when another link is deleted, or when the page goes away.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<Item | null>(null);
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const pendingRef = useRef<Item | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const remove = useDeleteItem(repo, (id, error) => {
    setHidden((h) => without(h, id));
    setChangeError(reason(error));
  });

  const stopTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };

  const onDelete = (item: Item) => {
    setChangeError(undefined);
    setRestoredId(null);
    const previous = pendingRef.current;
    stopTimer();
    if (previous) remove.mutate(previous.id);
    pendingRef.current = item;
    setPending(item);
    setHidden((h) => new Set(h).add(item.id));
    timer.current = setTimeout(() => {
      timer.current = undefined;
      pendingRef.current = null;
      setPending(null);
      remove.mutate(item.id);
    }, UNDO_MS);
  };

  const onUndo = () => {
    const item = pendingRef.current;
    if (!item) return;
    stopTimer();
    pendingRef.current = null;
    setPending(null);
    setHidden((h) => without(h, item.id));
    setRestoredId(item.id);
  };

  useEffect(() => {
    if (restoredId) setRestoredId(null);
  }, [restoredId]);

  useEffect(() => {
    // Leaving the page ends the undo window. The local delete finishes synchronously, before unload.
    const flush = () => {
      const item = pendingRef.current;
      if (!item) return;
      stopTimer();
      pendingRef.current = null;
      void repo.deleteItem(item.id).catch(() => {});
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [repo]);

  const onSave = async (input: NewItem) => {
    setSaveError(undefined);
    try {
      await create.mutateAsync(input);
      return true;
    } catch (e) {
      setSaveError(reason(e));
      return false;
    }
  };

  const onToggleRead = (item: Item) => {
    setChangeError(undefined);
    update.mutate({ id: item.id, read: !item.read }, { onError: (e) => setChangeError(reason(e)) });
  };

  const shown = useMemo(() => (items.data ?? []).filter((item) => !hidden.has(item.id)), [items.data, hidden]);
  const status = items.data ? 'ready' : items.isError ? 'error' : 'loading';
  return (
    <ReadingListView
      status={status}
      items={shown}
      filter={parseFilter(show)}
      loadError={items.error?.message}
      onRetry={() => void items.refetch()}
      onSave={onSave}
      saving={create.isPending}
      saveError={saveError}
      onToggleRead={onToggleRead}
      changeError={changeError}
      onDelete={onDelete}
      pendingDelete={pending}
      onUndo={onUndo}
      focusDeleteOf={restoredId}
    />
  );
}
