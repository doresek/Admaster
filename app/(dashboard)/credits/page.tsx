'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Btn, Alert, PageHeader, Chip, Input } from '@/components/ui';
import { PLAN_CONFIG, CREDIT_COSTS, type Plan } from '@/types';

const TOPUPS = [
  { credits: 100,  amount: 49,  popular: false },
  { credits: 300,  amount: 129, popular: true  },
  { credits: 800,  amount: 299, popular: false },
  { credits: 2000, amount: 599, popular: false },
];

const ACTION_LABELS: Record<string, string> = {
  post:'✨ יצירת פוסט', analyze:'🔬 ניתוח מודעה', variations:'🔀 וריאציות',
  holiday:'📅 פוסט חג', publish:'📤 פרסום', campaign:'🚀 קמפיין',
  avatar:'🧬 אווטאר', ads_avatar:'✍️ מודעות', funnel:'🔮 משפך',
  lab:'🧪 Lab', email:'📧 אימייל', sms:'📱 SMS',
  series:'🗓 סדרה', refine:'🔁 שיפור', approval:'✅ אישור',
  img_edit:'🪄 עריכת תמונה',
};

interface HistoryRow { id: string; action: string; cost: number; created_at: string; meta?: any; }

export default function CreditsPage() {
  const [plan, setPlan]       = useState<Plan>('free');
  const [credits, setCredits] = useState(0);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [topupHistory, setTopupHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState<string|null>(null);
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      Promise.all([
        supabase.from('users').select('plan, credits').eq('id', user.id).single(),
        supabase.from('credit_history').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('credit_topups').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      ]).then(([p, h, t]) => {
        if (p.data) { setPlan(p.data.plan); setCredits(p.data.credits); }
        setHistory(h.data ?? []);
        setTopupHistory(t.data ?? []);
      });
    });
  }, []);

  async function upgradePlan(newPlan: Plan) {
    if (newPlan === plan) return;
    setLoading(`plan-${newPlan}`);
    try {
      const res = await fetch('/api/credits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: newPlan }),
      });
      const { url, error } = await res.json();
      if (url) window.location.href = url;
      else alert(error || 'שגיאה');
    } finally { setLoading(null); }
  }

  async function buyTopup(credits: number, amount: number) {
    setLoading(`topup-${credits}`);
    try {
      const res = await fetch('/api/credits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topup: { credits, amount } }),
      });
      const { url, error } = await res.json();
      if (url) window.location.href = url;
      else alert(error || 'שגיאה — וודא שמוגדר STRIPE_SECRET_KEY');
    } finally { setLoading(null); }
  }

  // Available months from history
  const months = useMemo(() => {
    const set = new Set<string>();
    history.forEach(h => set.add(h.created_at.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [history]);

  const filtered = useMemo(() => {
    return history.filter(h => {
      if (monthFilter !== 'all' && !h.created_at.startsWith(monthFilter)) return false;
      if (actionFilter !== 'all' && h.action !== actionFilter) return false;
      return true;
    });
  }, [history, monthFilter, actionFilter]);

  const monthlyStats = useMemo(() => {
    const total = filtered.reduce((s, h) => s + h.cost, 0);
    return { total, count: filtered.length };
  }, [filtered]);

  function exportCSV() {
    const headers = ['date', 'action', 'cost'];
    const rows    = filtered.map(h => [
      new Date(h.created_at).toLocaleString('he'),
      h.action,
      String(h.cost),
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `credits-${monthFilter === 'all' ? 'all' : monthFilter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        eyebrow="חשבון"
        title="💎 קרדיטים ומנוי"
        sub="שדרוג / טעינה חד-פעמית / היסטוריה"
        right={<div className="bg-[#0A7AFF]/10 border border-[#0A7AFF]/20 text-[#3D9FFF] font-mono text-sm font-bold px-3 py-1.5 rounded-lg">⚡ {credits.toLocaleString()}</div>}
      />

      {/* Plans */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {(Object.entries(PLAN_CONFIG) as [Plan, typeof PLAN_CONFIG[Plan]][]).map(([id, cfg]) => (
          <div key={id} className="bg-[#152138] rounded-xl border p-4 relative" style={{ borderColor: id === plan ? cfg.color : '#243752' }}>
            {id === plan && (
              <div className="absolute -top-2 right-3 bg-[#0A7AFF] text-white text-[9px] font-bold px-2 py-0.5 rounded-full">החבילה שלך</div>
            )}
            <div className="font-bold text-[17px] mb-1" style={{ color: cfg.color }}>{cfg.name}</div>
            <div className="font-mono text-2xl font-medium text-[#D9E8F5] mb-0.5">
              {cfg.price === 0 ? 'חינם' : `₪${cfg.price}`}
              {cfg.price > 0 && <span className="text-xs text-[#6B8FA8] font-normal">/חודש</span>}
            </div>
            <div className="text-xs text-[#6B8FA8] mb-4">⚡ {cfg.credits.toLocaleString()} קרדיטים</div>
            {id === plan ? (
              <div className="text-[11px] font-bold flex items-center gap-1" style={{ color: cfg.color }}>✓ פעיל</div>
            ) : (
              <Btn variant="ghost" size="sm" full loading={loading === `plan-${id}`} onClick={() => upgradePlan(id)}
                style={{ background: `${cfg.color}18`, borderColor: `${cfg.color}44`, color: cfg.color }}>
                {cfg.price > PLAN_CONFIG[plan].price ? 'שדרג' : cfg.price === 0 ? 'שנמך' : 'החלף'}
              </Btn>
            )}
          </div>
        ))}
      </div>

      {/* Top-up */}
      <Card className="mb-6" style={{borderColor: 'rgba(184,149,58,.3)'}}>
        <div className="flex items-center justify-between mb-3">
          <CardLabel>🎯 חסר קרדיטים? טעינה חד-פעמית</CardLabel>
          <div className="text-[11px] text-[#6B8FA8]">לא משנה את התוכנית — מצטרף ליתרה</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {TOPUPS.map(t => (
            <div key={t.credits} className={`bg-[#1A2A42] border rounded-xl p-4 relative ${t.popular ? 'border-[#D4AF55]' : 'border-[#243752]'}`}>
              {t.popular && <div className="absolute -top-2 right-3 bg-[#D4AF55] text-black text-[9px] font-bold px-2 py-0.5 rounded-full">פופולרי</div>}
              <div className="font-mono text-2xl text-[#D9E8F5]">⚡ {t.credits.toLocaleString()}</div>
              <div className="text-xs text-[#6B8FA8] mb-3">₪{(t.amount / t.credits).toFixed(2)} לקרדיט</div>
              <div className="font-bold text-base text-[#D4AF55] mb-3">₪{t.amount}</div>
              <Btn variant={t.popular ? 'gold' : 'ghost'} size="sm" full loading={loading === `topup-${t.credits}`} onClick={() => buyTopup(t.credits, t.amount)}>
                קנה עכשיו
              </Btn>
            </div>
          ))}
        </div>
      </Card>

      {/* Action cost reference */}
      <Card className="mb-6">
        <CardLabel>💡 עלות פעולות</CardLabel>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(CREDIT_COSTS).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between bg-[#1A2A42] rounded-lg px-3 py-1.5">
              <span className="text-[12.5px] text-[#D9E8F5]">{ACTION_LABELS[k] ?? k}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${v === 0 ? 'bg-[#059669]/15 text-[#34D399]' : 'bg-[#B8953A]/10 text-[#D4AF55] border border-[#B8953A]/25'}`}>
                {v === 0 ? 'חינם' : `⚡${v}`}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Monthly usage log */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <CardLabel>📊 פעולות קרדיטים</CardLabel>
          <Btn variant="ghost" size="xs" onClick={exportCSV} disabled={filtered.length === 0}>📥 ייצוא CSV</Btn>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">חודש</div>
            <div className="flex flex-wrap gap-1.5">
              <Chip label="הכל" active={monthFilter==='all'} onClick={() => setMonthFilter('all')} />
              {months.map(m => (
                <Chip key={m} label={new Date(m + '-01').toLocaleDateString('he', { month: 'short', year: '2-digit' })}
                  active={monthFilter===m} onClick={() => setMonthFilter(m)} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">פעולה</div>
            <div className="flex flex-wrap gap-1.5">
              <Chip label="הכל" active={actionFilter==='all'} onClick={() => setActionFilter('all')} />
              {Array.from(new Set(history.map(h => h.action))).slice(0, 8).map(a => (
                <Chip key={a} label={ACTION_LABELS[a] ?? a} active={actionFilter===a} onClick={() => setActionFilter(a)} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between bg-[#1A2A42] rounded-lg px-3 py-2 mb-3">
          <div className="text-xs text-[#6B8FA8]">
            {monthlyStats.count} פעולות · {monthFilter === 'all' ? 'כל ההיסטוריה' : monthFilter}
          </div>
          <div className="font-mono text-sm font-bold text-red-400">-{monthlyStats.total}⚡</div>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-xs text-[#2E4459]">אין פעולות בתקופה שנבחרה</div>
          ) : filtered.map(h => (
            <div key={h.id} className="flex items-center gap-3 py-2 border-b border-[#243752] last:border-0">
              <span className="text-sm">{ACTION_LABELS[h.action]?.split(' ')[0] ?? '⚡'}</span>
              <div className="flex-1 text-[12.5px]">{ACTION_LABELS[h.action]?.slice(2) ?? h.action}</div>
              <div className="text-xs text-red-400 font-medium">-{h.cost}⚡</div>
              <div className="text-[10px] text-[#2E4459] w-24 text-end">{new Date(h.created_at).toLocaleString('he', { day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Top-up history */}
      {topupHistory.length > 0 && (
        <Card className="mt-4">
          <CardLabel>היסטוריית רכישות חד-פעמיות</CardLabel>
          {topupHistory.map(t => (
            <div key={t.id} className="flex items-center justify-between py-2 border-b border-[#243752] last:border-0 text-sm">
              <div>
                <div className="text-[#D9E8F5]">⚡ {t.credits.toLocaleString()} קרדיטים · ₪{t.amount_ils}</div>
                <div className="text-[10px] text-[#2E4459]">{new Date(t.created_at).toLocaleString('he')}</div>
              </div>
              <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.status === 'paid' ? 'bg-[#059669]/15 text-[#34D399]' : t.status === 'pending' ? 'bg-[#D97706]/15 text-[#D97706]' : 'bg-red-500/15 text-red-400'}`}>
                {t.status === 'paid' ? 'שולם' : t.status === 'pending' ? 'בהמתנה' : t.status}
              </div>
            </div>
          ))}
        </Card>
      )}

      <Alert type="blue">
        💳 הרכישות עוברות דרך Stripe Checkout. ודא ש-STRIPE_SECRET_KEY ו-STRIPE_WEBHOOK_SECRET מוגדרים ב-.env.local
      </Alert>
    </div>
  );
}
