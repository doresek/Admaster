'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardLabel, Textarea, Btn, Alert, PageHeader, Chip, CostBadge } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import { clsx } from 'clsx';

const PROVIDERS = [
  { id:'gemini',   label:'Gemini Nano Banana', sub:'Google · מומלץ', emoji:'🍌' },
  { id:'ideogram', label:'Ideogram V2',         sub:'טקסט מדויק',     emoji:'🎨' },
];

const STYLES = [
  { id:'REALISTIC',    label:'ריאליסטי',    emoji:'📷' },
  { id:'DESIGN',       label:'עיצוב',       emoji:'🎨' },
  { id:'ILLUSTRATION', label:'איור',        emoji:'✏️' },
  { id:'RENDER_3D',    label:'3D',          emoji:'🎭' },
];

const RATIOS = [
  { id:'ASPECT_1_1',  label:'1:1',    sub:'פוסט',     w:64, h:64 },
  { id:'ASPECT_16_9', label:'16:9',   sub:'נוף',      w:80, h:45 },
  { id:'ASPECT_9_16', label:'9:16',   sub:'סטורי',    w:45, h:80 },
  { id:'ASPECT_4_5',  label:'4:5',    sub:'Instagram', w:56, h:70 },
];

const PROMPT_FROM_AD_SYSTEM = `אתה Art Director לקמפיינים שיווקיים. קבלת טקסט של מודעה/פוסט שיווקי.
תפקידך: לזקק את המסר העיקרי, להבין למי הוא מדבר, ולכתוב prompt לכלי יצירת תמונות AI שיניב תמונה שיווקית שמגדילה את ה-CTR של המודעה.

עקרונות:
1. אל תתרגם מילולית — בנה סצנה ויזואלית שמדברת לרגש.
2. בחר subject ברור (אדם / מוצר / סיטואציה) שיתאים לקהל.
3. כלול: composition, lighting, mood, colors, camera angle, style.
4. סגנון: מודרני, מקצועי, מתאים ל-Meta/Instagram.
5. ללא טקסט בתמונה אלא אם המודעה דורשת זאת מפורשות.

החזר רק את ה-prompt באנגלית, ללא הסבר, ללא הקדמה.`;

const PROMPT_ENHANCE_SYSTEM = `אתה מומחה בכתיבת prompts לכלי יצירת תמונות AI (Gemini, Ideogram, Midjourney).
קח את הבריף הקצר בעברית והרחב אותו ל-prompt מפורט באנגלית שמפיק תמונה שיווקית מקצועית.
כלול: composition, lighting, mood, colors, camera angle, style, atmosphere.
החזר רק את ה-prompt, ללא הסבר.`;

