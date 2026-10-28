// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import Link from 'next/link';
import { EmptyState } from '@/shared/ui';

// A missing page, and a page this role or flag setting can't see, look the same. fwos's IA harness
// tells this page apart from a real one by data-fwos-not-found.
export default function NotFound() {
  return (
    <section data-fwos-not-found="" className="flex flex-col gap-4">
      <EmptyState kind="zero" title="There's no page here">
        <Link href="/" className="text-label text-brand underline">
          Go to the start
        </Link>
      </EmptyState>
    </section>
  );
}
