import ia from '../../../../../docs/app/ia.json';

/** Who is asking: a role from docs/app/ia.json, and the flags that are on. */
export interface Access {
  role: string;
  flags: string[];
}

interface IaPage {
  id: string;
  visibleTo?: string[];
  flag?: string;
}

/** The cookie fwos's IA harness sets to open the app as a role and flag setting (read only while FWOS_TEST_ACCESS=1). */
export const TEST_ACCESS_COOKIE = 'fwos-test-access';

/** Until sign-in and real flags exist, everyone has the first role and every flag is off. */
export const defaultAccess: Access = { role: ia.roles[0]!, flags: [] };

/** The page with that ID in docs/app/ia.json. */
export function pageById(id: string): IaPage | undefined {
  return (ia.pages as IaPage[]).find((p) => p.id === id);
}

/** Whether ia.json shows a page to `access`: its role is in visibleTo (or visibleTo is unset), and the page's flag, if it has one, is on. */
export function canSee(page: IaPage, access: Access): boolean {
  return (!page.visibleTo || page.visibleTo.includes(access.role)) && (!page.flag || access.flags.includes(page.flag));
}

/** The role and flags in the test cookie, or null when it doesn't name a role ia.json lists. */
export function parseTestAccess(value: string | undefined): Access | null {
  if (!value) return null;
  try {
    const asked = JSON.parse(decodeURIComponent(value)) as { role?: unknown; flags?: unknown };
    if (typeof asked.role !== 'string' || !ia.roles.includes(asked.role) || !Array.isArray(asked.flags)) return null;
    return { role: asked.role, flags: asked.flags.filter((f): f is string => typeof f === 'string') };
  } catch {
    return null;
  }
}
