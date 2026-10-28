// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { Card } from '@/shared/ui';
import type { ScreenProps } from './registry';

/** The home page ("/") in its one state, ready. The page renders it, and so does the screens browser. */
export function HomeScreen(_props: ScreenProps) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-title text-fg">Welcome</h1>
      <Card>
        <p className="text-body text-fg-secondary">
          The walking skeleton is up: design tokens, module walls, tests and fwos check are wired. Screens arrive next.
        </p>
      </Card>
    </section>
  );
}
