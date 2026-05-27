'use client';
import { useState } from 'react';
import { Card, CardLabel, Btn, Textarea, Alert, PageHeader, CostBadge, Chip, CopyBtn } from '@/components/ui';

const PLATFORMS = [
  { id:'Facebook',  emoji:'📘' },
  { id:'Instagram', emoji:'📸' },
  { id:'TikTok',    emoji:'🎵' },
  { id:'WhatsApp',  emoji:'💬' },
];

interface Variant {
  framework:      string;
  framework_name: string;
  post:           string;
  hashtags:       string[];
  wa:             string;
  image_prompt:   string;
  image_url:      string | null;
}

export default function QuickCampaignPage() {
  const [brief,    setBrief]    = useState('');
  const [platform, setPlatform] = useState('Facebook');
  const [withImg,  setWithImg]  = useState(true);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [variants, setVariants] = useState<Variant[]>([]);

  async function generate() {
    if (!brief.trim()) return;
    setLoading(true); setError(''); setVariants([]);
    try {
      const res = await fetch('/api/quick-campaign', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ brief, platform, generateImage: withImg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      setVariants(data.variants || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Quick Campaign"
        title="🚀 צור קמפיין שלם"
        sub="3 גרסאות (PAS · AIDA · BAB) + תמונות מותאמות — בלחיצה אחת"
        right={<CostBadge cost={15} />}
      />

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <CardLabel>בריף לקמפיין</CardLabel>
          <Textarea value={brief} onChange={setBrief}
            placeholder="לדוגמה: השקת קורס דיגיטל ליועצי משכנתאות. קהל יעד: יועצים עם ניסיון 2+ שנים. הצעה: 90 ימי ליווי + 12 כלים מוכנים. מחיר: 1,997 ₪ (ערך 9,000)."
            rows={5} />
          <CardLabel>פלטפורמה</CardLabel>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {PLATFORMS.map(p => (
              <Chip key={p.id} label={`${p.emoji} ${p.id}`} active={platform===p.id} onClick={() => setPlatform(p.id)} />
            ))}
          </div>
          <CardLabel>אופציות</CardLabel>
          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input type="checkbox" checked={withImg} onChange={e => setWithImg(e.target.checked)}
              className="w-4 h-4 rounded" />
            <span className="text-sm text-[#D9E8F5]">🎨 ייצר גם תמונות AI עם Ideogram</span>
          </label>
          <Btn variant="primary" full loading={loading} onClick={generate} disabled={!brief.trim()}>
            🚀 צור קמפיין שלם
          </Btn>
          {error && <Alert type="red">❌ {error}</Alert>}
        </Card>

        <Card style={{borderColor: 'rgba(184,149,58,.3)'}}>
          <CardLabel>מה תקבל</CardLabel>
          <div className="space-y-2 text-[12.5px]">
            <div className="flex items-start gap-2"><span className="text-[#3D9FFF]">①</span><span>גרסת <strong>PAS</strong> — בעיה, החרפה, פתרון</span></div>
            <div className="flex items-start gap-2"><span className="text-[#3D9FFF]">②</span><span>גרסת <strong>AIDA</strong> — תשומת לב, עניין, רצון, פעולה</span></div>
            <div className="flex items-start gap-2"><span className="text-[#3D9FFF]">③</span><span>גרסת <strong>BAB</strong> — לפני, אחרי, גשר</span></div>
            <div className="border-t border-[#243752] my-2 pt-2 text-[#6B8FA8]">
              לכל גרסה: פוסט מלא + hashtags + גרסת WhatsApp + image prompt
              {withImg && <div className="mt-1 text-[#34D399]">+ תמונה AI שנוצרה ב-Ideogram</div>}
            </div>
          </div>
        </Card>
      </div>

      {loading && (
        <div className="flex flex-col items-center gap-4 py-16">
          <div className="w-10 h-10 border-2 border-[#0A7AFF]/20 border-t-[#0A7AFF] rounded-full animate-spin" />
          <div className="text-sm text-[#6B8FA8]">בונה 3 גרסאות{withImg ? ' + 3 תמונות' : ''}... ~30-60 שניות</div>
        </div>
      )}

      {variants.length > 0 && (
        <div>
          <div className="text-xs font-bold text-[#34D399] uppercase tracking-wider mb-3">✨ {variants.length} גרסאות נוצרו</div>
          <div className="grid md:grid-cols-3 gap-3">
            {variants.map((v, i) => (
              <div key={i} className="bg-[#152138] border border-[#243752] rounded-xl overflow-hidden flex flex-col">
                <div className="bg-gradient-to-r from-[#0A7AFF]/15 to-[#6D28D9]/10 px-4 py-2.5 border-b border-[#243752]">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-bold text-[#2E4459] uppercase">גרסה {i+1}</div>
                    <div className="text-xs font-bold text-[#3D9FFF]">{v.framework.toUpperCase()}</div>
                  </div>
                </div>

                {v.image_url && (
                  <img src={v.image_url} alt={`Variant ${i+1}`} className="w-full aspect-square object-cover border-b border-[#243752]" />
                )}

                <div className="p-4 flex-1 flex flex-col gap-3">
                  <div>
                    <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">פוסט</div>
                    <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-[#D9E8F5] line-clamp-[10]">{v.post}</div>
                  </div>

                  {v.hashtags.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">hashtags</div>
                      <div className="flex flex-wrap gap-1">
                        {v.hashtags.slice(0, 6).map((h, j) => (
                          <span key={j} className="text-[10px] bg-[#0A7AFF]/10 border border-[#0A7AFF]/20 text-[#3D9FFF] px-1.5 py-0.5 rounded">{h}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-auto flex gap-1.5">
                    <CopyBtn text={v.post + '\n\n' + v.hashtags.join(' ')} label="📋 פוסט" />
                    {v.image_url && <a href={v.image_url} target="_blank" rel="noreferrer" className="text-[11px] text-[#3D9FFF] hover:underline self-center">📥 תמונה</a>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
