import { notFound } from 'next/navigation';
import { post } from '@/lib/content';

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const found = post((await params).slug);
  if (!found) notFound();
  return (
    <article>
      <h1 className="text-title text-fg">{found.title}</h1>
      <p className="text-body text-fg-secondary">{found.summary}</p>
    </article>
  );
}
