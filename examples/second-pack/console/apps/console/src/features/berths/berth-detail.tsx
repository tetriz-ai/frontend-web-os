import type { Berth } from '@/lib/api/client';
import { formatMetres } from '@/lib/readings';

export function BerthDetail({ berth }: { berth: Berth }) {
  return (
    <section aria-labelledby="berth-title" className="rounded-lg bg-surface-elevated p-4">
      <h1 id="berth-title" className="text-title text-fg">
        {berth.name}
      </h1>
      <p className="text-body text-fg-secondary">Max draught {formatMetres(berth.maxDraught)}</p>
    </section>
  );
}
