'use client';

// Server state for the list, through TanStack Query. The skeleton shows only while there's no data
// yet (R-states-1): saves update the cached list and refetch in the background.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReadingListRepository } from './repository';
import type { Item, NewItem } from './types';

export const itemsKey = ['reading-list', 'items'] as const;

export function useItems(repository: ReadingListRepository) {
  // Retrying blocked storage can't help; the person retries once they've allowed it.
  return useQuery({ queryKey: itemsKey, queryFn: () => repository.listItems(), retry: false });
}

export function useCreateItem(repository: ReadingListRepository) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: NewItem) => repository.createItem(input),
    onSuccess: (item) => {
      client.setQueryData<Item[]>(itemsKey, (old) => [item, ...(old ?? [])]);
      return client.invalidateQueries({ queryKey: itemsKey });
    },
  });
}

/** Read state is cheap and reversible, so it updates at once and rolls back if the save fails (R-interaction-2). */
export function useUpdateItem(repository: ReadingListRepository) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) => repository.updateItem(id, { read }),
    onMutate: async ({ id, read }) => {
      await client.cancelQueries({ queryKey: itemsKey });
      const previous = client.getQueryData<Item[]>(itemsKey);
      client.setQueryData<Item[]>(itemsKey, (old) => old?.map((item) => (item.id === id ? { ...item, read } : item)));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(itemsKey, context.previous);
    },
    onSettled: () => client.invalidateQueries({ queryKey: itemsKey }),
  });
}

/** Deletes for good. The page calls it only once the undo window has passed (D-14). */
export function useDeleteItem(repository: ReadingListRepository, onFailed?: (id: string, error: Error) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repository.deleteItem(id),
    onError: (error, id) => onFailed?.(id, error),
    onSuccess: (_result, id) => {
      client.setQueryData<Item[]>(itemsKey, (old) => old?.filter((item) => item.id !== id));
    },
    onSettled: () => client.invalidateQueries({ queryKey: itemsKey }),
  });
}
