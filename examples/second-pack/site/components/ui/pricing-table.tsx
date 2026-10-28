'use client';

import { useState } from 'react';

export interface Plan {
  id: string;
  name: string;
  /** Prices as the site shows them, already formatted. */
  monthly: string;
  yearly: string;
}

export interface PricingTableProps {
  plans: Plan[];
  onQuote: () => void;
  /** The quote request is on its way. */
  quoting?: boolean;
}

/** The plans, billed monthly or yearly, and the request for a port's own quote. */
export function PricingTable({ plans, onQuote, quoting = false }: PricingTableProps) {
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  return (
    <section aria-labelledby="plans-title">
      <h2 id="plans-title" className="text-heading text-fg">
        Plans
      </h2>
      <div role="group" aria-label="Billing period" className="flex gap-2">
        {(['monthly', 'yearly'] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={period === p}
            onClick={() => setPeriod(p)}
            className={period === p ? 'rounded-sm bg-selected px-3 text-label text-fg' : 'rounded-sm px-3 text-label text-fg-secondary'}
          >
            {p === 'monthly' ? 'Monthly' : 'Yearly'}
          </button>
        ))}
      </div>
      <ul className="grid gap-4">
        {plans.map((plan) => (
          <li key={plan.id} className="rounded-md border border-border p-4">
            <h3 className="text-subheading text-fg">{plan.name}</h3>
            <p className="font-mono text-body text-fg-secondary">{period === 'monthly' ? plan.monthly : plan.yearly}</p>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onQuote} disabled={quoting} aria-busy={quoting || undefined} className="rounded-md bg-accent px-5 text-label text-on-accent">
        {quoting ? 'Sending your request' : "Ask for your port's quote"}
      </button>
    </section>
  );
}
