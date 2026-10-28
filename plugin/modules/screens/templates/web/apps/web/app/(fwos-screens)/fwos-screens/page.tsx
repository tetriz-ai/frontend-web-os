// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ComponentFixtureIndex, screens, screensEnabled } from '@/screens';
import ia from '../../../../../docs/app/ia.json';

// Dev-only: every screen from docs/app/ia.json, in every state, on fake data, then every registered
// component in each required state. The IA check leaves out /fwos-screens and the routes under it.
// It 404s in production unless FWOS_SCREENS=1 (the end-to-end tests set it for fwos's harness).
export default function ScreensIndex() {
  if (!screensEnabled()) notFound();
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-title text-fg">Screens</h1>
      <ul className="flex flex-col gap-4">
        {ia.pages.map((page) => (
          <li key={page.id} className="rounded-lg border border-border bg-surface-elevated p-4">
            <p className="text-heading text-fg">
              {page.title} <span className="text-caption text-fg-muted">{page.route ?? page.id}</span>
              {screens[page.id] ? null : <span className="text-caption text-fg-muted"> (not built yet)</span>}
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {page.states.map((state) => (
                <li key={state}>
                  <Link className="text-label text-brand underline" href={`/fwos-screens/${page.id}?state=${state}`}>
                    {state}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <h2 className="text-heading text-fg">Components</h2>
      <ComponentFixtureIndex />
    </section>
  );
}
