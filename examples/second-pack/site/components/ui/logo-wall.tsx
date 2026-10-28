import Image from 'next/image';

export interface Port {
  name: string;
  logo: string;
}

/** The ports that run Tidewatch. It scrolls sideways only when the visitor allows motion. */
export function LogoWall({ ports, scrolling = false }: { ports: Port[]; scrolling?: boolean }) {
  return (
    <section aria-label="Ports on Tidewatch">
      <ul data-scrolling={scrolling || undefined} className={scrolling ? 'flex gap-8 overflow-x-auto motion-reduce:flex-wrap' : 'flex flex-wrap gap-8'}>
        {ports.map((p) => (
          <li key={p.name}>
            <Image src={p.logo} alt={p.name} width={120} height={40} />
          </li>
        ))}
      </ul>
    </section>
  );
}
