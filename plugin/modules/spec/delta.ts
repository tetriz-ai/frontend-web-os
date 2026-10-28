// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// A change in an adopted app answers for its own criteria: those it adds, or changes, against the
// spec as it stood when the change began (recorded on the change as `base`). The criteria it
// carries were approved by the changes before it, and stay theirs.

import { hashText } from '../../kernel/index.ts';
import type { Change } from '../state/index.ts';
import { acTexts } from './acs.ts';

/** Each AC's ID with a hash of its text, as `fwos change new` records them for an adopted app's change. */
export function acHashes(spec: string): Record<string, string> {
  return Object.fromEntries(Object.entries(acTexts(spec)).map(([id, text]) => [id, hashText(text)]));
}

export interface AcDelta {
  /** In the spec now, not when the change began. */
  added: string[];
  /** In both, with other text now. */
  changed: string[];
  /** In both, as they were: approved by an earlier change. */
  carried: string[];
  /** There when the change began, gone now. */
  dropped: string[];
}

/** What the spec's criteria are to a change: its own (added, changed) and the rest. Null when the change recorded no base. */
export function acDelta(change: Pick<Change, 'base'>, spec: string): AcDelta | null {
  if (!change.base) return null;
  const was = change.base.acs;
  const now = acHashes(spec);
  const ids = Object.keys(now);
  return {
    added: ids.filter((id) => !(id in was)),
    changed: ids.filter((id) => id in was && was[id] !== now[id]),
    carried: ids.filter((id) => was[id] === now[id]),
    dropped: Object.keys(was).filter((id) => !(id in now)),
  };
}
