// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { screens, screensEnabled } from '@/screens';
import { EmptyState } from '@/shared/ui';
import ia from '../../../../../../docs/app/ia.json';

interface Props {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ state?: string }>;
}

// The app is a static export (D-7), so every dynamic route lists its params at build time.
export function generateStaticParams() {
  return ia.pages.map((p) => ({ pageId: p.id }));
}

// One screen with a state switcher: empty, loading, error, offline... whatever ia.json lists.
export default async function ScreenInState({ params, searchParams }: Props) {
  if (!screensEnabled()) notFound();
  const { pageId } = await params;
  const { state } = await searchParams;
  const page = ia.pages.find((p) => p.id === pageId);
  if (!page) notFound();
  const current = state && page.states.includes(state) ? state : page.states[0]!;
  const Screen = screens[page.id];
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="States" className="flex flex-wrap items-center gap-2">
        <Link href="/fwos-screens" className="text-label text-fg-muted underline">
          All screens
        </Link>
        {page.states.map((s) => (
          <Link
            key={s}
            href={`/fwos-screens/${page.id}?state=${s}`}
            aria-current={s === current ? 'page' : undefined}
            className="rounded-full border border-border px-3 py-1 text-label text-fg aria-[current=page]:bg-selected"
          >
            {s}
          </Link>
        ))}
      </nav>
      {Screen ? (
        <Screen state={current} />
      ) : (
        <EmptyState kind="zero" title={`${page.title} isn't built yet`}>
          Add it to src/screens/registry.tsx.
        </EmptyState>
      )}
    </section>
  );
}
