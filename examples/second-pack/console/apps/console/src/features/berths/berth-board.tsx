'use client';

import { useRouter } from 'next/navigation';
import { BerthGrid, VesselChip } from '@/components/ui';
import type { Berth } from '@/lib/api/client';
import { formatMetres, formatPortTime } from '@/lib/readings';

/** Today's berths, sorted by arrival. A vessel opens its voyage, a berth its detail. */
export function BerthBoard({ berths, stale }: { berths: Berth[]; stale: boolean }) {
  const router = useRouter();
  const rows = berths.map((b) => ({
    id: b.id,
    name: b.name,
    vessel: b.vessel ? (
      <VesselChip name={b.vessel.name} imo={b.vessel.imo} onSelect={() => router.push(`/vessels/${b.vessel!.imo}/voyages/${b.vessel!.voyageId}`)} />
    ) : (
      'Free'
    ),
    arrival: b.arrival ? formatPortTime(b.arrival) : '',
    draught: formatMetres(b.maxDraught),
  }));
  return <BerthGrid rows={rows} sortedBy="arrival" stale={stale} onOpen={(id) => router.push(`/berths/${id}`)} />;
}