export default function ImagesPage() {
  const [prompt,    setPrompt]   = useState('');
  const [adCopy,    setAdCopy]   = useState('');
  const [provider,  setProvider] = useState<'gemini'|'ideogram'>('gemini');
  const [style,     setStyle]    = useState('REALISTIC');
  const [ratio,     setRatio]    = useState('ASPECT_1_1');
  const [loading,   setLoading]  = useState(false);
  const [stage,     setStage]    = useState('');
  const [images,    setImages]   = useState<any[]>([]);
  const [current,   setCurrent]  = useState<string|null>(null);
  const [currentId, setCurrentId] = useState<string|null>(null);
  const [error,     setError]    = useState('');
  const [history,   setHistory]  = useState<any[]>([]);
  // edit modal
  const [editOpen,  setEditOpen]  = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  // build-from-ad section
  const [adOpen, setAdOpen] = useState(false);
  const { call }    = useAI();
  const searchParams = useSearchParams();

  useEffect(() => {
    fetch('/api/images').then(r=>r.json()).then(d=>setHistory(Array.isArray(d)?d:[]));
  }, []);

  // Prefill prompt from ?prompt=... (e.g. when arriving from /create).
  useEffect(() => {
    const incoming = searchParams?.get('prompt');
    if (!incoming) return;
    setPrompt(incoming);
    // Clear the query param so reloads don't keep re-injecting it.
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('prompt');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams]);

  async function enhancePrompt() {
    if (!prompt.trim()) return;
    setLoading(true); setStage('משפר prompt עם Claude…');
    const enhanced = await call('post', PROMPT_ENHANCE_SYSTEM, `בריף: ${prompt}`, 400);
    if (enhanced) setPrompt(enhanced);
    setLoading(false); setStage('');
  }

  /** Take ad copy → derive image prompt via Claude → generate image automatically. */
  async function buildFromAd() {
    if (!adCopy.trim() || loading) return;
    setLoading(true); setError(''); setStage('מנתח את המודעה ובונה prompt…');
    try {
      const generated = await call('post', PROMPT_FROM_AD_SYSTEM, `מודעה:\n${adCopy}`, 500);
      if (!generated) throw new Error('Claude לא החזיר prompt');
      setPrompt(generated);
      setStage('מייצר תמונה לפי ה-prompt…');
      await generateInternal(generated);
    } catch (e: any) {
      setError(e.message); setLoading(false); setStage('');
    }
  }

  async function generateInternal(promptText: string) {
    setCurrent(null); setCurrentId(null);
    try {
      const res = await fetch('/api/images', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ prompt: promptText, style, aspectRatio: ratio, provider }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.refunded
          ? `${data.error} — ${data.refunded}⚡ הוחזרו לחשבונך`
          : data.error || 'שגיאה בייצור תמונה';
        throw new Error(msg);
      }
      setCurrent(data.url);
      if (data.notice) setError(`ℹ️ ${data.notice}`);
      else if (data.warning) setError(`⚠️ ${data.warning}`);
      setImages(p => [{ url: data.url, prompt: promptText, style, ratio, createdAt: new Date().toISOString() }, ...p]);
      setHistory(p => [{ image_url: data.url, prompt: promptText, created_at: new Date().toISOString() }, ...p.slice(0,19)]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false); setStage('');
    }
  }

  async function generate() {
    if (!prompt.trim() || loading) return;
    setLoading(true); setError(''); setStage('מייצר תמונה…');
    await generateInternal(prompt);
  }

  async function runEdit() {
    if (!current || !editPrompt.trim() || loading) return;
    setLoading(true); setError(''); setStage('מבצע עריכה…');
    try {
      const res = await fetch('/api/images', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          mode: 'edit', parentImageId: currentId, parentImageUrl: current,
          editPrompt, aspectRatio: ratio, style, provider,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.refunded
          ? `${data.error} — ${data.refunded}⚡ הוחזרו לחשבונך`
          : data.error || 'שגיאה בעריכה';
        throw new Error(msg);
      }
      setCurrent(data.url); setCurrentId(null);
      setHistory(p => [{ image_url: data.url, prompt: `[edit] ${editPrompt}`, created_at: new Date().toISOString() }, ...p.slice(0,19)]);
      setEditOpen(false); setEditPrompt('');
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); setStage(''); }
  }

  return (
    <div>
      <PageHeader eyebrow="AI Images" title="מחולל תמונות" sub="Gemini Nano Banana · Ideogram · עיצובים לפוסטים ומודעות"
        right={<CostBadge cost={3} />} />

      <div className="grid grid-cols-2 gap-4">
        {/* Left — controls */}
        <div>
          <Card className="mb-3">
            <CardLabel>מחולל</CardLabel>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {PROVIDERS.map(p => (
                <button key={p.id} onClick={() => setProvider(p.id as 'gemini'|'ideogram')}
                  className={clsx('flex flex-col items-start gap-0.5 p-3 rounded-lg border text-right transition-all',
                    provider===p.id ? 'border-[#0A7AFF] bg-[#0A7AFF]/12' : 'border-[#243752] bg-[#1A2A42] hover:border-[#324C6B]')}>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#D9E8F5]">
                    <span>{p.emoji}</span><span>{p.label}</span>
                  </div>
                  <div className="text-[10px] text-[#6B8FA8]">{p.sub}</div>
                </button>
              ))}
            </div>

            <CardLabel>סגנון</CardLabel>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {STYLES.map(s => (
                <button key={s.id} onClick={() => setStyle(s.id)}
                  className={clsx('flex flex-col items-center gap-1 p-3 rounded-lg border text-xs font-medium transition-all',
                    style===s.id ? 'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]' : 'border-[#243752] bg-[#1A2A42] text-[#6B8FA8] hover:border-[#324C6B]')}>
                  <span className="text-xl">{s.emoji}</span>{s.label}
                </button>
              ))}
            </div>

            <CardLabel>יחס תמונה</CardLabel>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {RATIOS.map(r => (
                <button key={r.id} onClick={() => setRatio(r.id)}
                  className={clsx('flex flex-col items-center gap-2 p-2 rounded-lg border transition-all',
                    ratio===r.id ? 'border-[#0A7AFF] bg-[#0A7AFF]/12' : 'border-[#243752] bg-[#1A2A42] hover:border-[#324C6B]')}>
                  <div className="rounded" style={{ width: r.w/4, height: r.h/4, background: ratio===r.id ? '#0A7AFF' : '#324C6B' }} />
                  <div className="text-[10px] font-bold text-[#D9E8F5]">{r.label}</div>
                  <div className="text-[10px] text-[#2E4459]">{r.sub}</div>
                </button>
              ))}
            </div>
          </Card>

          {/* Build-from-ad */}
          <Card className="mb-3">
            <button onClick={() => setAdOpen(o => !o)} className="w-full flex items-center justify-between text-right">
              <CardLabel>🎯 צור תמונה מהמודעה שלך</CardLabel>
              <span className="text-[#6B8FA8] text-sm">{adOpen ? '▾' : '▸'}</span>
            </button>
            {adOpen && (
              <div className="mt-2">
                <div className="text-[10px] text-[#6B8FA8] mb-2">
                  הדבק טקסט של מודעה/פוסט. ה-AI יזקק את הרעיון ויבנה prompt חכם לתמונה שתעלה את ה-CTR.
                </div>
                <Textarea value={adCopy} onChange={setAdCopy}
                  placeholder="לדוגמה: 'מאפיית בוטיק כשרה ירושלמית — עוגת מייפל מיוחדת לשבת, הזמן עכשיו עד 10 בבוקר ביום שישי...'"
                  rows={5} />
                <Btn variant="primary" full loading={loading} onClick={buildFromAd} disabled={!adCopy.trim()}>
                  🤖 הבן ובנה תמונה
                </Btn>
              </div>
            )}
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
          {error && <Alert type="red" className="mt-3">❌ {error}</Alert>}

          {error?.includes('GOOGLE_AI_API_KEY') && (
            <Alert type="amber" className="mt-2">
              💡 הוסף <code>GOOGLE_AI_API_KEY</code> ל-.env.local — <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-bold underline">aistudio.google.com</a>
            </Alert>
          )}
          {error?.includes('IDEOGRAM_API_KEY') && (
            <Alert type="amber" className="mt-2">
              💡 הוסף <code>IDEOGRAM_API_KEY</code> ל-.env.local — <a href="https://ideogram.ai" target="_blank" rel="noreferrer" className="font-bold underline">ideogram.ai</a>
            </Alert>
          )}
        </div>

        {/* Right — output */}
        <div>
          {current ? (
            <div>
              <div className="rounded-xl overflow-hidden border border-[#324C6B] mb-3">
                <img src={current} alt="Generated" className="w-full" />
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={current} download="admaster-image.jpg" target="_blank" rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-semibold rounded-lg transition-colors">
                  ⬇️ הורד
                </a>
                <Btn variant="ghost" onClick={() => { setEditOpen(true); setEditPrompt(''); }} size="sm">✏️ ערוך</Btn>
                <Btn variant="ghost" onClick={generate} loading={loading} size="sm">🔄 עוד גרסה</Btn>
              </div>

              {/* Format adapter */}
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {RATIOS.map(r => (
                  <button key={r.id}
                    onClick={async () => {
                      if (r.id === ratio) return;
                      setLoading(true); setError(''); setStage('מתאים יחס…');
                      try {
                        const res = await fetch('/api/images', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Idempotency-Key': crypto.randomUUID(),
                          },
                          body: JSON.stringify({
                            mode: 'adapt', parentImageId: currentId, parentImageUrl: current,
                            aspectRatio: r.id, style, provider,
                          }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error);
                        setCurrent(data.url); setRatio(r.id);
                        setHistory(p => [{ image_url: data.url, prompt: `[adapt ${r.label}]`, created_at: new Date().toISOString() }, ...p.slice(0,19)]);
                      } catch (e: any) { setError(e.message); }
                      finally { setLoading(false); setStage(''); }
                    }}
                    title={`התאם ל-${r.label} (1⚡)`}
                    className={clsx('py-1.5 text-[10px] font-bold rounded-lg border transition-all',
                      ratio===r.id ? 'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]' : 'border-[#243752] bg-[#1A2A42] text-[#6B8FA8] hover:border-[#324C6B]')}>
                    {r.label}
                  </button>
                ))}
              </div>

              {editOpen && (
                <div className="mt-3 border border-[#0A7AFF]/40 bg-[#0A7AFF]/5 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-bold text-[#3D9FFF]">✏️ עריכת תמונה (3⚡)</div>
                    <button onClick={() => setEditOpen(false)} className="text-[#2E4459] hover:text-white text-sm">✕</button>
                  </div>
                  <Textarea value={editPrompt} onChange={setEditPrompt}
                    placeholder="מה לשנות? לדוגמה: 'הוסף לוגו פינה שמאלית', 'שנה רקע לים', 'החלף צבע ל-teal'"
                    rows={3} />
                  <Btn variant="primary" full loading={loading} onClick={runEdit} disabled={!editPrompt.trim()}>
                    🪄 הפעל עריכה
                  </Btn>
                </div>
              )}
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center h-72 gap-4">
              <div className="w-12 h-12 border-2 border-[#0A7AFF]/20 border-t-[#0A7AFF] rounded-full animate-spin" />
              <div className="text-sm text-[#6B8FA8]">{stage || 'מייצר תמונה...'}</div>
              <div className="text-xs text-[#2E4459]">זה לוקח ~10-20 שניות</div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]">
              <span className="text-5xl mb-3 opacity-30">🎨</span>
              <span className="text-sm">הזן תיאור ולחץ "צור תמונה"</span>
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-bold text-[#2E4459] uppercase tracking-wider mb-3">תמונות אחרונות</div>
              <div className="grid grid-cols-3 gap-2">
                {history.slice(0,6).map((img, i) => (
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
