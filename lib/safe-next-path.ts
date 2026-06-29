// Sanitize a `next` redirect target so it can only point at a local path.
// Accepts a single-leading-slash absolute path (e.g. `/reset-password`,
// `/a/b?x=1`); rejects protocol-relative (`//evil.com`), backslash tricks
// (`/\evil.com`), absolute URLs with a scheme, and anything else by falling
// back to `/`. Pure and unit-testable; used by the auth callback route to
// prevent open redirects after authentication.
export function safeNextPath(next: string | null): string {
  if (!next) return '/';
  // Must be a local absolute path: exactly one leading slash.
  if (!next.startsWith('/')) return '/';
  // Reject protocol-relative (`//host`) and backslash variants (`/\host`).
  if (next.startsWith('//') || next.startsWith('/\\')) return '/';
  // Reject anything carrying a URL scheme (e.g. `/javascript:...`).
  if (/^\/[^/]*:/.test(next)) return '/';
  return next;
}
