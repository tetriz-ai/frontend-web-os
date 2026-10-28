export interface PaletteItem {
  label: string;
  target: string;
}

export function Results({ hits, onPick }: { hits: PaletteItem[]; onPick: (target: string) => void }) {
  if (hits.length === 0) return <p className="p-2 text-body text-fg-muted">Nothing matches. Try a berth number or an IMO number.</p>;
  return (
    <ul>
      {hits.map((h) => (
        <li key={h.target}>
          <button type="button" className="w-full rounded-sm px-2 text-left text-body text-fg hover:bg-hover" onClick={() => onPick(h.target)}>
            {h.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
