// Public, session-less client-connect page. No auth — the 64-hex token IS the
// authorization. An external client lands here and authorizes THEIR OWN Meta
// account; the credential is written to meta_connections by the service role.
// Mirrors the brief magic-link page (app/brief/[token]/page.tsx).
import { createAdminClient } from '@/lib/supabase/server';
import {
  CONNECT_TOKEN_REGEX,
  lookupConnectClient,
  connectLinkState,
} from '@/lib/meta-connect';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ConnectTokenPage({
  params,
}: {
  params: { token: string };
}) {
  // Cheap rejection of malformed tokens — saves a DB roundtrip on bot traffic.
  if (!CONNECT_TOKEN_REGEX.test(params.token)) {
    return <InvalidView />;
  }

  const admin = createAdminClient();
  const client = await lookupConnectClient(admin, params.token);
  const state = connectLinkState(client);

  if (state === 'invalid' || !client) return <InvalidView />;
  if (state === 'expired') return <ExpiredView />;
  if (state === 'consumed') return <ConsumedView />;

  // agency_name from the owner's users.name (faithful to the brief flow).
  const { data: agency } = await admin
    .from('users')
    .select('name')
    .eq('id', client.user_id)
    .maybeSingle();

  return (
    <ConnectView
      token={params.token}
      agencyName={agency?.name ?? null}
      clientName={client.name ?? null}
    />
  );
}

// ── Connect prompt ───────────────────────────────────────────────────────────

function ConnectView({
  token,
  agencyName,
  clientName,
}: {
  token: string;
  agencyName: string | null;
  clientName: string | null;
}) {
  return (
    <div
      className="min-h-screen bg-[#070A0E] flex items-center justify-center p-4"
      dir="rtl"
      style={{ fontFamily: "'Noto Sans Hebrew', sans-serif" }}
    >
      <div className="bg-[#0C1118] border border-[#2A4158] rounded-2xl p-8 w-full max-w-sm text-center">
        <div className="text-5xl mb-4">🔗</div>
        <div className="text-white font-bold text-xl mb-2">חיבור חשבון פייסבוק</div>
        <div className="text-[#6B8FA8] text-sm leading-relaxed mb-6">
          {agencyName ? <span className="text-white font-semibold">{agencyName}</span> : 'הסוכנות שלך'}
          {' '}מבקשת לחבר את חשבון הפרסום של
          {' '}
          {clientName ? <span className="text-white font-semibold">{clientName}</span> : 'העסק שלך'}
          . התחברו עם פייסבוק כדי לאשר את הגישה.
        </div>
        <a
          href={`/api/meta/connect/${token}/authorize`}
          className="block w-full bg-[#1877F2] hover:bg-[#166FE5] text-white font-bold py-3 px-4 rounded-xl transition-colors"
        >
          התחבר עם פייסבוק
        </a>
        <div className="text-[#46637A] text-xs mt-4 leading-relaxed">
          הקישור חד-פעמי ותקף ל-72 שעות.
        </div>
      </div>
    </div>
  );
}

// ── Plain-state views (match the brief page's style) ─────────────────────────

function Shell({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div
      className="min-h-screen bg-[#070A0E] flex items-center justify-center p-4"
      dir="rtl"
      style={{ fontFamily: "'Noto Sans Hebrew', sans-serif" }}
    >
      <div className="bg-[#0C1118] border border-[#2A4158] rounded-2xl p-8 w-full max-w-sm text-center">
        <div className="text-5xl mb-4">{icon}</div>
        <div className="text-white font-bold text-xl mb-2">{title}</div>
        <div className="text-[#6B8FA8] text-sm leading-relaxed">{sub}</div>
      </div>
    </div>
  );
}

function InvalidView() {
  return <Shell icon="🔗" title="הקישור לא תקין" sub="בקש מהסוכן שלך לשלוח לך קישור חדש." />;
}

function ExpiredView() {
  return <Shell icon="⏳" title="הקישור פג תוקף" sub="בקש מהסוכן שלך לשלוח לך קישור חדש." />;
}

function ConsumedView() {
  return <Shell icon="✅" title="החיבור כבר הושלם" sub="חשבון הפייסבוק כבר חובר. אין צורך לפעול שוב." />;
}
