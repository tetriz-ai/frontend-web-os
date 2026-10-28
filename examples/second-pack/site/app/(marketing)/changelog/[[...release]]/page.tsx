import { releases } from '@/lib/content';

export default async function ChangelogPage({ params }: { params: Promise<{ release?: string[] }> }) {
  const { release = [] } = await params;
  const shown = releases(release[0]);
  if (shown.length === 0) return <p className="text-body text-fg-muted">No releases yet.</p>;
  return (
    <ol className="grid gap-6">
      {shown.map((r) => (
        <li key={r.version}>
          <h2 className="text-heading text-fg">{r.version}</h2>
          <ul className="text-body text-fg-secondary">
            {r.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
