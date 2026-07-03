// ════════════════════════════════════════════
// URL sanitizers — defense against stored-XSS via user/AI-controlled
// URL fields that land in href/src attributes on public landing pages.
//
// React escaping does NOT protect attribute values from `javascript:`,
// `data:text/html`, or protocol-relative (`//evil`) URLs. These helpers
// parse defensively and reject anything outside a strict allow-list.
// ════════════════════════════════════════════

// Schemes we allow for plain links (CTA hrefs).
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

// Hosts we allow to be embedded in an <iframe> (video providers only).
const EMBED_HOST_ALLOWLIST = new Set([
  'www.youtube.com',
  'youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'vimeo.com',
  'www.vimeo.com',
]);

/**
 * Return `u` only if it parses to a safe link scheme
 * (`http:`/`https:`/`mailto:`/`tel:`), else `'#'`.
 *
 * Rejects `javascript:`, `data:`, protocol-relative (`//evil`), and
 * whitespace/case tricks (e.g. `\tjavascript:`). Never throws.
 */
export function safeExternalUrl(u: unknown): string {
  if (typeof u !== 'string') return '#';
  const raw = u.trim();
  if (!raw) return '#';

  // Reject protocol-relative URLs outright — `new URL('//evil.com')` throws
  // without a base, but be explicit so intent is clear.
  if (raw.startsWith('//')) return '#';

  try {
    const parsed = new URL(raw);
    if (SAFE_LINK_SCHEMES.has(parsed.protocol)) return parsed.href;
    return '#';
  } catch {
    return '#';
  }
}

/**
 * Return `u` only if it is an `https:` URL whose host is in the embed
 * allow-list (YouTube / Vimeo), else `null`.
 *
 * Used to gate <iframe src>. Rejects http:, data:, other origins, and
 * whitespace/case tricks. Never throws.
 */
export function safeEmbedUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  const raw = u.trim();
  if (!raw) return null;

  if (raw.startsWith('//')) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return null;
    if (!EMBED_HOST_ALLOWLIST.has(parsed.host.toLowerCase())) return null;
    return parsed.href;
  } catch {
    return null;
  }
}
