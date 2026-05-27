'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardLabel, Btn, Input, Textarea, Alert, PageHeader, Chip, CostBadge } from '@/components/ui';
import { TEMPLATES_BY_ID, type LandingTemplate, type LandingContent } from '@/lib/landing-templates';
import { coerceDesignSpec } from '@/lib/landing-design';

interface LP {
  id:       string;
  slug:     string;
  title:    string;
  template: LandingTemplate;
  content:  LandingContent;
  status:   'draft' | 'published' | 'archived';
}

type Section = 'hero' | 'cta' | 'bullets' | 'faq' | 'testimonials' | 'qualifier' | 'story';

export default function LandingEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [page,     setPage]     = useState<LP | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [refining, setRefining] = useState<Section | null>(null);
  const [error,    setError]    = useState('');
  const [view,     setView]     = useState<'desktop' | 'mobile'>('desktop');
  const [refineModal, setRefineModal] = useState<{ section: Section; instruction: string } | null>(null);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variants, setVariants] = useState<Array<{ label: string; summary: string; design: any }> | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/landing');
      const all = await res.json();
      const found = Array.isArray(all) ? all.find((p: LP) => p.id === id) : null;
      if (!found) { setError('הדף לא נמצא'); return; }
      setPage(found);
    } finally { setLoading(false); }
  }

  useEffect(() => { if (id) load(); }, [id]);

  function updateContent<K extends keyof LandingContent>(key: K, value: LandingContent[K]) {
    if (!page) return;
    setPage({ ...page, content: { ...page.content, [key]: value } as LandingContent });
  }

  async function save() {
    if (!page) return;
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/landing?id=${page.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title: page.title, content: page.content }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'שגיאה בשמירה');
      }
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function publish() {
    if (!page) return;
    await save();
    const next = page.status === 'published' ? 'draft' : 'published';
    const res = await fetch(`/api/landing?id=${page.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) {
      const d = await res.json();
      setPage(d);
    }
  }

  async function genVariants() {
    if (!page) return;
    setVariantsLoading(true); setError(''); setVariants(null);
    try {
      const res = await fetch('/api/landing/variants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ landing_id: page.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      setVariants(data.variants);
    } catch (e: any) {
      setError(e.message);
      setVariantsOpen(false);
    } finally { setVariantsLoading(false); }
  }

  async function pickVariant(v: { design: any }) {
    if (!page) return;
    const next = { ...page, content: { ...page.content, design: v.design } as any };
    setPage(next);
    setVariantsOpen(false);
    setVariants(null);
    // Auto-save the new design
    setSaving(true);
    try {
      await fetch(`/api/landing?id=${page.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: next.content }),
      });
    } finally { setSaving(false); }
  }

  async function runRefine() {
    if (!page || !refineModal) return;
    setRefining(refineModal.section);
    try {
      const res = await fetch('/api/landing/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          landing_id: page.id,
          section:    refineModal.section,
          instruction: refineModal.instruction,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      setPage(p => p ? { ...p, content: data.content } : p);
      setRefineModal(null);
    } catch (e: any) { setError(e.message); }
    finally { setRefining(null); }
  }

  if (loading) return <div className="flex items-center justify-center py-16">
    <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
  </div>;

  if (!page) return <Alert type="red">❌ {error || 'הדף לא נמצא'}</Alert>;

  const def = TEMPLATES_BY_ID[page.template];
  const c = page.content;
  const design = c.design ? coerceDesignSpec(c.design as any) : null;

  return (
    <div>
      <PageHeader
        eyebrow="עריכת דף"
        title={page.title || '(ללא כותרת)'}
        sub={`Template: ${def.name} · Status: ${page.status}`}
        right={
          <div className="flex gap-2 flex-wrap">
            <Btn variant="ghost" size="sm" onClick={() => router.push('/landing-pages')}>← חזרה</Btn>
            <Btn variant="violet" size="sm" onClick={() => { setVariantsOpen(true); genVariants(); }} loading={variantsLoading}>
              🎲 3 חלופות עיצוב (3⚡)
            </Btn>
            <Btn variant={page.status === 'published' ? 'amber' : 'primary'} size="sm" onClick={publish}>
              {page.status === 'published' ? '⏸ הסר פרסום' : '🚀 פרסם'}
            </Btn>
            <Btn variant="green" size="sm" loading={saving} onClick={save}>💾 שמור</Btn>
          </div>
        }
      />

      {error && <Alert type="red">❌ {error}</Alert>}

      <div className="grid grid-cols-[1fr_auto] gap-5">
        {/* ─── LEFT: edit form ─── */}
        <div className="space-y-3 max-w-2xl">

          <Card>
            <CardLabel>שם הדף + סלאג</CardLabel>
            <Input label="שם" value={page.title} onChange={t => setPage({ ...page, title: t })} />
            <div className="flex items-center gap-2 bg-[#1A2A42] border border-[#243752] rounded-lg px-3 py-2 text-xs">
              <span className="text-[#6B8FA8]">URL:</span>
              <Link href={`/lp/${page.slug}`} target="_blank" className="text-[#3D9FFF] font-mono truncate" dir="ltr">/lp/{page.slug}</Link>
            </div>
          </Card>

          {/* HERO */}
          <Card>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>Hero</CardLabel>
              <Btn variant="ghost" size="xs" onClick={() => setRefineModal({ section: 'hero', instruction: '' })} loading={refining === 'hero'}>
                🪄 שפר עם AI <CostBadge cost={3} />
              </Btn>
            </div>
            <Input label="כותרת ראשית" value={c.hero_title || ''} onChange={v => updateContent('hero_title', v)} />
            <Textarea label="תת-כותרת" value={c.hero_sub || ''} onChange={v => updateContent('hero_sub', v)} rows={3} />
            {design?.eyebrow !== undefined && (
              <Input label="תווית עליונה (eyebrow)" value={(c.design as any)?.eyebrow || ''}
                onChange={v => updateContent('design', { ...(c.design || {}), eyebrow: v } as any)} />
            )}
          </Card>

          {/* CTA */}
          <Card>
            <div className="flex items-center justify-between mb-2">
              <CardLabel>CTA</CardLabel>
              <Btn variant="ghost" size="xs" onClick={() => setRefineModal({ section: 'cta', instruction: '' })} loading={refining === 'cta'}>
                🪄 שפר <CostBadge cost={3} />
              </Btn>
            </div>
            <Input label="טקסט הכפתור" value={c.cta_label || ''} onChange={v => updateContent('cta_label', v)} />
          </Card>

          {/* BULLETS */}
          {c.bullets && c.bullets.length > 0 && (
            <Card>
              <div className="flex items-center justify-between mb-2">
                <CardLabel>Bullets / יתרונות</CardLabel>
                <Btn variant="ghost" size="xs" onClick={() => setRefineModal({ section: 'bullets', instruction: '' })} loading={refining === 'bullets'}>
                  🪄 שפר <CostBadge cost={3} />
                </Btn>
              </div>
              {c.bullets.map((b, i) => (
                <div key={i} className="flex items-start gap-2 mb-2">
                  <span className="text-xs text-[#6B8FA8] mt-2.5">{i+1}.</span>
                  <input value={b} onChange={e => {
                    const next = [...(c.bullets || [])];
                    next[i] = e.target.value;
                    updateContent('bullets', next);
                  }}
                    className="flex-1 bg-[#1A2A42] border border-[#243752] rounded-lg px-3 py-2 text-sm text-[#D9E8F5]" dir="rtl" />
                  <button onClick={() => updateContent('bullets', c.bullets!.filter((_, j) => j !== i))}
                    className="text-[#2E4459] hover:text-red-400 text-sm">✕</button>
                </div>
              ))}
              <Btn variant="ghost" size="xs" onClick={() => updateContent('bullets', [...(c.bullets || []), ''])}>+ הוסף</Btn>
            </Card>
          )}

          {/* FAQ */}
          {c.faq && c.faq.length > 0 && (
            <Card>
              <div className="flex items-center justify-between mb-2">
                <CardLabel>FAQ</CardLabel>
                <Btn variant="ghost" size="xs" onClick={() => setRefineModal({ section: 'faq', instruction: '' })} loading={refining === 'faq'}>
                  🪄 שפר <CostBadge cost={3} />
                </Btn>
              </div>
              {c.faq.map((f, i) => (
                <div key={i} className="bg-[#1A2A42] rounded-lg p-3 mb-2">
                  <input value={f.q} onChange={e => {
                    const next = [...(c.faq || [])]; next[i] = { ...next[i], q: e.target.value };
                    updateContent('faq', next);
                  }} className="w-full bg-transparent border-b border-[#243752] text-sm text-[#D9E8F5] font-semibold mb-2 py-1" dir="rtl" />
                  <textarea value={f.a} onChange={e => {
                    const next = [...(c.faq || [])]; next[i] = { ...next[i], a: e.target.value };
                    updateContent('faq', next);
                  }} rows={2} className="w-full bg-transparent text-xs text-[#6B8FA8] py-1" dir="rtl" />
                  <button onClick={() => updateContent('faq', c.faq!.filter((_, j) => j !== i))}
                    className="text-[10px] text-[#2E4459] hover:text-red-400">✕ מחק שאלה</button>
                </div>
              ))}
              <Btn variant="ghost" size="xs" onClick={() => updateContent('faq', [...(c.faq || []), { q: '', a: '' }])}>+ הוסף שאלה</Btn>
            </Card>
          )}

          {/* TESTIMONIALS */}
          {c.testimonials && c.testimonials.length > 0 && (
            <Card>
              <div className="flex items-center justify-between mb-2">
                <CardLabel>עדויות</CardLabel>
                <Btn variant="ghost" size="xs" onClick={() => setRefineModal({ section: 'testimonials', instruction: '' })} loading={refining === 'testimonials'}>
                  🪄 שפר <CostBadge cost={3} />
                </Btn>
              </div>
              {c.testimonials.map((t, i) => (
                <div key={i} className="bg-[#1A2A42] rounded-lg p-3 mb-2">
                  <div className="flex gap-2 mb-2">
                    <input value={t.name} onChange={e => {
                      const next = [...(c.testimonials || [])]; next[i] = { ...next[i], name: e.target.value };
                      updateContent('testimonials', next);
                    }} placeholder="שם" className="flex-1 bg-[#0A0E14] border border-[#243752] rounded px-2 py-1 text-xs" dir="rtl" />
                    <input value={t.role || ''} onChange={e => {
                      const next = [...(c.testimonials || [])]; next[i] = { ...next[i], role: e.target.value };
                      updateContent('testimonials', next);
                    }} placeholder="תפקיד" className="flex-1 bg-[#0A0E14] border border-[#243752] rounded px-2 py-1 text-xs" dir="rtl" />
                  </div>
                  <textarea value={t.quote} onChange={e => {
                    const next = [...(c.testimonials || [])]; next[i] = { ...next[i], quote: e.target.value };
                    updateContent('testimonials', next);
                  }} rows={2} placeholder="ציטוט" className="w-full bg-[#0A0E14] border border-[#243752] rounded px-2 py-1 text-xs" dir="rtl" />
                  <button onClick={() => updateContent('testimonials', c.testimonials!.filter((_, j) => j !== i))}
                    className="text-[10px] text-[#2E4459] hover:text-red-400 mt-1">✕ מחק</button>
                </div>
              ))}
              <Btn variant="ghost" size="xs" onClick={() => updateContent('testimonials', [...(c.testimonials || []), { name: '', quote: '' }])}>+ הוסף עדות</Btn>
            </Card>
          )}

          {/* COLORS */}
          {design && (
            <Card>
              <CardLabel>🎨 צבעי הדף</CardLabel>
              <div className="grid grid-cols-3 gap-2">
                {(['primary','secondary','accent','bg','bgAlt','surface','text','textMuted','border'] as const).map(k => (
                  <div key={k} className="flex items-center gap-2">
                    <input type="color" value={(c.design as any)[k]} onChange={e => {
                      updateContent('design', { ...(c.design as any), [k]: e.target.value } as any);
                    }} className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0" />
                    <div className="text-[10px] text-[#6B8FA8]">
                      <div>{k}</div>
                      <div className="font-mono text-[#D9E8F5]">{(c.design as any)[k]}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ─── RIGHT: live preview ─── */}
        <div className="sticky top-20 self-start">
          <div className="flex gap-2 mb-3 justify-center">
            <Btn variant={view==='desktop'?'primary':'ghost'} size="xs" onClick={() => setView('desktop')}>💻 שולחני</Btn>
            <Btn variant={view==='mobile'?'primary':'ghost'} size="xs" onClick={() => setView('mobile')}>📱 נייד</Btn>
          </div>
          <div className="bg-[#0A0E14] border border-[#243752] rounded-2xl p-3 shadow-2xl"
               style={{
                 width:  view === 'mobile' ? 400 : 720,
                 height: view === 'mobile' ? 800 : 580,
               }}>
            <iframe
              key={JSON.stringify({ c, t: page.title })}
              src={`/lp/${page.slug}?preview=1&t=${Date.now()}`}
              className="w-full h-full rounded-lg bg-white"
              style={{
                width:  view === 'mobile' ? 375 : '100%',
                margin: view === 'mobile' ? '0 auto' : undefined,
                display: 'block',
              }}
            />
          </div>
          <div className="text-[10px] text-[#2E4459] text-center mt-2">
            תצוגה מקדימה — שמור כדי לראות עדכונים
          </div>
        </div>
      </div>

      {/* 3 Variants modal */}
      {variantsOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#152138] border border-[#243752] rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-bold text-lg text-[#D9E8F5]">🎲 שלוש חלופות עיצוב</div>
                <div className="text-xs text-[#6B8FA8] mt-0.5">התוכן זהה — רק העיצוב משתנה. בחר את החלופה שמדברת אליך.</div>
              </div>
              <button onClick={() => { setVariantsOpen(false); setVariants(null); }} className="text-[#2E4459] hover:text-white text-xl">✕</button>
            </div>

            {variantsLoading && (
              <div className="flex flex-col items-center gap-3 py-16">
                <div className="w-10 h-10 border-2 border-[#A78BFA]/30 border-t-[#A78BFA] rounded-full animate-spin" />
                <div className="text-sm text-[#6B8FA8]">בונה 3 חלופות... ~20-30 שניות</div>
              </div>
            )}

            {!variantsLoading && variants && (
              <div className="grid md:grid-cols-3 gap-3">
                {variants.map((v, i) => {
                  const d = v.design;
                  return (
                    <button key={i} onClick={() => pickVariant(v)}
                      className="text-right rounded-xl overflow-hidden border-2 border-transparent hover:border-[#A78BFA] transition-all hover:scale-[1.02] group">
                      {/* mini preview swatch */}
                      <div className="relative h-44 overflow-hidden" style={{
                        background: `linear-gradient(135deg, ${d.primary} 0%, ${d.secondary} 100%), ${d.bg}`,
                      }}>
                        <div className="absolute inset-0 flex items-center justify-center text-6xl opacity-30">{d.hero_emoji || '🪄'}</div>
                        <div className="absolute bottom-2 left-2 right-2 backdrop-blur-md rounded px-2 py-1 text-[10px] text-white" style={{ background: 'rgba(0,0,0,.4)' }}>
                          {d.hero} · {d.fonts}
                        </div>
                      </div>
                      <div className="p-3 bg-[#152138]">
                        <div className="font-bold text-sm text-[#D9E8F5] mb-1">{v.label}</div>
                        <div className="text-[11px] text-[#6B8FA8] mb-2 line-clamp-2">{v.summary}</div>
                        <div className="flex gap-1 mb-2">
                          {[d.primary, d.secondary, d.accent, d.bg, d.text].map((c, j) => (
                            <div key={j} className="w-5 h-5 rounded border border-black/30" style={{ background: c }} title={c} />
                          ))}
                        </div>
                        <div className="text-[10px] font-bold text-[#A78BFA] group-hover:text-[#C4B5FD]">
                          בחר חלופה זו →
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Refine modal */}
      {refineModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#152138] border border-[#243752] rounded-2xl max-w-lg w-full p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="font-bold text-base text-[#D9E8F5]">🪄 שפר עם AI · section: {refineModal.section}</div>
              <button onClick={() => setRefineModal(null)} className="text-[#2E4459] hover:text-white">✕</button>
            </div>
            <Textarea label="מה תרצה לשנות?" value={refineModal.instruction}
              onChange={v => setRefineModal({ ...refineModal, instruction: v })}
              placeholder="לדוגמה: 'קצר יותר, יותר רגשי' / 'חזק יותר, מספרי' / 'תוסיף דחיפות'"
              rows={3} />
            <div className="flex gap-2">
              <Btn variant="primary" full loading={refining === refineModal.section}
                onClick={runRefine} disabled={!refineModal.instruction.trim()}>
                🪄 הפעל (3⚡)
              </Btn>
              <Btn variant="ghost" onClick={() => setRefineModal(null)}>ביטול</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
