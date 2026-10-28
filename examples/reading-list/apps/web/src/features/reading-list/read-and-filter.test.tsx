import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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

// Slice S2, read state and the filter: TC-reading-14, 16 and 18. The filter arrives as the page's
// `show` value (from the address, /?show=unread); the URL itself is proven end to end.

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

const listBody = (variant: 'default' | 'many') => fixtures.listItems![variant]!.body as Item[];

function seeded(items: Item[]): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem(READING_LIST_STORAGE_KEY, JSON.stringify(items));
  return storage;
}

const stored = (storage: MemoryStorage): Item[] => JSON.parse(storage.getItem(READING_LIST_STORAGE_KEY) ?? '[]') as Item[];

function renderList(repository: ReadingListRepository, show?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ReadingListPage repository={repository} show={show} />
    </QueryClientProvider>,
  );
  return { user };
}

const rows = async () => within(await screen.findByRole('list', { name: 'Saved links' })).getAllByRole('listitem');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('read state', () => {
  it('marks a link read, then unread @AC-reading-5', async () => {
    const storage = seeded(listBody('default'));
    const { user } = renderList(createLocalRepository(() => storage));
    const title = 'The case for slow reading';
    const row = (await rows()).find((r) => within(r).queryByRole('link', { name: new RegExp(title) }))!;
    expect(within(row).queryByText('Read')).not.toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: `Mark as read: ${title}` }));
    expect(await within(row).findByText('Read')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: `Mark as unread: ${title}` })).toBeInTheDocument();
    await waitFor(() => expect(stored(storage).find((i) => i.title === title)!.read).toBe(true));

    await user.click(within(row).getByRole('button', { name: `Mark as unread: ${title}` }));
    await waitFor(() => expect(within(row).queryByText('Read')).not.toBeInTheDocument());
    expect(within(row).getByRole('button', { name: `Mark as read: ${title}` })).toBeInTheDocument();
    await waitFor(() => expect(stored(storage).find((i) => i.title === title)!.read).toBe(false));
  });
});

describe('the filter', () => {
  it.each([
    ['unread', 'Unread', 'unread', 5],
    ['read', 'Read', 'read', 3],
    ['an unknown value', 'All', 'everything', 8],
    ['no value', 'All', undefined, 8],
  ] as const)('with %s, marks %s current and shows the matching rows newest first @AC-reading-6 @state:list:ready', async (_label, current, show, count) => {
    const many = listBody('many');
    renderList(createLocalRepository(() => seeded([...many].reverse())), show);

    const items = await rows();
    expect(items).toHaveLength(count);
    const expected = many.filter((i) => (show === 'unread' ? !i.read : show === 'read' ? i.read : true)).map((i) => i.url);
    expect(items.map((r) => within(r).getByRole('link').getAttribute('href'))).toEqual(expected);

    const filter = screen.getByRole('navigation', { name: 'Filter links' });
    expect(within(filter).getByRole('link', { name: current })).toHaveAttribute('aria-current', 'page');
    expect(within(filter).getByRole('link', { name: 'All' })).toHaveAttribute('href', '/');
    expect(within(filter).getByRole('link', { name: 'Unread' })).toHaveAttribute('href', '/?show=unread');
    expect(within(filter).getByRole('link', { name: 'Read' })).toHaveAttribute('href', '/?show=read');
  });

  it('offers Show all when the filter hides every link @AC-reading-7 @state:list:filtered-empty', async () => {
    renderList(createLocalRepository(() => seeded(listBody('default'))), 'read');

    expect(await screen.findByText('No read links')).toBeInTheDocument();
    expect(screen.getByText(/hiding all 3 saved links/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('navigation', { name: 'Filter links' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Saved links' })).not.toBeInTheDocument();
  });
});
