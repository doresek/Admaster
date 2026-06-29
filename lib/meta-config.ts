// ════════════════════════════════════════════
// Central, env-driven Meta Graph / OAuth configuration.
//
// This is the single source of truth for the Graph API version, the OAuth
// scopes we request, and the redirect URI. The new OAuth routes use it.
//
// FOLLOW-UP (not done here, intentionally): there are still ~6 hardcoded
// `const GRAPH = 'https://graph.facebook.com/v19.0'` callsites that predate
// this module and should be migrated to import META_GRAPH_BASE from here:
//   app/api/meta/clients/route.ts
//   app/api/meta/route.ts
//   app/api/analytics/route.ts
//   app/api/competitor/route.ts
//   app/api/pixel/route.ts
//   app/api/schedule/route.ts
// (and ~9 more on feat/meta-ads-launcher). Left untouched so this branch stays
// scoped to the OAuth connect flow and easy to review.
// ════════════════════════════════════════════

// Graph API version. Defaults to a current, supported version; override per
// environment with META_GRAPH_VERSION (e.g. "v21.0"). The legacy hardcoded
// callsites still pin v19.0 — see the follow-up note above.
export const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || 'v21.0').trim();

export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

// The OAuth dialog lives on www.facebook.com (versioned), not graph.facebook.com.
export const META_OAUTH_DIALOG = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;

// Permissions requested when a marketer connects a client's Meta account.
// pages_show_list + pages_read_engagement → list/read the client's Pages.
// ads_read + ads_management → read insights and create/manage campaigns.
// business_management → required for the System-User / Business-Login path.
export const META_OAUTH_SCOPES = [
  'ads_management',
  'ads_read',
  'pages_read_engagement',
  'pages_show_list',
  'business_management',
] as const;

export const META_APP_ID = process.env.META_APP_ID || '';
export const META_APP_SECRET = process.env.META_APP_SECRET || '';

// Optional: a Facebook Login *for Business* configuration id. When set, the
// authorize URL uses Business Login (config_id) instead of classic scopes,
// and the long-lived token Meta returns is a business System-User token.
// Leave UNSET in dev to use classic scope-based login, which works with a
// Tester account. See the callback route for the full explanation.
export const META_LOGIN_CONFIG_ID = process.env.META_LOGIN_CONFIG_ID || '';

// The redirect URI MUST byte-for-byte match a "Valid OAuth Redirect URI"
// registered on the Meta app, AND must be identical between the authorize
// redirect and the code→token exchange.
//
//  • 'dashboard' (default) — the authenticated per-client connect; callback at
//    /api/meta/oauth/callback. Override with META_OAUTH_REDIRECT_URI.
//  • 'connect' — the session-less client-connect link; callback at
//    /api/meta/connect/callback. Override with META_CONNECT_REDIRECT_URI.
//
// Both are distinct registered URIs because Meta routes back to whichever one
// was sent. The default origin is shared so only the path differs.
export function metaRedirectUri(variant: 'dashboard' | 'connect' = 'dashboard'): string {
  if (variant === 'connect') {
    const fromEnv = process.env.META_CONNECT_REDIRECT_URI?.trim();
    if (fromEnv) return fromEnv;
    return 'https://admaster-three.vercel.app/api/meta/connect/callback';
  }
  const fromEnv = process.env.META_OAUTH_REDIRECT_URI?.trim();
  if (fromEnv) return fromEnv;
  return 'https://admaster-three.vercel.app/api/meta/oauth/callback';
}

// Throws a clear error if the app credentials needed for token exchange are
// missing — surfaced to the user instead of an opaque Graph error.
export function assertMetaAppConfigured(): void {
  if (!META_APP_ID || !META_APP_SECRET) {
    throw new Error(
      'Meta App is not configured: set META_APP_ID and META_APP_SECRET in the environment.',
    );
  }
}
