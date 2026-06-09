'use client';
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Btn, Alert } from '@/components/ui';
import { readActiveClientFromDocument } from '@/lib/active-client';

// Minimal per-client "Connect Facebook" entry point. Reads the active client
// from the cookie and sends the browser to the OAuth authorize route, which
// redirects on to Facebook Login. On return, the callback bounces back here
// with a ?meta=<status> flag that we surface inline.
//
// Optional prop `clientId` overrides the active-client cookie (e.g. to place
// the button on a specific client's card).
export default function ConnectFacebookButton({ clientId: clientIdProp }: { clientId?: string }) {
  const [clientId, setClientId] = useState<string | null>(clientIdProp ?? null);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!clientIdProp) setClientId(readActiveClientFromDocument());
  }, [clientIdProp]);

  const status = searchParams?.get('meta'); // connected | cancelled | error
  const reason = searchParams?.get('reason');

  function connect() {
    if (!clientId) return;
    const returnTo = encodeURIComponent(pathname || '/clients');
    // Full-page navigation (not fetch) — the authorize route 302s to facebook.com.
    window.location.href =
      `/api/meta/oauth/authorize?clientId=${encodeURIComponent(clientId)}&returnTo=${returnTo}`;
  }

  return (
    <div>
      {status === 'connected' && (
        <Alert type="blue" className="mb-2">✅ חשבון ה-Meta חובר בהצלחה.</Alert>
      )}
      {status === 'cancelled' && (
        <Alert type="amber" className="mb-2">החיבור בוטל. אפשר לנסות שוב.</Alert>
      )}
      {status === 'error' && (
        <Alert type="red" className="mb-2">❌ החיבור נכשל{reason ? ` (${reason})` : ''}. נסה שוב.</Alert>
      )}

      <Btn variant="primary" onClick={connect} disabled={!clientId}>
        🔗 חבר חשבון Facebook
      </Btn>
      {!clientId && (
        <div className="text-[11px] text-[#6B8FA8] mt-1">בחר לקוח פעיל כדי לחבר את חשבון ה-Meta שלו.</div>
      )}
    </div>
  );
}
