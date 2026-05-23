import { createClient } from '@/lib/supabase/server';
import { StatCard } from '@/components/ui';
import Link from 'next/link';

export const metadata = { title: 'לוח בקרה' };

const HOLIDAYS = [
  { name: 'שבועות',    date: '2026-05-22', emoji: '📜' },
  { name: 'ראש השנה', date: '2026-09-11', emoji: '🍎' },
  { name: 'חנוכה',    date: '2026-12-04', emoji: '🕎' },
];

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [profileRes, historyRes, briefsRes, clientsRes] = await Promise.all([
    supabase.from('users').select('name, credits, plan').eq('id', user!.id).single(),
    supabase.from('credit_history').select('action, cost, created_at').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(8),
    supabase.from('briefs').select('id, status').eq('user_id', user!.id),
    supabase.from('meta_clients').select('id').eq('user_id', user!.id),
  ]);

  const profile  = profileRes.data;
  const history  = historyRes.data ?? [];
  const briefs   = briefsRes.data ?? [];
  const clients  = clientsRes.data ?? [];

  const today    = new Date();
  const nextHoliday = HOLIDAYS.find(h => new Date(h.date) > today);
  const daysTo   = nextHoliday ? Math.ceil((new Date(nextHoliday.date).getTime() - today.getTime()) / 86400000) : null;

  const actionLabels: Record<string, string> = {
    post: '✨ יצירת פוסט', analyze: '🔬 ניתוח מודעה', variations: '🔀 וריאציות',
    holiday: '📅 פוסט חג', publish: '📤 פרסום', campaign: '🚀 קמפיין',
    avatar: '🧬 אווטאר', ads_avatar: '✍️ מודעות', funnel: '🔮 משפך',
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-1">Dashboard</div>
          <h1 className="text-2xl font-bold text-[#D9E8F5] mb-1">שלום, {profile?.name} 👋</h1>
          <p className="text-[#6B8FA8] text-sm">מרכז הבקרה שלך</p>
        </div>
        <Link href="/credits" className="inline-flex items-center gap-1.5 bg-[#B8953A]/10 border border-[#B8953A]/25 text-[#D4AF55] text-sm font-bold px-3 py-1.5 rounded-lg hover:bg-[#B8953A]/20 transition-colors">
          💎 {profile?.credits?.toLocaleString()} קרדיטים
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <StatCard icon="✨" value={history.filter(h => h.action === 'post').length}    label="פוסטים נוצרו"   glow="rgba(10,122,255,.12)" />
        <StatCard icon="🧬" value={history.filter(h => h.action === 'avatar').length}  label="אווטארים"       glow="rgba(109,40,217,.12)" />
        <StatCard icon="📋" value={briefs.length}   label="בריפי לקוחות" glow="rgba(184,149,58,.1)" />
        <StatCard icon="👥" value={clients.length}  label="לקוחות Meta"  glow="rgba(5,150,105,.1)" />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { icon: '📋', title: 'בריף לקוח מלא', sub: 'אווטאר → מודעות → משפך', href: '/briefs', color: '#0A7AFF' },
          { icon: '✨', title: 'צור פוסט',       sub: '3 קרדיטים',              href: '/create',  color: '#0A7AFF' },
          { icon: '🔬', title: 'נתח מודעה',      sub: '5 קרדיטים',              href: '/analyze', color: '#6D28D9' },
          { icon: '🚀', title: 'קמפיין Meta',     sub: '15 קרדיטים',             href: '/campaign',color: '#059669' },
        ].map(a => (
          <Link key={a.href} href={a.href}
            className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4 hover:border-[#2A4158] transition-all hover:-translate-y-0.5 hover:shadow-lg group">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">{a.icon}</span>
              <div>
                <div className="font-semibold text-sm text-[#D9E8F5]">{a.title}</div>
                <div className="text-xs text-[#6B8FA8]">{a.sub}</div>
              </div>
            </div>
            <div className="text-[11px] font-semibold text-[#6B8FA8] group-hover:text-[#3D9FFF] transition-colors">התחל ←</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Next holiday */}
        {nextHoliday && (
          <div className="bg-[#D97706]/10 border border-[#D97706]/25 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{nextHoliday.emoji}</span>
                <div>
                  <div className="font-bold text-sm text-[#D97706]">{nextHoliday.name} — {daysTo} ימים</div>
                  <div className="text-xs text-[#6B8FA8] mt-0.5">הכן תוכן לחג מראש</div>
                </div>
              </div>
              <Link href="/calendar" className="text-[11px] font-bold bg-[#D97706] text-black px-3 py-1.5 rounded-lg hover:brightness-110 transition-all">
                צור פוסט
              </Link>
            </div>
          </div>
        )}

        {/* History */}
        <div className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4">
          <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <div className="w-0.5 h-3 bg-[#0A7AFF] rounded-full" />היסטוריה
          </div>
          {history.length === 0
            ? <div className="text-xs text-[#2E4459] text-center py-4">עוד לא בוצעו פעולות</div>
            : history.slice(0, 5).map((h, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 border-b border-[#1E2F42] last:border-0">
                <span className="text-sm">{actionLabels[h.action]?.split(' ')[0]}</span>
                <span className="flex-1 text-xs text-[#D9E8F5]">{actionLabels[h.action]?.slice(2) ?? h.action}</span>
                <span className="text-[11px] text-red-400 font-medium">-{h.cost}⚡</span>
                <span className="text-[10px] text-[#2E4459]">{new Date(h.created_at).toLocaleDateString('he')}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
