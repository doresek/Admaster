import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { fetchClientCardData, briefCompletionPct } from '@/lib/client-card';
import { Card, CardLabel, StatCard, Alert } from '@/components/ui';

// Hebrew labels for the brief fields we surface (subset of the full form).
const BRIEF_LABELS: Record<string, string> = {
  biz_name:   'שם העסק',
  biz_what:   'מה העסק עושה',
  biz_result: 'התוצאה ללקוח',
  cust_who:   'הלקוח האידיאלי',
  pain_main:  'הכאב הגדול',
  offer_cta:  'CTA',
};

// Friendly labels for generated_content.type.
const TYPE_LABEL: Record<string, { label: string; emoji: string }> = {
  post:       { label: 'פוסט',        emoji: '✨' },
  campaign:   { label: 'קמפיין',      emoji: '🚀' },
  master_post:{ label: 'Master',      emoji: '👑' },
  variations: { label: 'וריאציות',    emoji: '🔀' },
  holiday:    { label: 'פוסט חג',      emoji: '📅' },
  lab:        { label: 'The Lab',     emoji: '🧪' },
  refined:    { label: 'גרסה משופרת', emoji: '🔁' },
};

const LP_STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'טיוטה',  cls: 'text-[#6B8FA8]' },
  published: { label: 'פורסם',  cls: 'text-[#34D399]' },
};

// A Link styled like the app's primary button (server-safe; no onClick).
function LinkBtn({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-semibold transition-colors">
      {children}
    </Link>
  );
}

function EmptyState({ icon, text, cta }: { icon: string; text: string; cta: { href: string; label: string } }) {
  return (
    <div className="text-center py-8 text-[#2E4459]">
      <div className="text-3xl mb-2 opacity-30">{icon}</div>
      <div className="text-sm mb-3">{text}</div>
      <LinkBtn href={cta.href}>{cta.label}</LinkBtn>
    </div>
  );
}

export default async function ClientCardPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const data = await fetchClientCardData(supabase, user.id, params.id);
  if (!data) notFound();

  const { client, brief, posts, images, landingPages, leadCount } = data;
  const pct = briefCompletionPct(brief?.values);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link href="/clients"
          className="w-9 h-9 rounded-lg bg-[#162030] border border-[#1E2F42] flex items-center justify-center text-[#6B8FA8] hover:border-[#2A4158] hover:text-white transition-colors">
          ←
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold text-[#2E4459] uppercase">לקוח</div>
          <div className="font-bold text-lg truncate">
            {client.emoji ?? '🏢'} {client.name}
            {client.industry && <span className="text-[#6B8FA8] font-normal text-sm"> · {client.industry}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className={`w-1.5 h-1.5 rounded-full ${client.status === 'connected' ? 'bg-[#059669]' : 'bg-red-500'}`} />
          <span className={`text-[10px] font-bold ${client.status === 'connected' ? 'text-[#059669]' : 'text-red-400'}`}>
            {client.status === 'connected' ? 'פעיל' : 'שגיאה'}
          </span>
        </div>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard icon="✨" value={posts.length}        label="פוסטים" />
        <StatCard icon="🖼" value={images.length}       label="תמונות" />
        <StatCard icon="🌐" value={landingPages.length} label="דפי נחיתה" />
        <StatCard icon="🎯" value={leadCount}           label="לידים" />
      </div>

      {/* Brief */}
      <Card className="mb-4">
        <CardLabel>בריף</CardLabel>
        {brief ? (
          <div>
            <div className="flex items-center gap-2 mb-3 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-[#0A7AFF]/10 text-[#3D9FFF]">{pct}% הושלם</span>
              <span className="text-[#2E4459]">· התקבל {new Date(brief.submitted_at).toLocaleDateString('he')}</span>
            </div>
            <div className="space-y-1.5">
              {Object.entries(BRIEF_LABELS).map(([k, label]) => {
                const v = brief.values?.[k];
                if (!v || !String(v).trim()) return null;
                return (
                  <div key={k} className="text-[12.5px] leading-relaxed">
                    <span className="text-[#6B8FA8]">{label}: </span>
                    <span className="text-[#D9E8F5]">{String(v)}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3"><Link href="/briefs" className="text-[11px] text-[#3D9FFF] hover:underline">פתח בריף מלא →</Link></div>
          </div>
        ) : (
          <EmptyState icon="📋" text="אין בריף עדיין ללקוח הזה" cta={{ href: '/send-brief', label: '+ שלח בריף' }} />
        )}
      </Card>

      {/* Posts */}
      <Card className="mb-4">
        <CardLabel>פוסטים ({posts.length})</CardLabel>
        {posts.length > 0 ? (
          <div className="space-y-2">
            {posts.map(p => {
              const meta = TYPE_LABEL[p.type] ?? { label: p.type, emoji: '📄' };
              const preview = p.output?.text || p.output?.post || p.output?.body ||
                JSON.stringify(p.output ?? {}).substring(0, 200);
              return (
                <div key={p.id} className="bg-[#162030] border border-[#1E2F42] rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{meta.emoji}</span>
                    <span className="text-xs font-bold text-[#D9E8F5]">{meta.label}</span>
                    {p.platform && <span className="text-[10px] text-[#6B8FA8]">· {p.platform}</span>}
                    <span className="text-[10px] text-[#2E4459] ms-auto">{new Date(p.created_at).toLocaleDateString('he')}</span>
                  </div>
                  <div className="text-[12px] text-[#6B8FA8] leading-relaxed line-clamp-2 whitespace-pre-wrap">{preview}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon="✨" text="אין פוסטים עדיין ללקוח הזה" cta={{ href: '/create', label: '+ צור פוסט' }} />
        )}
      </Card>

      {/* Images */}
      <Card className="mb-4">
        <CardLabel>תמונות ({images.length})</CardLabel>
        {images.length > 0 ? (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {images.map(img => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={img.id} src={img.image_url} alt={img.prompt ?? ''} title={img.prompt ?? ''}
                className="w-full aspect-square object-cover rounded-lg border border-[#1E2F42]" />
            ))}
          </div>
        ) : (
          <EmptyState icon="🖼" text="אין תמונות עדיין ללקוח הזה" cta={{ href: '/images', label: '+ צור תמונה' }} />
        )}
      </Card>

      {/* Landing pages + leads */}
      <Card>
        <CardLabel>דפי נחיתה ({landingPages.length}) · {leadCount} לידים</CardLabel>
        {landingPages.length > 0 ? (
          <div className="space-y-2">
            {landingPages.map(lp => {
              const st = LP_STATUS[lp.status] ?? { label: lp.status, cls: 'text-[#6B8FA8]' };
              return (
                <div key={lp.id} className="flex items-center gap-3 bg-[#162030] border border-[#1E2F42] rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#D9E8F5] truncate">{lp.title}</div>
                    <div className="text-[10px] text-[#2E4459]">/{lp.slug}</div>
                  </div>
                  <span className={`text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                  <div className="text-[10px] text-[#6B8FA8] text-end">
                    <div><strong className="text-[#D9E8F5]">{lp.views ?? 0}</strong> צפיות</div>
                    <div><strong className="text-[#D9E8F5]">{lp.conversions ?? 0}</strong> המרות</div>
                  </div>
                  <Link href={`/landing-pages/edit/${lp.id}`} className="text-[11px] text-[#3D9FFF] hover:underline flex-shrink-0">ערוך →</Link>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon="🌐" text="אין דפי נחיתה עדיין ללקוח הזה" cta={{ href: '/landing-pages', label: '+ צור דף נחיתה' }} />
        )}
      </Card>
    </div>
  );
}
