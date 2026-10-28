import { formatPortTime } from '@/lib/readings';

export interface AuditEntry {
  id: string;
  at: string;
  who: string;
  what: string;
}

export function AuditLog({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <p className="text-body text-fg-muted">Nothing happened in this range.</p>;
  return (
    <ol className="text-body text-fg">
      {entries.map((e) => (
        <li key={e.id}>
          <span className="font-mono text-fg-muted">{formatPortTime(e.at)}</span> {e.who}: {e.what}
        </li>
      ))}
    </ol>
  );
}
