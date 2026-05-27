import Link from 'next/link';

export const metadata = { title: 'בלוג' };

const POSTS = [
  {
    slug: '8-frameworks',
    title: '8 ה-Frameworks שכל קופירייטר חייב להכיר',
    excerpt: 'PAS, AIDA, BAB, FAB — מתי להשתמש בכל אחד, ולמה זה משנה. עם דוגמאות מהשטח.',
    date: '2026-05-20',
    readTime: '6 דק',
  },
  {
    slug: 'meta-ads-2026',
    title: 'מה השתנה ב-Meta Ads ב-2026 (ואיך AI משנה את המשחק)',
    excerpt: 'CAPI, Advantage+, איסור על קהלים מותאמים אישית — מדריך מעודכן.',
    date: '2026-05-15',
    readTime: '8 דק',
  },
  {
    slug: 'avatar-hormozi',
    title: 'בניית אווטאר לקוח לפי Alex Hormozi',
    excerpt: 'הפורמט הקלאסי של Hormozi × Schwartz, ולמה הוא עובד יותר טוב מבריף רגיל.',
    date: '2026-05-08',
    readTime: '12 דק',
  },
  {
    slug: 'whatsapp-marketing',
    title: 'WhatsApp Marketing בעברית: מה עובד ב-2026',
    excerpt: 'מ-broadcast lists ל-Click-to-WhatsApp Ads — הטרנדים שצריך להכיר.',
    date: '2026-04-29',
    readTime: '5 דק',
  },
];

export default function BlogPage() {
  return (
    <div className="px-4 py-16 max-w-4xl mx-auto">
      <div className="text-center mb-12">
        <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-2">בלוג</div>
        <h1 className="text-4xl font-bold text-white mb-3" style={{ fontFamily: 'DM Serif Display,serif' }}>
          תובנות שיווק ו-AI
        </h1>
        <p className="text-[#6B8FA8]">מה שמשווקים ישראלים צריכים לדעת</p>
      </div>

      <div className="space-y-3">
        {POSTS.map(p => (
          <article key={p.slug} className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-5 hover:border-[#2A4158] transition-all">
            <Link href={`/blog/${p.slug}`} className="block">
              <h2 className="text-xl font-bold text-white mb-2 hover:text-[#3D9FFF] transition-colors">{p.title}</h2>
              <p className="text-[13.5px] text-[#6B8FA8] leading-relaxed mb-3">{p.excerpt}</p>
              <div className="flex items-center gap-3 text-[11px] text-[#2E4459]">
                <span>{new Date(p.date).toLocaleDateString('he')}</span>
                <span>·</span>
                <span>{p.readTime} קריאה</span>
              </div>
            </Link>
          </article>
        ))}
      </div>

      <div className="text-center mt-12 text-sm text-[#6B8FA8]">
        עוד פוסטים בקרוב...
      </div>
    </div>
  );
}
