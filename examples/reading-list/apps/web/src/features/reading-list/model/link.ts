// The link rule: only http and https web addresses are saved (D-3, R-security-4).

export const LINK_EMPTY = 'Enter the link you want to save.';
export const LINK_INVALID = 'Enter a web address that starts with http:// or https://.';

export type LinkCheck = { ok: true; url: string } | { ok: false; message: string };

/** Checks what someone typed in the link field. Surrounding spaces are ignored. */
export function checkLink(raw: string): LinkCheck {
  const value = raw.trim();
  if (!value) return { ok: false, message: LINK_EMPTY };
  if (!/^https?:\/\//i.test(value)) return { ok: false, message: LINK_INVALID };
  try {
    const parsed = new URL(value);
    if (!parsed.hostname) return { ok: false, message: LINK_INVALID };
  } catch {
    return { ok: false, message: LINK_INVALID };
  }
  return { ok: true, url: value };
}

/** The hostname shown on each row, and the default title. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** A blank or spaces-only title becomes the link's hostname. */
export function titleFor(url: string, title: string | undefined): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : hostnameOf(url);
}
