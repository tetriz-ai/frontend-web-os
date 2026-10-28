import { notFound } from 'next/navigation';
import { BerthDetail } from '@/features/berths';
import { listBerths } from '@/lib/api/client';

export default async function BerthPage({ params }: { params: Promise<{ berthId: string }> }) {
  const { berthId } = await params;
  const { berths } = await listBerths();
  const berth = berths.find((b) => b.id === berthId);
  if (!berth) notFound();
  return <BerthDetail berth={berth} />;
}
