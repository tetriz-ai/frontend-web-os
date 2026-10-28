import { getVoyage } from '@/lib/api/client';
import { formatPortTime } from '@/lib/readings';

export default async function VoyagePage({ params }: { params: Promise<{ imo: string; voyageId: string }> }) {
  const { imo, voyageId } = await params;
  const voyage = await getVoyage(imo, voyageId);
  const late = voyage.delayedMinutes > 0 ? `, ${voyage.delayedMinutes} minutes late` : '';
  return (
    <section aria-labelledby="voyage-title">
      <h1 id="voyage-title" className="text-title">
        {voyage.vesselName} (IMO {imo})
      </h1>
      <p className="text-body text-fg-secondary">
        Due {formatPortTime(voyage.eta)}
        {late}
      </p>
    </section>
  );
}
