// Map a raw ?error= code/message coming from /auth/callback (e.g. an expired or
// already-used PKCE code) into a clear, user-facing Hebrew message. The login
// page renders the result so a failed email-confirmation / password-recovery
// link shows an explanation instead of a silent bounce to a blank login page.
export function friendlyAuthError(raw: string): string {
  const v = raw.toLowerCase();
  if (v === 'missing_code') return 'הקישור אינו תקין. בקש קישור חדש.';
  if (v.includes('expired') || v.includes('invalid') || v.includes('code'))
    return 'הקישור פג תוקף או שכבר נעשה בו שימוש. בקש קישור חדש.';
  return raw;
}
