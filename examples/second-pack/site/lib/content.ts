/** Posts, releases and docs pages: the site's content, in one place. */
export interface Post {
  slug: string;
  title: string;
  summary: string;
}

export interface Release {
  version: string;
  notes: string[];
}

const POSTS: Post[] = [
  { slug: 'berths-without-phone-calls', title: 'Berths booked without a phone call', summary: 'How Port of Haven turned berths 18 minutes faster.' },
];

const RELEASES: Release[] = [{ version: '2026.10', notes: ['Berth auctions for harbourmasters', 'Tide forecast for every berth'] }];

const DOCS: Record<string, string> = {
  'getting-started': '<h1>Getting started</h1><p>Connect your berth feed, then invite your pilots.</p>',
};

export const posts = (): Post[] => POSTS;
export const post = (slug: string): Post | undefined => POSTS.find((p) => p.slug === slug);
export const releases = (from?: string): Release[] => (from ? RELEASES.filter((r) => r.version >= from) : RELEASES);

/**
 * One docs page's HTML with every tag but a few plain ones dropped: this example's stand-in for the
 * sanitiser a real docs build would run. The docs route renders what it returns, and only it.
 */
export function docHtml(slug: string[]): string | null {
  const html = DOCS[slug.join('/')];
  return html === undefined ? null : html.replace(/<(?!\/?(?:h1|h2|p|ul|li|code|pre)\b)[^>]*>/gi, '');
}
