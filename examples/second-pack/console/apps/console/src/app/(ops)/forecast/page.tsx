import { notFound } from 'next/navigation';
import { canSee } from '@/components/shell';
import { TideChart } from '@/components/ui';
import { currentSession } from '@/lib/api/client';

export default async function ForecastPage() {
  if (!canSee('/forecast', await currentSession())) notFound();
  return (
    <section aria-labelledby="forecast-title">
      <h1 id="forecast-title" className="text-title">
        Tide forecast
      </h1>
      <TideChart label="Forecast tide height" points={[]} offline />
    </section>
  );
}
