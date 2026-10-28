export interface HeroBannerProps {
  headline: string;
  action: { label: string; href: string };
  /** A muted harbour film behind the headline; a still surface without it. */
  video?: string;
}

/** The headline and the one call to action. */
export function HeroBanner({ headline, action, video }: HeroBannerProps) {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden rounded-lg bg-surface-elevated p-10">
      {video ? <video src={video} autoPlay muted loop playsInline aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-40" /> : null}
      <h1 id="hero-title" className="relative text-display text-fg">
        {headline}
      </h1>
      <a href={action.href} className="relative mt-6 inline-flex rounded-md bg-brand px-5 text-label text-on-brand hover:bg-brand-hover">
        {action.label}
      </a>
    </section>
  );
}
