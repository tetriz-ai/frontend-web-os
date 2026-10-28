import type { ReactNode } from 'react';

export interface BerthRow {
  id: string;
  name: string;
  vessel: ReactNode;
  /** Already formatted in port time, so rows sort as text. */
  arrival: string;
  draught: string;
}

export interface BerthGridProps {
  rows: BerthRow[];
  sortedBy?: 'arrival';
  /** The berth feed is behind: say so above the rows instead of hiding them. */
  stale?: boolean;
  onOpen?: (id: string) => void;
}

/** Berths as rows: vessel, arrival, draught. */
export function BerthGrid({ rows, sortedBy, stale = false, onOpen }: BerthGridProps) {
  if (rows.length === 0) {
    return <p className="rounded-md bg-surface-subtle p-4 text-body text-fg-secondary">No berths are booked today.</p>;
  }
  const shown = sortedBy === 'arrival' ? [...rows].sort((a, b) => a.arrival.localeCompare(b.arrival)) : rows;
  return (
    <div>
      {stale ? (
        <p role="status" className="rounded-sm bg-warning-bg px-2 text-caption text-warning">
          Feed paused. These rows may be out of date; refresh to retry.
        </p>
      ) : null}
      <table className="w-full text-body text-fg">
        <thead className="text-label text-fg-muted">
          <tr>
            <th scope="col">Berth</th>
            <th scope="col">Vessel</th>
            <th scope="col">Arrival</th>
            <th scope="col">Draught</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} className="border-t border-border-faint">
              <td>
                <button type="button" className="rounded-sm text-brand hover:text-brand-hover" onClick={() => onOpen?.(r.id)}>
                  {r.name}
                </button>
              </td>
              <td>{r.vessel}</td>
              <td className="font-mono">{r.arrival}</td>
              <td className="font-mono">{r.draught}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
