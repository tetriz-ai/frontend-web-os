// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type Access, canSee } from '@/shared/access';
import ia from '../../../../../docs/app/ia.json';

interface IaPage {
  id: string;
  title: string;
  route?: string;
  kind: string;
  order?: number;
  visibleTo?: string[];
  flag?: string;
}

// The nav is read from docs/app/ia.json, so it can't drift from the IA, and it shows a page only to
// the roles and flag setting ia.json gives it (the same rule guardPage applies to the page itself).
export function Nav({ access }: { access: Access }) {
  const pathname = usePathname();
  const pages = (ia.pages as IaPage[])
    .filter((p) => p.kind === 'nav' && p.route && canSee(p, access))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (pages.length < 2) return null;
  return (
    <nav aria-label="Main">
      <ul className="flex flex-wrap gap-1">
        {pages.map((p) => (
          <li key={p.id}>
            <Link
              href={p.route!}
              aria-current={pathname === p.route ? 'page' : undefined}
              className="inline-flex min-h-9 items-center rounded-md px-3 text-label text-fg-secondary hover:bg-hover aria-[current=page]:bg-selected aria-[current=page]:text-fg"
            >
              {p.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
