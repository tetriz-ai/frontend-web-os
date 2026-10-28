export interface VesselChipProps {
  name: string;
  imo: string;
  selected?: boolean;
  onSelect?: () => void;
}

/** A vessel by name, then its IMO number in brackets, as the voice file says. */
export function VesselChip({ name, imo, selected = false, onSelect }: VesselChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={selected ? 'rounded-full bg-selected px-3 text-label text-fg' : 'rounded-full bg-surface-subtle px-3 text-label text-fg-secondary hover:bg-hover'}
    >
      {name} <span className="font-mono text-fg-muted">(IMO {imo})</span>
    </button>
  );
}
