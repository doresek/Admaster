'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { Btn, Alert } from '@/components/ui';
import { useActiveClient } from '@/components/ClientProvider';

// Minimal per-client "Connect Facebook" entry point. Sends the browser to the
// OAuth authorize route, which redirects on to Facebook Login. On return, the
// callback bounces back here with a ?meta=<status> flag that we surface inline.
//
// Optional prop `clientId` overrides the app-wide active client (e.g. to place
// the button on a specific client's card); otherwise we fall back to the active
// client from the ClientProvider context — the single source of truth.
export default function ConnectFacebookButton({ clientId: clientIdProp }: { clientId?: string }) {
  const { activeClientId } = useActiveClient();
  const clientId = clientIdProp ?? activeClientId ?? null;
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
