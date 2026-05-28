'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Btn, Alert, PageHeader, Input, Textarea, Chip, CostBadge, CopyBtn, Tabs } from '@/components/ui';
import { LANDING_TEMPLATES, TEMPLATES_BY_ID, type LandingTemplate, type LandingContent } from '@/lib/landing-templates';
import { clsx } from 'clsx';

interface LP {
  id:          string;
  slug:        string;
  title:       string;
  template:    LandingTemplate;
  content:     LandingContent;
  status:      'draft' | 'published' | 'archived';
  views:       number;
  conversions: number;
  created_at:  string;
  updated_at:  string;
}

export default function LandingPagesPage() {
  const [tab,       setTab]        = useState<'list' | 'create'>('list');
  const [pages,     setPages]      = useState<LP[]>([]);
  const [selT,      setSelT]       = useState<LandingTemplate>('squeeze');
  const [title,     setTitle]      = useState('');
  const [brief,     setBrief]      = useState('');
  const [creating,  setCreating]   = useState(false);
  const [error,     setError]      = useState('');
  const [newLink,   setNewLink]    = useState<{ url: string; id: string } | null>(null);
  // Image upload state
  const [heroImage, setHeroImage] = useState<string>('');       // URL once uploaded
  const [imageKind, setImageKind] = useState<'product' | 'portrait' | 'logo' | 'lifestyle' | 'other'>('product');
  const [uploading, setUploading] = useState(false);
  // Auto-bg image
  const [autoBg,    setAutoBg]    = useState(true);   // generate background image with AI if no upload
  // Focus questions
  const [audience,  setAudience]  = useState('');
  const [emotion,   setEmotion]   = useState('');
  const supabase = createClient();

  async function uploadImage(file: File) {
    setUploading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/landing/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה בהעלאה');
      setHeroImage(data.url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function load() {
    const res = await fetch('/api/landing');
    const data = await res.json();
    setPages(Array.isArray(data) ? data : []);
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!title.trim() || !brief.trim()) return;
    setCreating(true); setError(''); setNewLink(null);

    try {
      // ALWAYS run AI — template-only mode caused mismatched defaults (bakery → marketing agency content).
      const genRes  = await fetch('/api/landing/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: selT,
          brief,
          ...(heroImage ? { hero_image: heroImage, image_kind: imageKind } : {}),
          ...(audience.trim() ? { target_audience: audience.trim() } : {}),
          ...(emotion.trim()  ? { target_emotion:  emotion.trim()  } : {}),
          auto_bg: !heroImage && autoBg,  // generate bg image only if no upload AND opted in
        }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error || 'שגיאה ביצירה');
      const content = genData.content;

      const res  = await fetch('/api/landing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: selT, title, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה ביצירה');

      const url = `${window.location.origin}/lp/${data.slug}`;
      setNewLink({ url, id: data.id });
      setPages(p => [data, ...p]);
      setTitle(''); setBrief(''); setHeroImage(''); setAudience(''); setEmotion('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function publish(id: string, current: 'draft' | 'published' | 'archived') {
    const next = current === 'published' ? 'draft' : 'published';
    const res  = await fetch(`/api/landing?id=${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: next }),
    });
    if (res.ok) {
      const d = await res.json();
      setPages(p => p.map(x => x.id === id ? d : x));
    }
  }

  async function remove(id: string) {
    if (!confirm('למחוק את הדף?')) return;
    await fetch(`/api/landing?id=${id}`, { method: 'DELETE' });
    setPages(p => p.filter(x => x.id !== id));
  }

  const selDef = TEMPLATES_BY_ID[selT];

  return (
    <div>
      <PageHeader
        eyebrow="Landing Pages"
        title="דפי נחיתה"
        sub="6 templates מוכנים + יצירה מ-AI"
        right={<CostBadge cost={5} />}
      />

      <Tabs tabs={[{id:'list',label:`📚 שלי (${pages.length})`},{id:'create',label:'+ דף חדש'}]} active={tab} onChange={t => setTab(t as any)} />

      {tab === 'list' && (
        <div>
          {pages.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <div className="text-4xl mb-3 opacity-30">📄</div>
              <div className="text-base font-semibold mb-2">עוד אין דפי נחיתה</div>
              <Btn variant="primary" onClick={() => setTab('create')}>+ צור דף ראשון</Btn>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {pages.map(p => {
                const def = TEMPLATES_BY_ID[p.template] ?? TEMPLATES_BY_ID.squeeze;
                const url = typeof window !== 'undefined' ? `${window.location.origin}/lp/${p.slug}` : `/lp/${p.slug}`;
                return (
                  <div key={p.id} className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg">{def.emoji}</span>
                          <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full',
                            p.status === 'published' ? 'bg-[#059669]/15 text-[#34D399]' :
                            p.status === 'archived'  ? 'bg-[#6B8FA8]/15 text-[#6B8FA8]' :
                            'bg-[#D97706]/15 text-[#D97706]')}>
                            {p.status === 'published' ? 'פורסם' : p.status === 'archived' ? 'בארכיון' : 'טיוטה'}
                          </span>
                        </div>
                        <div className="font-bold text-[#D9E8F5] truncate">{p.title}</div>
                        <div className="text-[10px] text-[#2E4459] mt-0.5">{def.name}</div>
                      </div>
                      <button onClick={() => remove(p.id)} className="text-[#2E4459] hover:text-red-400 text-xs">✕</button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-3 text-[11px]">
                      <div className="bg-[#162030] rounded px-2 py-1.5">
                        <div className="text-[10px] text-[#2E4459]">צפיות</div>
                        <div className="font-mono text-sm text-[#D9E8F5]">{p.views}</div>
                      </div>
                      <div className="bg-[#162030] rounded px-2 py-1.5">
                        <div className="text-[10px] text-[#2E4459]">המרות</div>
                        <div className="font-mono text-sm text-[#34D399]">{p.conversions}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/landing-pages/edit/${p.id}`}
                        className="text-[11px] font-bold px-3 py-1.5 bg-[#0A7AFF] text-white rounded-lg hover:bg-[#3D9FFF] transition-colors">
                        ✏️ ערוך
                      </Link>
                      <Btn variant={p.status === 'published' ? 'ghost' : 'green'} size="sm" onClick={() => publish(p.id, p.status)}>
                        {p.status === 'published' ? '⏸ הסר פרסום' : '🚀 פרסם'}
                      </Btn>
                      {p.status === 'published' && (
                        <Link href={url} target="_blank" className="text-[11px] text-[#3D9FFF] hover:underline">פתח ↗</Link>
                      )}
                      <div className="ms-auto"><CopyBtn text={url} label="🔗" /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'create' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Card className="mb-3">
              <CardLabel>בחר template</CardLabel>
              <div className="grid grid-cols-2 gap-2">
                {LANDING_TEMPLATES.map(t => (
                  <button key={t.id} onClick={() => setSelT(t.id)}
                    className={clsx('text-right p-3 rounded-lg border transition-all',
                      selT === t.id ? 'border-[#0A7AFF] bg-[#0A7AFF]/10' : 'border-[#1E2F42] bg-[#162030] hover:border-[#2A4158]')}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{t.emoji}</span>
                      <span className="font-semibold text-sm text-[#D9E8F5]">{t.name.split('—')[0].trim()}</span>
                    </div>
                    <div className="text-[11px] text-[#6B8FA8] leading-relaxed">{t.tagline}</div>
                  </button>
                ))}
              </div>
            </Card>

            <Card className="mb-3">
              <CardLabel>פרטי הדף</CardLabel>
              <Input label="שם הדף" value={title} onChange={setTitle} placeholder="לדוגמה: השקת קורס Q3" />
              <Textarea label={<>בריף לעסק <span className="text-red-400">*</span></> as any} value={brief} onChange={setBrief}
                placeholder="תאר במדויק: התחום (מאפייה / יוגה / עורך דין / מסעדה...), הקהל, ההצעה, מה מייחד. ככל שתפרט — כך ה-AI יבנה דף ספציפי לעסק."
                rows={5} />
              <div className="text-[10px] text-[#34D399] bg-[#059669]/10 border border-[#059669]/20 rounded px-3 py-2">
                ✨ כל דף נבנה מ-AI עם שילוב של 2 design skills (ui-ux-pro-max + frontend-design). הצבעים, הטיפוגרפיה והעיצוב נבחרים אוטומטית לפי תחום העסק.
              </div>
            </Card>

            {/* Focus questions — optional but improve quality dramatically */}
            <Card className="mb-3">
              <CardLabel>🎯 התאמה אישית מעמיקה (אופציונלי)</CardLabel>
              <Input
                label="מי הלקוח הסופי? (גיל, מגדר, אופי, מצב)"
                value={audience} onChange={setAudience}
                placeholder="לדוגמה: זוגות אורתודוקסים 25-35 שמתחתנים בקיץ, יוקרתיים, אוהבי קינוחים"
              />
              <Input
                label="איזו תחושה לעורר ברגע שהלקוח נכנס?"
                value={emotion} onChange={setEmotion}
                placeholder="לדוגמה: רעב, נוסטלגיה לסבתא, יוקרה ביתית, חוויה רוחנית"
              />
              <div className="text-[10px] text-[#6B8FA8] mt-1">
                ככל שתמלא — ה-AI יבחר palette ו-tone שיתאימו רגשית לקהל.
              </div>
            </Card>

            {/* Hero image upload */}
            <Card className="mb-3">
              <CardLabel>תמונה ראשית</CardLabel>
              {!heroImage && (
                <label className="flex items-center gap-2 bg-[#D4AF55]/10 border border-[#D4AF55]/30 rounded-lg px-3 py-2 mb-3 cursor-pointer hover:bg-[#D4AF55]/15">
                  <input type="checkbox" checked={autoBg} onChange={e => setAutoBg(e.target.checked)} className="w-4 h-4" />
                  <span className="text-sm text-[#D4AF55] font-semibold">🎨 ייצר תמונת רקע אוטומטית עם AI (Ideogram)</span>
                </label>
              )}
              {heroImage ? (
                <div className="space-y-2">
                  <div className="relative rounded-lg overflow-hidden border border-[#2A4158] aspect-video bg-[#162030]">
                    <img src={heroImage} alt="hero" className="w-full h-full object-contain" />
                    <button onClick={() => setHeroImage('')}
                            className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/70 text-white text-xs hover:bg-red-600">
                      ✕
                    </button>
                  </div>
                  <div className="text-[10px] font-bold text-[#2E4459] uppercase mt-3 mb-1.5">סוג התמונה (עוזר ל-AI לעצב סביבה)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: 'product',   label: '📦 מוצר'           },
                      { id: 'portrait',  label: '👤 דמות/Presenter' },
                      { id: 'logo',      label: '🏷 לוגו'           },
                      { id: 'lifestyle', label: '🌅 Lifestyle'      },
                      { id: 'other',     label: '🖼 אחר'            },
                    ].map(k => (
                      <Chip key={k.id} label={k.label}
                            active={imageKind === k.id}
                            onClick={() => setImageKind(k.id as any)} />
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="lp-image-upload" className={clsx(
                    'flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg py-8 px-4 cursor-pointer transition-colors',
                    uploading
                      ? 'border-[#0A7AFF] bg-[#0A7AFF]/5 cursor-wait'
                      : 'border-[#2A4158] hover:border-[#3D9FFF] hover:bg-[#162030]'
                  )}>
                    {uploading ? (
                      <>
                        <div className="w-6 h-6 border-2 border-[#3D9FFF]/30 border-t-[#3D9FFF] rounded-full animate-spin" />
                        <span className="text-xs text-[#6B8FA8]">מעלה...</span>
                      </>
                    ) : (
                      <>
                        <span className="text-3xl opacity-50">📤</span>
                        <span className="text-sm text-[#D9E8F5] font-medium">העלה תמונה</span>
                        <span className="text-[10px] text-[#2E4459]">PNG, JPG, WEBP — עד 5MB</span>
                      </>
                    )}
                  </label>
                  <input
                    id="lp-image-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) uploadImage(f);
                    }}
                    disabled={uploading}
                  />
                  <div className="text-[10px] text-[#2E4459] mt-2 text-center">
                    🪄 ללא תמונה? ה-AI ישתמש ב-emoji + gradient mesh
                  </div>
                </div>
              )}
            </Card>

            <Btn variant="primary" full loading={creating} onClick={create} disabled={!title.trim() || !brief.trim()}>
              🪄 צור דף עם AI (5⚡)
            </Btn>
            {error && <Alert type="red">❌ {error}</Alert>}

            {newLink && (
              <Card className="mt-3" style={{borderColor: 'rgba(184,149,58,.3)'}}>
                <CardLabel>✨ הדף נוצר!</CardLabel>
                <div className="flex items-center justify-between bg-[#070A0E] border border-[#2A4158] rounded-lg px-3 py-2 mb-2">
                  <span className="text-[11px] font-mono text-[#D4AF55] truncate flex-1" dir="ltr">{newLink.url}</span>
                  <CopyBtn text={newLink.url} label="📋" />
                </div>
                <Alert type="amber">💡 הדף עדיין בטיוטה — לחץ "פרסם" ברשימה כדי להפעיל אותו</Alert>
              </Card>
            )}
          </div>

          <div>
            <div className="text-xs font-bold text-[#2E4459] uppercase tracking-wider mb-3">תצוגה מקדימה של המבנה</div>
            <Card>
              <div className="text-base font-bold text-[#D9E8F5] mb-2">
                {selDef.emoji} {selDef.name}
              </div>
              <div className="text-xs text-[#6B8FA8] mb-4 leading-relaxed">{selDef.description}</div>

              <CardLabel>סקציות בדף</CardLabel>
              <div className="space-y-1.5">
                {selDef.sections.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 bg-[#162030] rounded px-3 py-2">
                    <span className="text-[#3D9FFF] font-mono text-xs">{i+1}</span>
                    <span className="text-[12.5px] text-[#D9E8F5] capitalize">{s.replace('_',' ')}</span>
                  </div>
                ))}
              </div>

              <CardLabel>
                <span style={{marginTop: 16, display: 'inline-block'}}>שדות בטופס ברירת מחדל</span>
              </CardLabel>
              <div className="flex flex-wrap gap-1.5">
                {selDef.defaultContent.form_fields.map(f => (
                  <span key={f.name} className="text-[11px] bg-[#1D2D3E] text-[#6B8FA8] px-2 py-0.5 rounded-full">
                    {f.label} {f.required && '*'}
                  </span>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
