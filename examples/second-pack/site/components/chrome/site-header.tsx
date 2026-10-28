import Link from 'next/link';

const LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/docs/getting-started', label: 'Docs' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/blog', label: 'Blog' },
];

export function SiteHeader() {
  return (
    <header className="flex items-center justify-between p-6">
      <Link href="/" className="text-heading text-fg">
        Tidewatch
      </Link>
      <nav aria-label="Site">
        <ul className="flex gap-6 text-label">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="text-fg-secondary hover:text-fg">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
