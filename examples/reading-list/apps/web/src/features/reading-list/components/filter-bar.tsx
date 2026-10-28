import Link from 'next/link';
import { FILTERS, type Filter } from '../model/filter';

/** All / Unread / Read as links, so reload, Back and a shared link keep the view. */
export function FilterBar({ current }: { current: Filter }) {
  return (
    <nav aria-label="Filter links">
      <ul className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <li key={f.id}>
            <Link
              href={f.href}
              aria-current={f.id === current ? 'page' : undefined}
              className="inline-flex min-h-9 items-center rounded-md px-3 text-label text-fg-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-[current=page]:bg-selected aria-[current=page]:text-fg"
            >
              {f.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
