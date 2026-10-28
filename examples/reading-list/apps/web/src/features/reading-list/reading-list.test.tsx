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

// Slice S1, save and list: TC-reading-1, 3, 5, 6, 8, 9, 10 and 11. The list page runs against the
// real local repository over an in-memory store seeded with the contract's fixture bodies (the
// consumer side of the seam); only the storage underneath is fake.

class MemoryStorage {
  private data = new Map<string, string>();
  writes = 0;
  failWrites = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.writes++;
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const listBody = (variant: 'default' | 'empty' | 'many') => fixtures.listItems![variant]!.body as Item[];
const unavailable = (fixtures.listItems!.unavailable!.body as { message: string }).message;
const EMPTY = 'Enter the link you want to save.';
const INVALID = 'Enter a web address that starts with http:// or https://.';

function seeded(items: Item[]): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem(READING_LIST_STORAGE_KEY, JSON.stringify(items));
  storage.writes = 0;
  return storage;
}

const stored = (storage: MemoryStorage): Item[] => JSON.parse(storage.getItem(READING_LIST_STORAGE_KEY) ?? '[]') as Item[];

function renderList(repository: ReadingListRepository) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ReadingListPage repository={repository} />
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

describe('saving a link', () => {
  it('puts a link saved with a title first and resets the form @AC-reading-1', async () => {
    const storage = seeded(listBody('empty'));
    const { user } = renderList(createLocalRepository(() => storage));
    await screen.findByText('Save your first link');

    await user.type(screen.getByLabelText('Link'), 'https://example.com/articles/slow-reading');
    await user.type(screen.getByLabelText('Title (optional)'), 'The case for slow reading');
    await user.click(screen.getByRole('button', { name: 'Save link' }));

    const [first] = await rows();
    const link = within(first!).getByRole('link', { name: /The case for slow reading/ });
    expect(link).toHaveAttribute('href', 'https://example.com/articles/slow-reading');
    expect(first).toHaveTextContent('example.com');
    expect(first).toHaveTextContent('Saved now');
    expect(screen.getByLabelText('Link')).toHaveValue('');
    expect(screen.getByLabelText('Title (optional)')).toHaveValue('');
    expect(screen.getByLabelText('Link')).toHaveFocus();
    expect(stored(storage)).toHaveLength(1);
  });

  it('names a link saved with a blank title after its hostname @AC-reading-2', async () => {
    const storage = seeded(listBody('empty'));
    const { user } = renderList(createLocalRepository(() => storage));
    await screen.findByText('Save your first link');

    await user.type(screen.getByLabelText('Link'), 'https://blog.example.org/2026/09/notes-on-focus');
    await user.type(screen.getByLabelText('Title (optional)'), '   ');
    await user.click(screen.getByRole('button', { name: 'Save link' }));

    const [first] = await rows();
    expect(within(first!).getByRole('link', { name: /^blog\.example\.org/ })).toHaveAttribute(
      'href',
      'https://blog.example.org/2026/09/notes-on-focus',
    );
    expect(stored(storage)[0]).toMatchObject({ title: 'blog.example.org' });
  });

  it('checks the link on blur and on save, and clears the message once it is fixed @AC-reading-3', async () => {
    const storage = seeded(listBody('empty'));
    const { user } = renderList(createLocalRepository(() => storage));
    await screen.findByText('Save your first link');
    const link = screen.getByLabelText('Link');

    await user.type(link, 'example.com/page');
    expect(link).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(INVALID)).not.toBeInTheDocument();

    await user.tab();
    expect(link).toHaveAttribute('aria-invalid', 'true');
    expect(link).toHaveAccessibleDescription(INVALID);

    await user.clear(link);
    await user.type(link, 'https://example.com/page');
    expect(link).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(INVALID)).not.toBeInTheDocument();

    await user.clear(link);
    await user.click(screen.getByRole('button', { name: 'Save link' }));
    expect(link).toHaveAccessibleDescription(EMPTY);
    expect(link).toHaveFocus();
    expect(storage.writes).toBe(0);
    expect(screen.queryByRole('list', { name: 'Saved links' })).not.toBeInTheDocument();
  });
});

