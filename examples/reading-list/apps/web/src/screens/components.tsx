'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert, Button, Card, EmptyState, StateHandler, TextField } from '@/shared/ui';

/**
 * Component id (from design-system/components.json) -> each of its required states, drawn on its
 * own. The screens browser shows them at /fwos-screens/components/<id>?state=<state>, and fwos's
 * state harness checks each renders as its state's contract says (fwos check
 * design-system/required-states). Add a component's states here when you register it.
 */
export const componentStates: Record<string, Record<string, () => ReactNode>> = {
  button: {
    default: () => <Button>Save</Button>,
    loading: () => <Button loading>Save</Button>,
    disabled: () => <Button disabled>Save</Button>,
  },
  'text-field': {
    default: () => <TextField label="Link" hint="Starts with https://" />,
    invalid: () => <TextField label="Link" error="That isn't a web address." />,
    disabled: () => <TextField label="Link" disabled />,
  },
  card: {
    default: () => <Card>A card groups related content.</Card>,
  },
  alert: {
    critical: () => (
      <Alert tone="critical" title="Couldn't save" action={<Button variant="secondary">Try again</Button>}>
        The network dropped.
      </Alert>
    ),
    info: () => <Alert tone="info" title="Saved offline" />,
  },
  'empty-state': {
    zero: () => <EmptyState kind="zero" title="Nothing saved yet" action={<Button>Save your first link</Button>} />,
    filtered: () => <EmptyState kind="filtered" title="No matches" action={<Button variant="secondary">Clear filters</Button>} />,
  },
  'state-handler': {
    loading: () => <StateHandler status="loading" label="links" />,
    empty: () => <StateHandler status="empty" label="links" />,
    error: () => <StateHandler status="error" label="links" error={{ message: 'The server timed out.', onRetry: () => {} }} />,
    ready: () => (
      <StateHandler status="ready" label="links">
        <ul className="flex flex-col gap-2">
          <li className="text-body text-fg">The first saved link</li>
          <li className="text-body text-fg">The second saved link</li>
        </ul>
      </StateHandler>
    ),
  },
};

/** One component in one state, in the container fwos's state harness reads. */
export function ComponentFixture({ id, state }: { id: string; state: string }) {
  const draw = componentStates[id]?.[state];
  const states = Object.keys(componentStates[id] ?? {});
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="States" className="flex flex-wrap items-center gap-2">
        <Link href="/fwos-screens" className="text-label text-fg-muted underline">
          All screens
        </Link>
        {states.map((s) => (
          <Link
            key={s}
            href={`/fwos-screens/components/${id}?state=${s}`}
            aria-current={s === state ? 'page' : undefined}
            className="rounded-full border border-border px-3 py-1 text-label text-fg aria-[current=page]:bg-selected"
          >
            {s}
          </Link>
        ))}
      </nav>
      {draw ? (
        <div data-fwos-fixture={`component:${id}`} data-fwos-state={state}>
          {draw()}
        </div>
      ) : (
        <div data-fwos-fixture={`component:${id}`} data-fwos-state={state} data-fwos-missing="">
          <EmptyState kind="zero" title={`${id} has no "${state}" fixture yet`}>
            Add it to src/screens/components.tsx.
          </EmptyState>
        </div>
      )}
    </section>
  );
}

/** Every component with fixtures, and its states, for the screens browser's index. */
export function ComponentFixtureIndex() {
  return (
    <ul className="flex flex-col gap-4">
      {Object.entries(componentStates).map(([id, states]) => (
        <li key={id} className="rounded-lg border border-border bg-surface-elevated p-4">
          <p className="text-heading text-fg">{id}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {Object.keys(states).map((state) => (
              <li key={state}>
                <Link className="text-label text-brand underline" href={`/fwos-screens/components/${id}?state=${state}`}>
                  {state}
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
