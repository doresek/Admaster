// ════════════════════════════════════════════
// Active Client — global selection persisted in cookie.
// Read on server (Next.js cookies()) and client (document.cookie).
// ════════════════════════════════════════════
export const ACTIVE_CLIENT_COOKIE = 'admaster_active_client';

export function readActiveClientCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|; )${ACTIVE_CLIENT_COOKIE}=([^;]+)`));
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  // UUID format only — never trust arbitrary strings
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return id;
}

export function readActiveClientFromDocument(): string | null {
  if (typeof document === 'undefined') return null;
  return readActiveClientCookie(document.cookie);
}

export function writeActiveClientCookie(id: string | null) {
  if (typeof document === 'undefined') return;
  if (!id) {
    document.cookie = `${ACTIVE_CLIENT_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } else {
    document.cookie = `${ACTIVE_CLIENT_COOKIE}=${id}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }
}
