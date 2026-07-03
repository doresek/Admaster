// Public, session-less client-facing ROI report. No auth required — the 64-hex
// token IS the authorization. Resolves the immutable report snapshot via the
// SERVICE ROLE (the token, not RLS, gates access) and renders it in Hebrew RTL.
// Invalid / expired views match the brief magic-link page style.
import { createAdminClient } from '@/lib/supabase/server';
import { REPORT_TOKEN_REGEX, resolveReportShare } from '@/app/api/report/[token]/resolve';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// The report snapshot shape mirrors what POST /api/reports returns as `data`.
type ReportSnapshot = {
  client?: string;
  period?: { start?: string; end?: string };
  metrics?: {
    impressions?: number | string;
    clicks?: number | string;
    spend?: number | string;
    reach?: number | string;
    conversions?: number | string;
    avgCtr?: number | string;
    avgCpc?: number | string;
    cpa?: number | string;
  };
  postsPublished?: number;
  analysis?: string;
};

export default async function ReportTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // Cheap rejection of malformed tokens — saves a DB roundtrip on bot traffic.
  if (!REPORT_TOKEN_REGEX.test((await params).token)) {
    return <InvalidView />;
  }

  const admin = createAdminClient();
  const resolved = await resolveReportShare(admin, (await params).token);

  if (!resolved.valid) {
    return resolved.expired ? <ExpiredView /> : <InvalidView />;
  }

  const report = (resolved.report ?? {}) as ReportSnapshot;
  const m = report.metrics ?? {};
  const clientName = resolved.clientName ?? report.client ?? '';
  const period = resolved.period;

  const cards: Array<[string, string, string]> = [
    ['💰', 'הוצאה', `₪${parseFloat(String(m.spend ?? 0)).toFixed(0)}`],
    ['🎯', 'המרות', parseInt(String(m.conversions ?? 0)).toLocaleString()],
    ['👁', 'חשיפות', parseInt(String(m.impressions ?? 0)).toLocaleString()],
    ['🖱', 'קליקים', parseInt(String(m.clicks ?? 0)).toLocaleString()],
    ['📊', 'CTR', `${m.avgCtr ?? 0}%`],
    ['💎', 'CPC', `₪${m.avgCpc ?? 0}`],
  ];

  return (
    <div
      className="min-h-screen bg-[#070A0E] flex items-start justify-center p-4 py-10"
      dir="rtl"
      style={{ fontFamily: "'Noto Sans Hebrew', sans-serif" }}
    >
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-[#6B8FA8] text-xs tracking-widest uppercase mb-1">דוח ביצועים</div>
          <h1 className="text-white font-bold text-2xl">{clientName}</h1>
          {period?.start && period?.end && (
            <div className="text-[#6B8FA8] text-sm mt-1" dir="ltr">
              {period.start} — {period.end}
            </div>
          )}
        </div>

        {/* Headline outcomes */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
          {cards.map(([icon, label, value]) => (
            <div key={label} className="bg-[#0C1118] border border-[#1E2F42] rounded-xl p-3">
              <div className="text-[11px] text-[#6B8FA8]">{icon} {label}</div>
              <div className="font-mono text-lg font-semibold text-[#D9E8F5] mt-0.5">{value}</div>
            </div>
          ))}
        </div>

        {typeof report.postsPublished === 'number' && (
          <div className="bg-[#0C1118] border border-[#1E2F42] rounded-xl p-3 mb-4 text-center">
            <span className="text-[#6B8FA8] text-sm">📤 פוסטים שפורסמו בתקופה: </span>
            <span className="font-mono font-semibold text-[#D9E8F5]">{report.postsPublished}</span>
          </div>
        )}

        {/* Hebrew narrative */}
        {report.analysis && (
          <div className="bg-[#0C1118] border border-[#2A4158] rounded-2xl p-5">
            <div className="text-xs font-bold text-[#6B8FA8] mb-3 uppercase tracking-wide">סיכום וניתוח</div>
            <div className="text-[14px] leading-relaxed text-[#D9E8F5] whitespace-pre-wrap">
              {report.analysis}
            </div>
          </div>
        )}

        <div className="text-center text-[#2E4459] text-[11px] mt-8">
          הופק באמצעות AdMaster Pro
        </div>
      </div>
    </div>
  );
}

// ── Plain-state views (match the brief magic-link page) ──────────────────────

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
