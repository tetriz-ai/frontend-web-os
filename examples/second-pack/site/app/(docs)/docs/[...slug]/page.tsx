import Link from 'next/link';
import { docHtml } from '@/lib/content';

export default async function DocsPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const html = docHtml((await params).slug);
  if (html === null) {
    return (
      <p className="text-body text-fg-secondary">
        This page moved. Start from <Link href="/docs/getting-started" className="text-brand">Getting started</Link>.
      </p>
    );
  }
  // docHtml keeps only plain tags; rules.yaml lets this route, and only it, render HTML.
  return <article className="text-body text-fg" dangerouslySetInnerHTML={{ __html: html }} />;
}
