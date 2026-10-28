'use client';

import { useState } from 'react';
import { PricingTable } from '@/components/ui';

const PLANS = [
  { id: 'quay', name: 'Quay', monthly: '€490 a month', yearly: '€4,900 a year' },
  { id: 'harbour', name: 'Harbour', monthly: '€1,290 a month', yearly: '€12,900 a year' },
];

export default function PricingPage() {
  const [state, setState] = useState<'idle' | 'quoting' | 'sent'>('idle');
  const quote = async () => {
    setState('quoting');
    const res = await fetch('/api/quote', { method: 'POST' });
    setState(res.ok ? 'sent' : 'idle');
  };
  return (
    <>
      <PricingTable plans={PLANS} onQuote={quote} quoting={state === 'quoting'} />
      {state === 'sent' ? (
        <p role="status" className="text-body text-success">
          Request sent. Your port&apos;s quote arrives within a working day.
        </p>
      ) : null}
    </>
  );
}
