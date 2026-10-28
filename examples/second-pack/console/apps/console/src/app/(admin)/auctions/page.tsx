import { notFound } from 'next/navigation';
import { canSee } from '@/components/shell';
import { currentSession } from '@/lib/api/client';

export default async function AuctionsPage() {
  if (!canSee('/auctions', await currentSession())) notFound();
  return (
    <section aria-labelledby="auctions-title">
      <h1 id="auctions-title" className="text-title">
        Berth auctions
      </h1>
      <p className="text-body text-fg-secondary">No auction is open. The next one opens when a berth frees up.</p>
    </section>
  );
}
