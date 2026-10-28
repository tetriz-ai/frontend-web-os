import { HeroBanner, LogoWall } from '@/components/ui';

const PORTS = [
  { name: 'Port of Haven', logo: '/ports/haven.svg' },
  { name: 'Northgate Terminal', logo: '/ports/northgate.svg' },
];

export default function HomePage() {
  return (
    <>
      <HeroBanner headline="Berths booked without a phone call." action={{ label: 'Book a demo', href: '/pricing' }} />
      <LogoWall ports={PORTS} />
    </>
  );
}
