import Link from 'next/link';
import { type Session, canSee } from './access';

const ITEMS = [
  { href: '/', label: 'Overview' },
  { href: '/berths', label: 'Berths' },
  { href: '/forecast', label: 'Tide forecast' },
  { href: '/auctions', label: 'Berth auctions' },
  { href: '/audit', label: 'Audit trail' },
];

/** The harbour nav: each item this session may see. */
export function HarborNav({ session }: { session: Session }) {
  return (
    <nav aria-label="Harbour">
      <ul className="flex gap-4 text-label">
        {ITEMS.filter((i) => canSee(i.href, session)).map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="rounded-sm text-fg-secondary hover:text-fg">
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
