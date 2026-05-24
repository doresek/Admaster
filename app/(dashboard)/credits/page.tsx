'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Btn, Alert, PageHeader, StatCard } from '@/components/ui';
import { PLAN_CONFIG, CREDIT_COSTS, type Plan } from '@/types';

export default function CreditsPage() {
  const [plan, setPlan]       = useState<Plan>('free');
  const [credits, setCredits] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState<string|null>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      Promise.all([
        supabase.from('users').select('plan, credits').eq('id', user.id).single(),
        supabase.from('credit_history').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
      ]).then(([p, h]) => {
        if (p.data) { setPlan(p.data.plan); setCredits(p.data.credits); }
        setHistory(h.data ?? []);
      });
    });
  }, []);

  async function upgradePlan(newPlan: Plan) {
    if (newPlan === plan) return;
    setLoading(newPlan);
    try {
      const res = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: newPlan }),
      });
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  }

  const actionLabels: Record<string, string> = {
    post:'✨ יצירת פוסט', analyze:'🔬 ניתוח מודעה', variations:'🔀 וריאציות',
    holiday:'📅 פוסט חג', publish:'📤 פרסום', campaign:'🚀 קמפיין',
    avatar:'🧬 אווטאר', ads_avatar:'✍️ מודעות', funnel:'🔮 משפך',
  };

  return (
    <div>
      <PageHeader eyebrow="חשבון" title="קרדיטים ותוכניות" sub="שדרג לקבל יותר פעולות AI"
        right={
          <div className="bg-[#0A7AFF]/10 border border-[#0A7AFF]/20 text-[#3D9FFF] font-mono text-sm font-bold px-3 py-1.5 rounded-lg">⚡ {credits.toLocaleString()}</div>
        } />

      {/* Credit costs */}
      <Card className="mb-6">
        <CardLabel>עלות פעולות</CardLabel>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(CREDIT_COSTS).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between bg-[#162030] rounded-lg px-3 py-2">
              <span className="text-[12.5px] font-medium">{actionLabels[k] || k}</span>
              <span className="text-[11px] font-bold bg-[#B8953A]/10 border border-[#B8953A]/25 text-[#D4AF55] px-2 py-0.5 rounded-full">⚡{v}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Plans */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {(Object.entries(PLAN_CONFIG) as [Plan, typeof PLAN_CONFIG[Plan]][]).map(([id, cfg]) => (
          <div key={id} className="bg-[#111A24] rounded-xl border p-4 relative overflow-hidden"
            style={{ borderColor: id === plan ? cfg.color : '#1E2F42' }}>
            {'badge' in cfg && cfg.badge && (
              <div className="absolute top-2.5 left-2.5 text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background:`${cfg.color}22`, color:cfg.color, border:`1px solid ${cfg.color}44` }}>
                {cfg.badge}
              </div>
            )}
            <div className="font-bold text-[17px] mb-1" style={{ color: cfg.color }}>{cfg.name}</div>
            <div className="font-mono text-2xl font-medium text-[#D9E8F5] mb-0.5">
              {cfg.price === 0 ? 'חינם' : `₪${cfg.price}`}
              {cfg.price > 0 && <span className="text-xs text-[#6B8FA8] font-normal">/חודש</span>}
            </div>
            <div className="text-xs text-[#6B8FA8] mb-4">⚡ {cfg.credits.toLocaleString()} קרדיטים</div>

            {id === plan ? (
              <div className="text-[11px] font-bold flex items-center gap-1" style={{ color: cfg.color }}>✓ התוכנית הנוכחית</div>
            ) : (
              <Btn variant="ghost" size="sm" full loading={loading === id} onClick={() => upgradePlan(id)}
                style={{ background: `${cfg.color}18`, borderColor: `${cfg.color}44`, color: cfg.color }}>
                שדרג
              </Btn>
            )}
          </div>
        ))}
      </div>

      <Alert type="blue">
        💳 בגרסת Demo לחיצה על "שדרג" תפנה ל-Stripe Checkout. ודא ש-STRIPE_SECRET_KEY מוגדר ב-.env.local
      </Alert>

      {/* History */}
      {history.length > 0 && (
        <Card className="mt-4">
          <CardLabel>היסטוריית שימוש</CardLabel>
          {history.map((h, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-[#1E2F42] last:border-0">
              <span className="text-sm">{actionLabels[h.action]?.split(' ')[0] ?? '⚡'}</span>
              <div className="flex-1 text-[12.5px]">{actionLabels[h.action]?.slice(2) ?? h.action}</div>
              <div className="text-xs text-red-400 font-medium">-{h.cost}⚡</div>
              <div className="text-[10px] text-[#2E4459]">{new Date(h.created_at).toLocaleDateString('he')}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
