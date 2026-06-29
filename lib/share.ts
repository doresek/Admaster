// Helpers for building shareable brief magic-links + WhatsApp share links.
//
// IMPORTANT: links must point at the canonical production origin, never at a
// Vercel preview deployment URL. We therefore prefer NEXT_PUBLIC_APP_URL (set to
// https://admaster-pro.co.il in prod, inlined into the client bundle), and only
// fall back to the live browser origin, then the production domain.

export function getAppOrigin(): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'https://admaster-pro.co.il';
}

export function briefLink(token: string): string {
  return `${getAppOrigin()}/brief/${token}`;
}

// Session-less client-connect magic-link. The 64-hex token IS the authorization:
// an external client opens this to authorize THEIR OWN Meta account without ever
// logging into AdMaster. Like briefLink, it must point at the canonical
// production origin (NEXT_PUBLIC_APP_URL), never a Vercel preview URL.
export function connectLink(token: string): string {
  return `${getAppOrigin()}/connect/${token}`;
}

// Session-less client-facing ROI report link. Like briefLink/connectLink, the
// 64-hex token IS the authorization: a client opens this to view the immutable
// report snapshot the agency minted, without ever logging into AdMaster. Must
// point at the canonical production origin (NEXT_PUBLIC_APP_URL), not a preview.
export function reportLink(token: string): string {
  return `${getAppOrigin()}/report/${token}`;
}

// Pre-filled WhatsApp share. With a phone, normalizes IL numbers (0xx -> 972xx)
// and opens a chat with that contact; without one, opens the share sheet so the
// agency can pick the recipient.
export function whatsappShareLink(message: string, phone?: string | null): string {
  const text = encodeURIComponent(message);
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^0/, '972');
  return digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
}
