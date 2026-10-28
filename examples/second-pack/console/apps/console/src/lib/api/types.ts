export interface Berth {
  id: string;
  name: string;
  maxDraught: number;
  /** When the next vessel is due, as an ISO time; absent when the berth is free. */
  arrival?: string;
  vessel?: { name: string; imo: string; voyageId: string };
}

export interface Voyage {
  vesselName: string;
  eta: string;
  delayedMinutes: number;
}

export interface Session {
  role: 'harbormaster' | 'pilot' | 'auditor';
  flags: string[];
}
