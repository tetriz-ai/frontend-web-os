import { ReadingListPage } from '@/features/reading-list';
import { guardPage } from '@/shared/session/session';

interface Props {
  searchParams: Promise<{ show?: string | string[] }>;
}

// "/" (page id "list" in docs/app/ia.json, which guardPage declares). Thin: it hands the address's
// filter to the feature, which picks local mode.
export default async function Home({ searchParams }: Props) {
  await guardPage('list');
  const { show } = await searchParams;
  return <ReadingListPage show={typeof show === 'string' ? show : undefined} />;
}
