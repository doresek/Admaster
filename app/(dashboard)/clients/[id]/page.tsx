// Client Intelligence home — the screen that makes the living client brain
// visible. Read-only over the clean `clients` model + the intelligence core:
// identity header, the 🧠 Living-Knowledge wall (3 layers of atoms with the
// signal loop), and the 🎯 Strategy snapshot synthesized from the active atoms.
// The optional Meta-connect card stays as a small section. No schema change,
// no credits to VIEW — reads only + the existing signal POST.
import Link from 'next/link';
import { createClient as createSupabaseClient } from '@/lib/supabase/server';
import { getClient, getClientStrategy } from '@/lib/clients';
import { listActiveInsights } from '@/lib/intelligence/insights';
import { avgConfidencePct, shouldShowBuilding } from '@/lib/intelligence/display';
import type { StrategyAnalysis } from '@/lib/analyze-brief';
import { Card, CardLabel, Alert } from '@/components/ui';
import ConnectFacebookButton from '@/components/meta/ConnectFacebookButton';
import { KnowledgeWall } from '@/components/intelligence/KnowledgeWall';
import { StrategySnapshot } from '@/components/intelligence/StrategySnapshot';
import { BuildingBrain } from '@/components/intelligence/BuildingBrain';

export default async function ClientWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <Alert type="amber">התחבר כדי לצפות בלקוח.</Alert>;
  }

  const client = await getClient(supabase, (await params).id, user.id);
  if (!client) {
    return (
      <div>
        <Alert type="red">הלקוח לא נמצא.</Alert>
        <Link href="/clients" className="text-[#7AC0FF] text-sm">← חזרה ללקוחות</Link>
      </div>
    );
  }

  const [strategy, insights] = await Promise.all([
    getClientStrategy(supabase, client.id).catch(() => null),
    listActiveInsights(supabase, client.id).catch(() => []),
  ]);

  // Has a brief ever been submitted for this client? Distinguishes "still
  // learning" (brief in, brain not finished) from "no brief at all".
  const { count: briefCount } = await supabase
    .from('briefs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('client_id', client.id);
  const hasBrief = (briefCount ?? 0) > 0 || !!strategy?.core_generated_at;

  const coreGeneratedAt = strategy?.core_generated_at ?? null;
  const businessAnalysis = (strategy?.business_analysis as Partial<StrategyAnalysis> | null) ?? null;
  const avgConfidence = avgConfidencePct(insights);
  const building = shouldShowBuilding(insights, coreGeneratedAt);
  const freshness = coreGeneratedAt ? new Date(coreGeneratedAt).toLocaleDateString('he') : null;

  return (
    <div dir="rtl">
      {/* ── Identity header ───────────────────────────────────────────── */}
      <div className="flex items-start gap-3 mb-5">
        <Link href="/clients" className="text-[#7AC0FF] text-lg mt-1">←</Link>
        <div className="flex-1">
          <div className="text-[11px] font-bold text-[#2E4459] uppercase">לקוח</div>
          <div className="font-bold text-xl text-[#D9E8F5]">{client.name}</div>
          <div className="text-xs text-[#6B8FA8] mt-0.5">
            {client.company && <span>{client.company}</span>}
            {client.company && (client.email || client.phone) && <span> · </span>}
            {client.email && <span dir="ltr">{client.email}</span>}
            {client.email && client.phone && <span> · </span>}
            {client.phone && <span dir="ltr">{client.phone}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#6B8FA8] mt-1.5">
            {freshness && <span>עודכן {freshness}</span>}
            {freshness && <span className="text-[#2E4459]">·</span>}
            <span className="text-[#7AC0FF]">
              {insights.length} תובנות פעילות · ביטחון ממוצע {avgConfidence}%
            </span>
          </div>
        </div>
      </div>

      {/* ── Small section: brief + Meta connect (kept, do not break OAuth) ─ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <Card>
          <CardLabel>בריף</CardLabel>
          <div className={`text-sm font-semibold mb-3 ${hasBrief ? 'text-[#34D399]' : 'text-[#6B8FA8]'}`}>
            {hasBrief ? '✓ בריף הושלם' : '○ ממתין לבריף'}
          </div>
          <Link href={`/send-brief?client=${client.id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0A7AFF] hover:brightness-110 text-white text-sm font-semibold px-4 py-2 transition-all">
            📋 {hasBrief ? 'שלח בריף נוסף' : 'צור בריף ללקוח'}
          </Link>
        </Card>

        <Card>
          <CardLabel>חיבור Meta (אופציונלי)</CardLabel>
          <div className="text-xs text-[#6B8FA8] mb-3">
            חבר חשבון Facebook/Meta לפרסום. אפשר לדלג ולחבר מאוחר יותר.
          </div>
          <ConnectFacebookButton clientId={client.id} />
        </Card>
      </div>

      {/* ── The brain ─────────────────────────────────────────────────── */}
      {insights.length > 0 || coreGeneratedAt ? (
        <>
          <div className="mb-6">
            <div className="text-base font-bold text-[#D9E8F5] mb-3">🧠 הידע החי על הלקוח</div>
            <KnowledgeWall insights={insights} />
          </div>
          {businessAnalysis && (
            <div className="mt-8">
              <StrategySnapshot
                analysis={businessAnalysis}
                activeCount={insights.length}
                coreGeneratedAt={coreGeneratedAt}
                clientId={client.id}
              />
            </div>
          )}
        </>
      ) : building && hasBrief ? (
        <BuildingBrain clientId={client.id} />
      ) : (
        <div className="rounded-2xl bg-[#111A24] border border-[#1E2F42] p-8 text-center">
          <div className="text-4xl mb-3">🧠</div>
          <div className="text-lg font-bold text-[#D9E8F5] mb-1">שלח בריף כדי שהמערכת תלמד את הלקוח</div>
          <div className="text-xs text-[#6B8FA8] mb-5">
            הבריף הוא הדלק של המוח — ממנו נחלצות התובנות הראשונות והאסטרטגיה.
          </div>
          <Link href={`/send-brief?client=${client.id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0A7AFF] hover:brightness-110 text-white text-sm font-semibold px-4 py-2 transition-all">
            📋 צור בריף ללקוח
          </Link>
        </div>
      )}
    </div>
  );
}
