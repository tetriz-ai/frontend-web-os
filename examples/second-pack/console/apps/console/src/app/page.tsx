import { TideChart } from '@/components/ui';

export default function OverviewPage() {
  return (
    <section aria-labelledby="overview-title">
      <h1 id="overview-title" className="text-title">
        Port overview
      </h1>
      <TideChart label="Tide height, next 24 hours" points={[]} busy />
    </section>
  );
}
