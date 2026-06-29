// Public magic-link brief form. No auth required — the 64-hex token IS the
// authorization. Adapted from the feat/briefs-v2-tokenized scaffold, but bound
// to main's brief_codes model (token lives on brief_codes, not briefs) and to
// main's existing questionnaire (BriefQuestionnaire).
import { createAdminClient } from '@/lib/supabase/server';
import TokenBriefForm from './TokenBriefForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Must match generateBriefToken() (randomBytes(32) -> 64 lowercase hex chars).
const TOKEN_REGEX = /^[a-f0-9]{64}$/;

export default async function BriefTokenPage({
  params,
}: {
  params: { token: string };
}) {
  // Cheap rejection of malformed tokens — saves a DB roundtrip on bot traffic.
  if (!TOKEN_REGEX.test(params.token)) {
    return <InvalidView />;
  }

  const admin = createAdminClient();

  // The token is the auth: resolve it to the brief code (agency branding +
  // client linkage). Submission re-resolves server-side, so we only need
  // display data here.
  const { data: code, error } = await admin
    .from('brief_codes')
    .select('agency_name, client_id, created_at')
    .eq('token', params.token)
    .maybeSingle();

  if (error || !code) {
    return <InvalidView />;
  }

  // [expiry hook] v1 links never expire (reusable by design). When migration 018
  // grows a brief_codes.expires_at column, add it to the select above and this
  // dormant guard activates the ExpiredView. Read defensively so it is a no-op
  // until the column exists.
  const expiresAt = (code as { expires_at?: string }).expires_at;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return <ExpiredView />;
  }

  // [single-use hook] Reusable in v1 — the same link may be submitted multiple
  // times, matching the legacy code behavior. A consumed_at check would go here.

  return <TokenBriefForm token={params.token} agencyName={code.agency_name ?? ''} />;
}

// ── Plain-state views ───────────────────────────────────────────────────────

function Shell({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className="min-h-screen bg-[#070A0E] flex items-center justify-center p-4" dir="rtl"
      style={{ fontFamily: "'Noto Sans Hebrew', sans-serif" }}>
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
