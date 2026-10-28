'use client';

import { useState } from 'react';
import { type PaletteItem, Results } from './results';

export type { PaletteItem } from './results';

export interface CommandPaletteProps {
  items: PaletteItem[];
  open: boolean;
  onClose: () => void;
  onPick: (target: string) => void;
}

/** Jump to a berth, vessel or voyage by typing. */
export function CommandPalette({ items, open, onClose, onPick }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  if (!open) return null;
  const q = query.trim().toLowerCase();
  const hits = items.filter((i) => i.label.toLowerCase().includes(q));
  return (
    <div role="dialog" aria-modal="true" aria-label="Jump to" className="rounded-lg border border-border bg-surface-elevated p-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        aria-label="Berth, vessel or voyage"
        className="w-full rounded-md bg-surface-subtle px-2 text-body text-fg"
      />
      <Results hits={hits} onPick={onPick} />
    </div>
  );
}
