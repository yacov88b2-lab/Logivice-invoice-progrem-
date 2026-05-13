const ALLOWED_DOMAIN = 'unilog.company';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowedEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex <= 0) return false;
  return normalized.slice(atIndex + 1) === ALLOWED_DOMAIN;
}

export function getDomain(email: string): string {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');
  return atIndex >= 0 ? normalized.slice(atIndex + 1) : '';
}

export function assertAllowedEmail(email: string): void {
  if (!isAllowedEmail(email)) {
    throw Object.assign(new Error(`Only @${ALLOWED_DOMAIN} email addresses are permitted`), { status: 403 });
  }
}
