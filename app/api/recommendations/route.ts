import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface Rec {
  kind:         'quick_win' | 'growth' | 'retention' | 'warning' | 'tip';
  title:        string;
  body:         string;
  action_href:  string;
  action_label: string;
  priority:     number;
}

// GET /api/recommendations — compute and return personalized recommendations
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pull data needed for rule-based scoring
  const [profile, clients, briefs, content, landing, msgSeries, approvals, dismissedRes, lp_leads] = await Promise.all([
    supabase.from('users').select('credits, plan, created_at').eq('id', user.id).single(),
    supabase.from('meta_clients').select('id, name, selected_page_id, selected_ad_account_id').eq('user_id', user.id),
    supabase.from('briefs').select('id, values, status').eq('user_id', user.id),
    supabase.from('generated_content').select('type, favorite, created_at').eq('user_id', user.id),
    supabase.from('landing_pages').select('id, status, views, conversions').eq('user_id', user.id),
    supabase.from('message_series').select('id, status').eq('user_id', user.id),
    supabase.from('approvals').select('id, status').eq('user_id', user.id),
    supabase.from('recommendations').select('title').eq('user_id', user.id).eq('dismissed', true),
    supabase.from('landing_page_leads').select('id, created_at').eq('user_id', user.id),
  ]);

  const cred       = profile.data?.credits ?? 0;
  const plan       = profile.data?.plan ?? 'free';
  const accountAge = profile.data?.created_at
    ? Math.floor((Date.now() - new Date(profile.data.created_at).getTime()) / 86400000)
    : 0;
  const cl         = clients.data ?? [];
  const br         = briefs.data ?? [];
  const co         = content.data ?? [];
  const lp         = landing.data ?? [];
  const ser        = msgSeries.data ?? [];
  const ap         = approvals.data ?? [];
  const leads      = lp_leads.data ?? [];
  const dismissed  = new Set((dismissedRes.data ?? []).map(r => r.title));

  const recs: Rec[] = [];

  // ─────────── EMPTY STATE RECS ───────────
  if (cl.length === 0) {
    recs.push({
      kind: 'quick_win', priority: 100,
      title: '👥 הוסף לקוח Meta ראשון',
      body: 'חברתי לחשבון פייסבוק/אינסטגרם תפעיל פרסום ישיר, אנליטיקה, וקמפיינים. לוקח 2 דקות.',
      action_href: '/clients', action_label: 'הוסף לקוח',
    });
  }

  if (br.length === 0 && cl.length > 0) {
    recs.push({
      kind: 'quick_win', priority: 95,
      title: '📋 פתח בריף ראשון',
      body: 'בריף הוא הבסיס לכל היצירה — ממנו יוצרים אווטאר, מודעות ומשפך מותאמים אישית.',
      action_href: '/briefs', action_label: 'צור בריף',
    });
  }

  // ─────────── BRIEF COMPLETION RECS ───────────
  const BRIEF_FIELDS = [
    'biz_name','biz_what','biz_result','biz_time','biz_price','biz_usp',
    'cust_who','cust_income','pain_main','pain_internal','desire_dream',
    'obj_main','obj_tried','obj_fear','mkt_awareness',
    'offer_anchor','offer_price','offer_bonuses','offer_guarantee','offer_urgency','offer_cta',
  ];
  const incompleteBrief = br.find(b => {
    if (!b.values) return false;
    const filled = BRIEF_FIELDS.filter(f => String((b.values as any)?.[f] ?? '').trim() !== '').length;
    return filled > 5 && filled < BRIEF_FIELDS.length - 2; // partially filled
  });
  if (incompleteBrief) {
    recs.push({
      kind: 'growth', priority: 80,
      title: '🧠 נתח בריף חלקי',
      body: 'יש לך בריף שלא הושלם. נתח אותו ו-AI יציע אילו שאלות לחזור ולשאול את הלקוח.',
      action_href: '/analyze-brief', action_label: 'נתח עכשיו',
    });
  }

  // ─────────── CLIENT WITHOUT META PAGE ───────────
  const unconfigured = cl.find(c => !c.selected_page_id || !c.selected_ad_account_id);
  if (unconfigured) {
    recs.push({
      kind: 'warning', priority: 70,
      title: `⚙️ ${unconfigured.name} לא מוגדר עד הסוף`,
      body: 'בחר דף פייסבוק וחשבון מודעות כדי שתוכל לפרסם פוסטים ולבנות קמפיינים.',
      action_href: '/clients', action_label: 'הגדר',
    });
  }

  // ─────────── LOW CREDITS ───────────
  if (cred < 30 && cred >= 0) {
    recs.push({
      kind: 'warning', priority: 90,
      title: '⚠️ קרדיטים נמוכים',
      body: `נשארו לך ${cred} קרדיטים. שדרג תוכנית או קנה טעינה חד פעמית כדי לא להפסיק באמצע.`,
      action_href: '/credits', action_label: 'טען קרדיטים',
    });
  }

  // ─────────── ONBOARDING: NO CONTENT YET ───────────
  if (co.length === 0 && cl.length > 0) {
    recs.push({
      kind: 'quick_win', priority: 85,
      title: '🚀 נסה את "קמפיין בלחיצה"',
      body: 'במקום ליצור פוסטים אחד-אחד, תן ל-AI לבנות לך 3 גרסאות עם תמונות מתאימות בבת אחת.',
      action_href: '/quick-campaign', action_label: 'נסה עכשיו',
    });
  }

  // ─────────── FAVORITES UNUSED ───────────
  if (co.length > 10 && co.filter(c => c.favorite).length === 0) {
    recs.push({
      kind: 'tip', priority: 30,
      title: '⭐ סמן מועדפים בספריית המודעות',
      body: 'יצרת הרבה תוכן — סמן את הטוב ביותר כמועדפים כדי למצוא אותם בלחיצה.',
      action_href: '/library', action_label: 'פתח ספרייה',
    });
  }

  // ─────────── LANDING PAGE TIPS ───────────
  if (lp.length === 0 && cl.length > 0) {
    recs.push({
      kind: 'growth', priority: 60,
      title: '📄 צור דף נחיתה ראשון',
      body: 'דפי הנחיתה ב-AdMaster מומרים פי 2 מאתרים רגילים. 6 templates מוכנים לבחירה.',
      action_href: '/landing-pages', action_label: 'בחר template',
    });
  }

  const publishedLP = lp.filter(l => l.status === 'published');
  if (publishedLP.length > 0) {
    const totalViews = publishedLP.reduce((s, l) => s + (l.views ?? 0), 0);
    const totalConv  = publishedLP.reduce((s, l) => s + (l.conversions ?? 0), 0);
    if (totalViews > 100 && totalConv === 0) {
      recs.push({
        kind: 'warning', priority: 75,
        title: '📉 דף נחיתה לא ממיר',
        body: `${totalViews} צפיות, 0 לידים. כדאי לנתח ולשפר את הhook או ה-CTA.`,
        action_href: '/landing-pages', action_label: 'בדוק דפים',
      });
    }
    if (totalViews > 50 && totalConv > 0) {
      const cr = (totalConv / totalViews * 100).toFixed(1);
      recs.push({
        kind: 'tip', priority: 20,
        title: `📈 שיעור המרה: ${cr}%`,
        body: `הדפים שלך מביאים תוצאות. שקול לנסות variant נוסף ולעשות A/B test.`,
        action_href: '/landing-pages', action_label: 'צור variant',
      });
    }
  }

  // ─────────── APPROVALS PENDING ───────────
  const pending = ap.filter(a => a.status === 'pending');
  if (pending.length >= 3) {
    recs.push({
      kind: 'warning', priority: 65,
      title: `⏳ ${pending.length} בקשות אישור פתוחות`,
      body: 'יש בקשות שעדיין לא קיבלו תשובה. שקול לשלוח תזכורת ללקוחות.',
      action_href: '/approvals', action_label: 'בדוק',
    });
  }

  // ─────────── FREE PLAN UPGRADE ───────────
  if (plan === 'free' && accountAge > 14) {
    recs.push({
      kind: 'growth', priority: 50,
      title: '💎 הגיע הזמן לשדרג',
      body: 'אתה כבר שבועיים במערכת. Pro פותח Email/SMS/WhatsApp, פרסום ישיר ל-Meta, ועוד.',
      action_href: '/credits', action_label: 'ראה תוכניות',
    });
  }

  // ─────────── SERIES INACTIVE ───────────
  if (ser.length === 0 && cl.length > 0 && plan !== 'free') {
    recs.push({
      kind: 'growth', priority: 40,
      title: '🗓 בנה סדרת הודעות',
      body: 'סדרת מסרים אוטומטית יכולה להחזיר 20-30% מהלידים שירדו מהמסלול.',
      action_href: '/series', action_label: 'בנה סדרה',
    });
  }

  // ─────────── LEADS WAITING ───────────
  const recentLeads = leads.filter(l => {
    const age = Date.now() - new Date(l.created_at).getTime();
    return age < 48 * 60 * 60 * 1000; // 48h
  });
  if (recentLeads.length > 0) {
    recs.push({
      kind: 'quick_win', priority: 95,
      title: `🔥 ${recentLeads.length} לידים חדשים — חם!`,
      body: 'לידים שנענים בתוך 48 שעות ממירים פי 7. בדוק עכשיו.',
      action_href: '/landing-pages', action_label: 'בדוק לידים',
    });
  }

  // ─────────── TIPS BASED ON USAGE ───────────
  const postsCount = co.filter(c => c.type === 'post' || c.type === 'campaign').length;
  if (postsCount > 5 && co.filter(c => c.type === 'variations').length === 0) {
    recs.push({
      kind: 'tip', priority: 25,
      title: '🔀 נסה מחולל וריאציות',
      body: 'אם פוסט עבד טוב — תן ל-AI ליצור 5 variants עם hooks שונים כדי לבדוק מה הכי ממיר.',
      action_href: '/variations', action_label: 'נסה',
    });
  }

  if (postsCount > 3 && co.filter(c => c.type === 'analyze').length === 0) {
    recs.push({
      kind: 'tip', priority: 22,
      title: '🔬 נתח מודעה ותקבל ציון',
      body: 'בדוק מה הציון של המודעה שלך לפני שאתה מוציא כסף על פרסום.',
      action_href: '/analyze', action_label: 'נתח',
    });
  }

  // Filter out dismissed, sort by priority
  return NextResponse.json(
    recs
      .filter(r => !dismissed.has(r.title))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 6)
  );
}

// POST /api/recommendations — dismiss a recommendation (by title)
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { title, kind } = await req.json();
  if (!title) return NextResponse.json({ error: 'Missing title' }, { status: 400 });

  await supabase.from('recommendations').insert({
    user_id: user.id, title, kind: kind ?? 'tip', dismissed: true,
  });
  return NextResponse.json({ ok: true });
}
