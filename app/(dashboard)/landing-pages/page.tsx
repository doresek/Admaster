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
  const [mode,      setMode]       = useState<'template' | 'ai'>('template');
  const [title,     setTitle]      = useState('');
  const [brief,     setBrief]      = useState('');
  const [creating,  setCreating]   = useState(false);
  const [error,     setError]      = useState('');
  const [newLink,   setNewLink]    = useState<{ url: string; id: string } | null>(null);
  const supabase = createClient();

  async function load() {
    const res = await fetch('/api/landing');
    const data = await res.json();
    setPages(Array.isArray(data) ? data : []);
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!title.trim()) return;
    setCreating(true); setError(''); setNewLink(null);

    try {
      let content: LandingContent | undefined;
      if (mode === 'ai') {
        if (!brief.trim()) { setError('הזן בריף ליצירת AI'); setCreating(false); return; }
        const genRes  = await fetch('/api/landing/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template: selT, brief }),
        });
        const genData = await genRes.json();
        if (!genRes.ok) throw new Error(genData.error || 'שגיאה ביצירה');
        content = genData.content;
      }

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
      setTitle(''); setBrief('');
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
        right={mode === 'ai' ? <CostBadge cost={5} /> : <span className="text-[11px] text-[#34D399] font-bold bg-[#059669]/15 border border-[#059669]/30 px-2 py-0.5 rounded-full">⚡ template חינם</span>}
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

                    <div className="flex items-center gap-2">
                      <Btn variant={p.status === 'published' ? 'ghost' : 'primary'} size="sm" onClick={() => publish(p.id, p.status)}>
                        {p.status === 'published' ? '⏸ הסר פרסום' : '🚀 פרסם'}
                      </Btn>
                      {p.status === 'published' && (
                        <Link href={url} target="_blank" className="text-[11px] text-[#3D9FFF] hover:underline">פתח דף ↗</Link>
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
              <CardLabel>שיטת יצירה</CardLabel>
              <div className="flex gap-2 mb-3">
                <Chip label="📋 מטמפלייט (חינם)" active={mode==='template'} onClick={() => setMode('template')} />
                <Chip label="🪄 צור עם AI" active={mode==='ai'} onClick={() => setMode('ai')} />
              </div>
              <Input label="שם הדף" value={title} onChange={setTitle} placeholder="לדוגמה: השקת קורס Q3" />
              {mode === 'ai' && (
                <Textarea label="בריף ל-AI" value={brief} onChange={setBrief}
                  placeholder="תאר את המוצר/השירות/הקהל ואת ההצעה. ה-AI יבנה כותרות, bullets, FAQ ו-CTA מתאימים."
                  rows={4} />
              )}
            </Card>

            <Btn variant="primary" full loading={creating} onClick={create} disabled={!title.trim() || (mode==='ai' && !brief.trim())}>
              {mode === 'ai' ? '🪄 צור דף עם AI' : '📋 צור מטמפלייט'}
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