describe('the list', () => {
  it('shows rows newest first with title, hostname and saved date @AC-reading-4 @state:list:ready', async () => {
    const many = listBody('many');
    const storage = seeded([...many].reverse());
    renderList(createLocalRepository(() => storage));

    const items = await rows();
    expect(items).toHaveLength(8);
    expect(items.map((row) => within(row).getByRole('link').getAttribute('href'))).toEqual(many.map((i) => i.url));

    const firstLink = within(items[0]!).getByRole('link');
    expect(firstLink).toHaveAccessibleName(`${many[0]!.title} (opens in a new tab)`);
    expect(firstLink).toHaveAttribute('target', '_blank');
    expect(firstLink).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(items[0]).toHaveTextContent('news.example.com');

    expect(within(items[0]!).getByText('Saved 2 minutes ago')).toHaveAttribute('title', 'October 7, 2026');
    expect(within(items[2]!).getByText('Saved 3 days ago')).toHaveAttribute('title', 'October 4, 2026');
    expect(within(items[4]!).getByText('Saved Sep 28, 2026')).toHaveAttribute('title', 'September 28, 2026');
    expect(within(items[7]!).getByText('Saved Mar 12, 2026')).toHaveAttribute('title', 'March 12, 2026');
  });

  it('shows a skeleton on the first load only @AC-reading-4 @state:list:loading', async () => {
    const storage = seeded(listBody('default'));
    const local = createLocalRepository(() => storage);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository: ReadingListRepository = {
      listItems: async () => {
        await gate;
        return local.listItems();
      },
      createItem: (input) => local.createItem(input),
      updateItem: (id, patch) => local.updateItem(id, patch),
      deleteItem: (id) => local.deleteItem(id),
    };
    const { user } = renderList(repository);

    expect(screen.getByLabelText('Loading your reading list')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('list', { name: 'Saved links' })).not.toBeInTheDocument();

    release();
    expect(await rows()).toHaveLength(3);

    await user.type(screen.getByLabelText('Link'), 'https://example.com/articles/reading-lists');
    await user.click(screen.getByRole('button', { name: 'Save link' }));
    expect(screen.queryByLabelText('Loading your reading list')).not.toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Saved links' })).getAllByRole('listitem')).toHaveLength(4));
    expect(screen.queryByLabelText('Loading your reading list')).not.toBeInTheDocument();
    expect(within((await rows())[0]!).getByRole('link')).toHaveAttribute('href', 'https://example.com/articles/reading-lists');
  });

  it('explains how to start when nothing is saved @AC-reading-9 @state:list:empty', async () => {
    const storage = seeded(listBody('empty'));
    const { user } = renderList(createLocalRepository(() => storage));

    expect(await screen.findByText('Save your first link')).toBeInTheDocument();
    expect(screen.getByText(/stay in this browser/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Filter links' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add a link' }));
    expect(screen.getByLabelText('Link')).toHaveFocus();
  });
});

describe('when the browser blocks storage', () => {
  it('shows the reason, and Try again recovers @AC-reading-10 @state:list:error', async () => {
    const storage = seeded(listBody('default'));
    let blocked = true;
    const { user } = renderList(
      createLocalRepository(() => {
        if (blocked) throw new DOMException('The operation is insecure.', 'SecurityError');
        return storage;
      }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your reading list");
    expect(alert).toHaveTextContent(unavailable);

    blocked = false;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await rows()).toHaveLength(3);
  });

  it('keeps what I typed when a save fails, and says why @AC-reading-10', async () => {
    const storage = seeded(listBody('default'));
    storage.failWrites = true;
    const { user } = renderList(createLocalRepository(() => storage));
    expect(await rows()).toHaveLength(3);

    await user.type(screen.getByLabelText('Link'), 'https://example.com/articles/reading-lists');
    await user.type(screen.getByLabelText('Title (optional)'), 'Reading lists');
    await user.click(screen.getByRole('button', { name: 'Save link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(unavailable);
    expect(screen.getByLabelText('Link')).toHaveValue('https://example.com/articles/reading-lists');
    expect(screen.getByLabelText('Title (optional)')).toHaveValue('Reading lists');
    expect(await rows()).toHaveLength(3);
  });
});
