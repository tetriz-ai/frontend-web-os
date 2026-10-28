import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Item,
  READING_LIST_STORAGE_KEY,
  ReadingListPage,
  type ReadingListRepository,
  createLocalRepository,
} from '@/features/reading-list';
import { fixtures } from '../../../../../packages/api-contract/generated/mock-fetch';

// Slice S3, delete with undo: TC-reading-20. Fake timers stand in for the 5-second undo window.

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const listBody = (variant: 'default') => fixtures.listItems![variant]!.body as Item[];

function seeded(items: Item[]): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem(READING_LIST_STORAGE_KEY, JSON.stringify(items));
  return storage;
}

const storedTitles = (storage: MemoryStorage) =>
  (JSON.parse(storage.getItem(READING_LIST_STORAGE_KEY) ?? '[]') as Item[]).map((i) => i.title);

function renderList(repository: ReadingListRepository) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <QueryClientProvider client={client}>
      <ReadingListPage repository={repository} />
    </QueryClientProvider>,
  );
  return { user };
}

const rows = async () => within(await screen.findByRole('list', { name: 'Saved links' })).getAllByRole('listitem');
const titles = async () => (await rows()).map((r) => within(r).getByRole('link').textContent?.replace(' (opens in a new tab)', ''));

const FIRST = 'The case for slow reading';
const SECOND = 'Notes on focus';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-07T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deleting a link', () => {
  it('hides the row at once, focuses Undo, and Undo puts it back in its place @AC-reading-8', async () => {
    const storage = seeded(listBody('default'));
    const { user } = renderList(createLocalRepository(() => storage));
    expect(await titles()).toEqual([FIRST, SECOND, 'example.net']);

    await user.click(screen.getByRole('button', { name: `Delete: ${SECOND}` }));
    expect(await titles()).toEqual([FIRST, 'example.net']);
    const message = screen.getByRole('status');
    expect(message).toHaveTextContent('Deleted.');
    expect(message).toHaveTextContent(SECOND);
    expect(within(message).getByRole('button', { name: 'Undo' })).toHaveFocus();

    await user.click(within(message).getByRole('button', { name: 'Undo' }));
    expect(await titles()).toEqual([FIRST, SECOND, 'example.net']);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(storedTitles(storage)).toEqual([FIRST, SECOND, 'example.net']);
  });

  it('makes the deletion final when the 5 seconds pass @AC-reading-8', async () => {
    const storage = seeded(listBody('default'));
    const { user } = renderList(createLocalRepository(() => storage));
    await rows();

    await user.click(screen.getByRole('button', { name: `Delete: ${SECOND}` }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument());
    await waitFor(() => expect(storedTitles(storage)).toEqual([FIRST, 'example.net']));
    expect(await titles()).toEqual([FIRST, 'example.net']);
  });

  it('makes the first deletion final when another link is deleted @AC-reading-8', async () => {
    const storage = seeded(listBody('default'));
    const { user } = renderList(createLocalRepository(() => storage));
    await rows();

    await user.click(screen.getByRole('button', { name: `Delete: ${FIRST}` }));
    await user.click(screen.getByRole('button', { name: `Delete: ${SECOND}` }));

    await waitFor(() => expect(storedTitles(storage)).not.toContain(FIRST));
    expect(storedTitles(storage)).toContain(SECOND);
    expect(screen.getByRole('status')).toHaveTextContent(SECOND);
    expect(await titles()).toEqual(['example.net']);
  });
});
