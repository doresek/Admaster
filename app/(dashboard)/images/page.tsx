'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardLabel, Textarea, Btn, Alert, PageHeader, CostBadge } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import { CREDIT_COSTS, type ImagenAspectRatio } from '@/types';
import { clsx } from 'clsx';

const STYLES = [
  { id: 'REALISTIC',    label: 'ריאליסטי',    emoji: '📷' },
  { id: 'DESIGN',       label: 'עיצוב',       emoji: '🎨' },
  { id: 'ILLUSTRATION', label: 'איור',        emoji: '✏️' },
  { id: 'RENDER_3D',    label: '3D',          emoji: '🎭' },
];

const RATIOS: { id: ImagenAspectRatio; label: string; sub: string; w: number; h: number }[] = [
  { id: 'ASPECT_1_1',  label: '1:1',  sub: 'פוסט',      w: 60, h: 60 },
  { id: 'ASPECT_4_5',  label: '4:5',  sub: 'Instagram', w: 56, h: 70 },
  { id: 'ASPECT_3_4',  label: '3:4',  sub: 'פורטרט',    w: 54, h: 72 },
  { id: 'ASPECT_9_16', label: '9:16', sub: 'סטורי',     w: 45, h: 80 },
  { id: 'ASPECT_4_3',  label: '4:3',  sub: 'לנדסקייפ',  w: 72, h: 54 },
  { id: 'ASPECT_16_9', label: '16:9', sub: 'נוף',       w: 80, h: 45 },
];

export default function ImagesPage() {
  const searchParams = useSearchParams();
  const briefId = searchParams.get('briefId');

  const [prompt,  setPrompt]  = useState('');
  const [style,   setStyle]   = useState('REALISTIC');
  const [ratio,   setRatio]   = useState<ImagenAspectRatio>('ASPECT_1_1');
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [error,   setError]   = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const { call } = useAI();

  useEffect(() => {
    const url = briefId ? `/api/images?briefId=${briefId}` : '/api/images';
    fetch(url).then(r => r.json()).then(d => setHistory(Array.isArray(d) ? d : []));
  }, [briefId]);

  async function enhancePrompt() {
    if (!prompt.trim()) return;
    setLoading(true);
    const enhanced = await call('post',
      `אתה מומחה בכתיבת prompts לכלי יצירת תמונות AI (Imagen, Midjourney).
קח את הבריף בעברית וכתוב prompt מפורט באנגלית שיפיק תמונה מקצועית לשיווק.
כלול: composition, lighting, mood, colors, style.
החזר רק את ה-prompt, ללא הסבר.`,
      `בריף: ${prompt}`, 300);
    if (enhanced) setPrompt(enhanced);
    setLoading(false);
  }

  async function generate() {
    if (!prompt.trim()) return;
    setLoading(true); setError(''); setCurrent(null);

    try {
      const res = await fetch('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, style, aspectRatio: ratio, briefId }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'insufficient_credits') {
          throw new Error(`אין מספיק קרדיטים (נדרש ${CREDIT_COSTS.image})`);
        }
        throw new Error(data.error || 'שגיאה בייצור תמונה');
      }

      setCurrent(data.url);
      setHistory(p => [
        { image_url: data.url, prompt, created_at: new Date().toISOString() },
        ...p.slice(0, 19),
      ]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="AI Images"
        title="מחולל תמונות"
        sub={briefId ? 'Imagen 3 · מקושר לבריף' : 'Imagen 3 · עיצובים לפוסטים ומודעות'}
        right={<CostBadge cost={CREDIT_COSTS.image} />}
      />

      <div className="grid grid-cols-2 gap-4">
        {/* Left — controls */}
        <div>
          <Card className="mb-3">
            <CardLabel>סגנון</CardLabel>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {STYLES.map(s => (
                <button key={s.id} onClick={() => setStyle(s.id)}
                  className={clsx(
                    'flex flex-col items-center gap-1 p-3 rounded-lg border text-xs font-medium transition-all',
                    style === s.id
                      ? 'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]'
                      : 'border-[#1E2F42] bg-[#162030] text-[#6B8FA8] hover:border-[#2A4158]',
                  )}>
                  <span className="text-xl">{s.emoji}</span>{s.label}
                </button>
              ))}
            </div>

            <CardLabel>יחס תמונה</CardLabel>
            <div className="grid grid-cols-6 gap-2 mb-2">
              {RATIOS.map(r => (
                <button key={r.id} onClick={() => setRatio(r.id)}
                  className={clsx(
                    'flex flex-col items-center gap-2 p-2 rounded-lg border transition-all',
                    ratio === r.id ? 'border-[#0A7AFF] bg-[#0A7AFF]/12' : 'border-[#1E2F42] bg-[#162030] hover:border-[#2A4158]',
                  )}>
                  <div className="rounded" style={{ width: r.w / 4, height: r.h / 4, background: ratio === r.id ? '#0A7AFF' : '#2A4158' }} />
                  <div className="text-[10px] font-bold text-[#D9E8F5]">{r.label}</div>
                  <div className="text-[10px] text-[#2E4459]">{r.sub}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="mb-3">
            <CardLabel>תיאור / Prompt</CardLabel>
            <Textarea value={prompt} onChange={setPrompt}
              placeholder="תאר את התמונה שאתה רוצה... לדוגמה: זוג מקיים מצוות תפילין בבית כנסת ירושלמי, אור זהוב, אווירה רוחנית"
              rows={4} />
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" loading={loading} onClick={enhancePrompt} disabled={!prompt.trim()}>
                ✨ שפר Prompt עם AI
              </Btn>
            </div>
          </Card>

          <Btn variant="primary" full loading={loading} onClick={generate} disabled={!prompt.trim()}>
            🎨 צור תמונה
          </Btn>
          {error && (
            <div className="mt-3">
              <Alert type="red">❌ {error}</Alert>
            </div>
          )}

          {error?.includes('GOOGLE_AI_API_KEY') && (
            <div className="mt-2">
              <Alert type="amber">
                💡 הוסף <code>GOOGLE_AI_API_KEY</code> ל-.env.local — השג מ-<a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-bold underline">aistudio.google.com/apikey</a>
              </Alert>
            </div>
          )}
        </div>

        {/* Right — output */}
        <div>
          {current ? (
            <div>
              <div className="rounded-xl overflow-hidden border border-[#2A4158] mb-3">
                <img src={current} alt="Generated" className="w-full" />
              </div>
              <div className="flex gap-2">
                <a href={current} download="admaster-image.png" target="_blank" rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-semibold rounded-lg transition-colors">
                  ⬇️ הורד
                </a>
                <Btn variant="ghost" onClick={generate} loading={loading} size="sm">🔄 עוד גרסה</Btn>
              </div>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center h-72 gap-4">
              <div className="w-12 h-12 border-2 border-[#0A7AFF]/20 border-t-[#0A7AFF] rounded-full animate-spin" />
              <div className="text-sm text-[#6B8FA8]">מייצר תמונה...</div>
              <div className="text-xs text-[#2E4459]">זה לוקח ~10-20 שניות</div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <span className="text-5xl mb-3 opacity-30">🎨</span>
              <span className="text-sm">הזן תיאור ולחץ "צור תמונה"</span>
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-bold text-[#2E4459] uppercase tracking-wider mb-3">
                {briefId ? 'תמונות לבריף הזה' : 'תמונות אחרונות'}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {history.slice(0, 6).map((img, i) => (
                  <div key={i} className="rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-[#0A7AFF] transition-all aspect-square"
                    onClick={() => setCurrent(img.image_url)}>
                    <img src={img.image_url} alt={img.prompt} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
