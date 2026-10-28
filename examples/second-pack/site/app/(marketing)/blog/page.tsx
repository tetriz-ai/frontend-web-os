import Link from 'next/link';
import { posts } from '@/lib/content';

export default function BlogPage() {
  const all = posts();
  if (all.length === 0) return <p className="text-body text-fg-muted">No posts yet.</p>;
  return (
    <ul className="grid gap-6">
      {all.map((p) => (
        <li key={p.slug}>
          <Link href={`/blog/${p.slug}`} className="text-heading text-fg hover:text-brand">
            {p.title}
          </Link>
          <p className="text-body text-fg-secondary">{p.summary}</p>
        </li>
      ))}
    </ul>
  );
}
