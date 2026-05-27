import { createClient } from '@/lib/supabase/server';
import { StatCard } from '@/components/ui';
import { RecommendationsWidget } from '@/components/RecommendationsWidget';
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

  // Run all dashboard queries in parallel
  const [
    profileRes,
    historyRes,
    briefsRes,
    clientsRes,
    contentByTypeRes,
    msgsRes,
    seriesRes,
    landingRes,
    usageRes,
  ] = await Promise.all([
    supabase.from('users').select('name, credits, plan').eq('id', user!.id).single(),
    supabase.from('credit_history').select('action, cost, created_at').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(8),
    supabase.from('briefs').select('id, status').eq('user_id', user!.id),
    supabase.from('meta_clients').select('id').eq('user_id', user!.id),
    supabase.from('generated_content').select('type').eq('user_id', user!.id),
    supabase.from('messages').select('id, channel').eq('user_id', user!.id),
    supabase.from('message_series').select('id').eq('user_id', user!.id),
    supabase.from('landing_pages').select('id, status, views, conversions').eq('user_id', user!.id),
    supabase.rpc('credit_usage_30d', { p_user_id: user!.id }),
  ]);

  const profile  = profileRes.data;
  const history  = historyRes.data ?? [];
  const briefs   = briefsRes.data ?? [];
  const clients  = clientsRes.data ?? [];
  const content  = contentByTypeRes.data ?? [];
  const msgs     = msgsRes.data ?? [];
  const series   = seriesRes.data ?? [];
  const landing  = landingRes.data ?? [];
  const usage    = (usageRes.data ?? []) as { day: string; used: number }[];

  const today    = new Date();
  const nextHoliday = HOLIDAYS.find(h => new Date(h.date) > today);
  const daysTo   = nextHoliday ? Math.ceil((new Date(nextHoliday.date).getTime() - today.getTime()) / 86400000) : null;

  const postsCount     = content.filter(c => c.type === 'post' || c.type === 'campaign').length;
  const imagesCount    = content.filter(c => c.type === 'img_edit').length; // images table is separate; we proxy via generated_content edits
  const emailsCount    = msgs.filter(m => m.channel === 'email').length;
  const whatsappsCount = msgs.filter(m => m.channel === 'whatsapp').length;
  const smsCount       = msgs.filter(m => m.channel === 'sms').length;
  const publishedLP    = landing.filter(l => l.status === 'published').length;

  // Pull actual image count from generated_images
  const { count: imagesActual } = await supabase
    .from('generated_images').select('id', { count: 'exact', head: true }).eq('user_id', user!.id);

  // Build chart series — normalize max for visual scaling
  const maxUsed = Math.max(1, ...usage.map(u => u.used));

  const actionLabels: Record<string, string> = {
    post: '✨ יצירת פוסט', analyze: '🔬 ניתוח מודעה', variations: '🔀 וריאציות',
    holiday: '📅 פוסט חג', publish: '📤 פרסום', campaign: '🚀 קמפיין',
    avatar: '🧬 אווטאר', ads_avatar: '✍️ מודעות', funnel: '🔮 משפך',
    lab: '🧪 Lab', email: '📧 אימייל', sms: '📱 SMS',
    series: '🗓 סדרה', refine: '🔁 שיפור', approval: '✅ אישור',
    img_edit: '🪄 עריכת תמונה',
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-7">
        <div className="min-w-0">
          <div className="text-2xs font-bold tracking-kicker uppercase text-[#607C92] mb-2">Dashboard</div>
          <h1 className="font-serif text-2xl md:text-3xl text-[#D9E8F5] leading-tight tracking-tight">שלום, {profile?.name}</h1>
          <span className="block h-px w-16 bg-gradient-to-l from-[#D4AF55] to-transparent mt-3" aria-hidden />
          <p className="text-[#6B8FA8] text-sm mt-3 leading-relaxed">מרכז הבקרה שלך · {clients.length} לקוחות · {profile?.plan}</p>
        </div>
        <Link href="/credits" className="inline-flex items-center gap-1.5 bg-[#B8953A]/10 border border-[#B8953A]/25 text-[#D4AF55] text-sm font-bold px-3 py-1.5 rounded-lg hover:bg-[#B8953A]/20 transition-colors cursor-pointer">
          <span aria-hidden>◆</span>
          {profile?.credits?.toLocaleString()} קרדיטים
        </Link>
      </div>

      {/* AI Recommendations */}
      <RecommendationsWidget />

      {/* 8-stats grid */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <StatCard icon="👥" value={clients.length}      label="לקוחות פעילים" glow="rgba(5,150,105,.12)" />
        <StatCard icon="✨" value={postsCount}          label="פוסטים שנוצרו" glow="rgba(10,122,255,.12)" />
        <StatCard icon="🎨" value={imagesActual ?? 0}   label="תמונות שנוצרו" glow="rgba(109,40,217,.12)" />
        <StatCard icon="💎" value={profile?.credits ?? 0} label="קרדיטים זמינים" glow="rgba(184,149,58,.12)" />
        <StatCard icon="📧" value={emailsCount}         label="מיילים שנוצרו" glow="rgba(10,122,255,.10)" />
        <StatCard icon="💬" value={whatsappsCount}      label="הודעות WhatsApp" glow="rgba(5,150,105,.10)" />
        <StatCard icon="📱" value={smsCount}            label="הודעות SMS" glow="rgba(217,119,6,.10)" />
        <StatCard icon="📄" value={publishedLP}         label="דפי נחיתה פעילים" glow="rgba(109,40,217,.10)" />
      </div>

      {/* 30-day chart */}
      <div className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest">שימוש בקרדיטים — 30 ימים אחרונים</div>
          <div className="text-[10px] text-[#6B8FA8]">סה"כ: <span className="font-mono text-[#D9E8F5]">{usage.reduce((s, u) => s + u.used, 0)}⚡</span></div>
        </div>
        <div className="flex items-end gap-1 h-32">
          {usage.map((u, i) => {
            const pct = (u.used / maxUsed) * 100;
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 group relative">
                <div className="w-full rounded-t" style={{ height: `${Math.max(2, pct)}%`, background: u.used > 0 ? 'linear-gradient(180deg,#3D9FFF,#0A7AFF)' : '#1D2D3E' }} />
                {(i % 5 === 0 || i === usage.length - 1) && (
                  <div className="text-[8px] text-[#2E4459] mt-0.5">{new Date(u.day).toLocaleDateString('he', { day:'numeric', month:'numeric' })}</div>
                )}
                {/* Tooltip */}
                <div className="absolute bottom-full mb-1 hidden group-hover:block bg-[#070A0E] border border-[#2A4158] text-[10px] text-[#D9E8F5] px-2 py-1 rounded whitespace-nowrap z-10">
                  {u.used}⚡ · {new Date(u.day).toLocaleDateString('he')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick actions — featured */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { icon: '🚀', title: 'קמפיין בלחיצה', sub: '15 קרדיטים', href: '/quick-campaign', color: '#0A7AFF' },
          { icon: '📄', title: 'דף נחיתה',      sub: '6 templates',  href: '/landing-pages', color: '#6D28D9' },
          { icon: '✨', title: 'צור פוסט',      sub: '3 קרדיטים',    href: '/create', color: '#059669' },
          { icon: '📋', title: 'בריף לקוח',     sub: 'אווטאר→מודעות', href: '/briefs', color: '#D97706' },
        ].map(a => (
          <Link key={a.href} href={a.href}
            className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4 hover:border-[#2A4158] transition-all hover:-translate-y-0.5 hover:shadow-lg group">
            <div className="text-2xl mb-2">{a.icon}</div>
            <div className="font-semibold text-sm text-[#D9E8F5]">{a.title}</div>
            <div className="text-[11px] text-[#6B8FA8]">{a.sub}</div>
            <div className="text-[11px] font-semibold mt-2 group-hover:text-[#3D9FFF] transition-colors" style={{ color: a.color }}>התחל ←</div>
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

        {/* Series running */}
        <div className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4">
          <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <div className="w-0.5 h-3 bg-[#0A7AFF] rounded-full" />סדרות וקמפיינים
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <div className="font-mono text-xl text-[#3D9FFF]">{series.length}</div>
              <div className="text-[10px] text-[#6B8FA8] mt-0.5">סדרות מסרים</div>
            </div>
            <div>
              <div className="font-mono text-xl text-[#34D399]">{landing.reduce((s, l) => s + (l.conversions ?? 0), 0)}</div>
              <div className="text-[10px] text-[#6B8FA8] mt-0.5">לידים מדפי נחיתה</div>
            </div>
            <div>
              <div className="font-mono text-xl text-[#A78BFA]">{briefs.length}</div>
              <div className="text-[10px] text-[#6B8FA8] mt-0.5">בריפי לקוחות</div>
            </div>
            <div>
              <div className="font-mono text-xl text-[#D4AF55]">{landing.reduce((s, l) => s + (l.views ?? 0), 0)}</div>
              <div className="text-[10px] text-[#6B8FA8] mt-0.5">צפיות בדפים</div>
            </div>
          </div>
        </div>

        {/* History */}
        <div className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4 col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest flex items-center gap-1.5">
              <div className="w-0.5 h-3 bg-[#0A7AFF] rounded-full" />פעולות אחרונות
            </div>
            <Link href="/history" className="text-[10px] text-[#3D9FFF] hover:underline">כל ההיסטוריה →</Link>
          </div>
          {history.length === 0
            ? <div className="text-xs text-[#2E4459] text-center py-4">עוד לא בוצעו פעולות</div>
            : history.slice(0, 8).map((h, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 border-b border-[#1E2F42] last:border-0">
                <span className="text-sm">{actionLabels[h.action]?.split(' ')[0] ?? '⚡'}</span>
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
