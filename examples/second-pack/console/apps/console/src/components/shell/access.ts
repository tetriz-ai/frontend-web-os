export type Role = 'harbormaster' | 'pilot' | 'auditor';

export interface Session {
  role: Role;
  flags: string[];
}

/** Who sees a page, by the rules docs/product/ia.json states. The pages check it too. */
export function canSee(route: string, s: Session): boolean {
  if (route === '/forecast') return s.flags.includes('tide-forecast');
  if (route === '/auctions') return s.role === 'harbormaster' && s.flags.includes('berth-auctions');
  if (route === '/audit') return s.role === 'harbormaster' || s.role === 'auditor';
  return true;
}
