// Server-only helpers for talking to the Google Ads API.
// Do not import from client components — leaks GOOGLE_OAUTH_CLIENT_SECRET.

const TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const ADS_API_BASE = 'https://googleads.googleapis.com/v17';

export class GoogleAdsError extends Error {
  constructor(message: string, public status = 500, public detail?: unknown) {
    super(message);
  }
}

// Exchanges a stored refresh_token for a short-lived access_token (~1h).
export async function getAccessToken(refreshToken: string): Promise<string> {
  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleAdsError('Google OAuth env vars missing', 500);
  }

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    // invalid_grant => refresh_token was revoked or expired; surface so caller
    // can mark the connection row as 'revoked'.
    throw new GoogleAdsError(data.error ?? 'token_refresh_failed', res.status, data);
  }
  return data.access_token as string;
}

// Wrapper around the Google Ads REST API that injects auth headers.
// Path should start with '/', e.g. '/customers:listAccessibleCustomers'.
export async function googleAdsFetch<T = unknown>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    throw new GoogleAdsError('GOOGLE_ADS_DEVELOPER_TOKEN missing', 500);
  }

  const res = await fetch(`${ADS_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization:     `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type':    'application/json',
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new GoogleAdsError(
      (data as any)?.error?.message ?? 'google_ads_api_error',
      res.status,
      data,
    );
  }
  return data as T;
}

// listAccessibleCustomers returns resource names like 'customers/1234567890'.
// We expose just the numeric IDs to callers.
export async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const data = await googleAdsFetch<{ resourceNames?: string[] }>(
    '/customers:listAccessibleCustomers',
    accessToken,
  );
  return (data.resourceNames ?? []).map((r) => r.split('/')[1]).filter(Boolean);
}
