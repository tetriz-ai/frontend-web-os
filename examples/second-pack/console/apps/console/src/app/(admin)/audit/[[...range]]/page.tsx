import { notFound } from 'next/navigation';
import { canSee } from '@/components/shell';
import { AuditLog } from '@/features/audit';
import { currentSession } from '@/lib/api/client';

export default async function AuditPage({ params }: { params: Promise<{ range?: string[] }> }) {
  if (!canSee('/audit', await currentSession())) notFound();
  const { range = [] } = await params;
  return (
    <section aria-labelledby="audit-title">
      <h1 id="audit-title" className="text-title">
        Audit trail{range.length > 0 ? `: ${range.join(' to ')}` : ''}
      </h1>
      <AuditLog entries={[]} />
    </section>
  );
}
