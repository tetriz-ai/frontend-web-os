import { BerthBoard } from '@/features/berths';
import { listBerths } from '@/lib/api/client';

export default async function BerthsPage() {
  const { berths, stale } = await listBerths();
  return (
    <section aria-labelledby="berths-title">
      <h1 id="berths-title" className="text-title">
        Berths
      </h1>
      <BerthBoard berths={berths} stale={stale} />
    </section>
  );
}
