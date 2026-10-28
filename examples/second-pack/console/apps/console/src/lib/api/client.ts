import type { Berth, Session, Voyage } from './types';

export type { Berth, Session, Voyage } from './types';

/** The port API client: the one place the console calls fetch (rules.yaml's no-direct-fetch keeps it so). */
const base = process.env.PORT_API_URL ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`port API ${path} answered ${res.status}`);
  return (await res.json()) as T;
}

export const listBerths = () => get<{ berths: Berth[]; stale: boolean }>('/berths');
export const getVoyage = (imo: string, voyageId: string) => get<Voyage>(`/vessels/${encodeURIComponent(imo)}/voyages/${encodeURIComponent(voyageId)}`);
export const currentSession = () => get<Session>('/session');
