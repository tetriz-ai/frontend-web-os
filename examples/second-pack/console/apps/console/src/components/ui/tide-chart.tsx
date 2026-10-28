export interface TidePoint {
  hour: number;
  metres: number;
}

export interface TideChartProps {
  label: string;
  points: TidePoint[];
  busy?: boolean;
  /** The gauge is down: show nothing rather than old readings. */
  offline?: boolean;
}

/** Tide height over the next 24 hours, as a line in the first chart slot. */
export function TideChart({ label, points, busy = false, offline = false }: TideChartProps) {
  if (offline) return <p role="status" className="text-body text-fg-secondary">Tide gauge offline. No readings to show.</p>;
  if (busy) return <div aria-busy="true" aria-label={label} className="h-40 rounded-lg bg-surface-subtle" />;
  const top = Math.max(1, ...points.map((p) => p.metres));
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.hour / 24) * 100} ${100 - (p.metres / top) * 100}`).join(' ');
  return (
    <figure>
      <svg role="img" aria-label={label} viewBox="0 0 100 100" preserveAspectRatio="none" className="h-40 w-full">
        <path d={d} fill="none" className="stroke-chart-1" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="text-caption text-fg-muted">{label}</figcaption>
    </figure>
  );
}
