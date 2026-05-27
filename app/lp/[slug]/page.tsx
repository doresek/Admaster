'use client';
import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { TEMPLATES_BY_ID, type LandingTemplate, type LandingContent } from '@/lib/landing-templates';
import { createClient } from '@/lib/supabase/client';

interface LPData {
  id:       string;
  slug:     string;
  title:    string;
  template: LandingTemplate;
  content:  LandingContent;
  status:   'draft' | 'published' | 'archived';
}

function useCountdown(target?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return null;
  const diff = new Date(target).getTime() - now;
  if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0, expired: true };
  return {
    d: Math.floor(diff / 86400000),
    h: Math.floor((diff % 86400000) / 3600000),
    m: Math.floor((diff % 3600000) / 60000),
    s: Math.floor((diff % 60000) / 1000),
    expired: false,
  };
}

export default function PublicLandingPage() {
  const { slug }   = useParams<{ slug: string }>();
  const [data,     setData]     = useState<LPData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [notFoundDetail, setNotFoundDetail] = useState<string>('');
  const [submitted, setSubmitted] = useState(false);
  const [formVals,  setFormVals]  = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const supabase = createClient();

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    (async () => {
      // Use the server-side API which separates "missing slug" from "not published"
      // and surfaces RLS issues clearly.
      const res = await fetch(`/api/landing/public?slug=${encodeURIComponent(slug)}`);
      const body = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok || body?.error) {
        setNotFound(true);
        setNotFoundDetail(body?.detail || `Status ${res.status}`);
        setLoading(false);
        return;
      }
      setData(body as LPData);
      setLoading(false);
      // Best-effort view counter
      supabase.rpc('increment_lp_view', { p_slug: slug }).then(() => {}, () => {});
    })();
    return () => { alive = false; };
  }, [slug]);

  const def = data ? TEMPLATES_BY_ID[data.template] : null;
  const c = data?.content;

  const cd = useCountdown(c?.countdown_to);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setSubmitting(true); setErr('');
    try {
      const res = await fetch('/api/landing/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: data.slug, fields: formVals }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'שגיאה בשליחה');
      setSubmitted(true);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center" dir="rtl">
    <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
  </div>;

  if (notFound || !data || !def || !c) return <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6" dir="rtl">
    <div className="text-center max-w-md">
      <div className="text-5xl mb-3">😕</div>
      <div className="text-slate-700 font-semibold mb-3">הדף לא נמצא</div>
      {notFoundDetail && (
        <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-lg p-3 leading-relaxed">
          {notFoundDetail}
        </div>
      )}
      <div className="text-xs text-slate-400 mt-4" dir="ltr">slug: {slug}</div>
    </div>
  </div>;

  const isDark = c.theme.bg === 'dark';
  const bg     = isDark ? '#070A0E' : '#F8FAFC';
  const fg     = isDark ? '#E5EDF5' : '#1E293B';
  const muted  = isDark ? '#94A3B8' : '#64748B';
  const card   = isDark ? '#111A24' : '#FFFFFF';
  const cardBorder = isDark ? '#1E2F42' : '#E2E8F0';
  const accent = c.theme.primary;
  const accent2 = c.theme.secondary;

  return (
    <div style={{ background: bg, color: fg, minHeight: '100vh' }} dir="rtl">
      <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16">

        {/* HERO */}
        {def.sections.includes('hero') && (
          <section className="text-center mb-10">
            <h1 className="text-4xl sm:text-5xl font-bold leading-tight mb-4" style={{ fontFamily: 'DM Serif Display, serif' }}>
              {c.hero_title}
            </h1>
            <p className="text-lg leading-relaxed" style={{ color: muted }}>{c.hero_sub}</p>
          </section>
        )}

        {/* VIDEO */}
        {def.sections.includes('video') && c.video_url && (
          <section className="mb-10 rounded-2xl overflow-hidden border" style={{ borderColor: cardBorder }}>
            <div className="aspect-video">
              <iframe src={c.video_url} className="w-full h-full" allowFullScreen allow="autoplay; encrypted-media" />
            </div>
          </section>
        )}

        {/* TRUST signals */}
        {def.sections.includes('trust') && c.trust_signals && c.trust_signals.length > 0 && (
          <section className="grid grid-cols-3 gap-3 mb-10">
            {c.trust_signals.map((t, i) => (
              <div key={i} className="text-center p-4 rounded-xl border" style={{ background: card, borderColor: cardBorder }}>
                <div className="text-3xl mb-2">{t.icon}</div>
                <div className="text-sm font-semibold">{t.label}</div>
              </div>
            ))}
          </section>
        )}

        {/* STORY */}
        {def.sections.includes('story') && c.story && c.story.length > 0 && (
          <section className="mb-10 space-y-6">
            {c.story.map((s, i) => (
              <div key={i}>
                <h3 className="text-xl font-bold mb-2">{s.title}</h3>
                <p className="leading-relaxed" style={{ color: muted }}>{s.body}</p>
              </div>
            ))}
          </section>
        )}

        {/* QUALIFIER */}
        {def.sections.includes('qualifier') && c.qualifier && (
          <section className="mb-10 p-5 rounded-xl border-2" style={{ borderColor: accent, background: card }}>
            <div className="text-xs font-bold mb-2" style={{ color: accent }}>⚠️ זו לא תוכנית לכולם</div>
            <p className="leading-relaxed">{c.qualifier}</p>
          </section>
        )}

        {/* WEBINAR INFO */}
        {def.sections.includes('webinar_info') && c.webinar_at && (
          <section className="mb-10 text-center p-6 rounded-xl border" style={{ background: card, borderColor: cardBorder }}>
            <div className="text-xs font-bold mb-2" style={{ color: accent }}>📅 מועד השידור</div>
            <div className="text-2xl font-bold">{new Date(c.webinar_at).toLocaleString('he')}</div>
          </section>
        )}

        {/* COUNTDOWN */}
        {def.sections.includes('countdown') && cd && !cd.expired && (
          <section className="mb-10 text-center">
            <div className="text-xs font-bold mb-3" style={{ color: muted }}>זמן עד תחילת המבצע</div>
            <div className="flex justify-center gap-3">
              {[['ימים', cd.d],['שעות', cd.h],['דקות', cd.m],['שניות', cd.s]].map(([l, v]) => (
                <div key={l as string} className="px-4 py-3 rounded-xl border" style={{ background: card, borderColor: cardBorder, minWidth: 70 }}>
                  <div className="font-mono text-2xl font-bold" style={{ color: accent }}>{(v as number).toString().padStart(2, '0')}</div>
                  <div className="text-[10px]" style={{ color: muted }}>{l}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* BULLETS */}
        {def.sections.includes('bullets') && c.bullets && c.bullets.length > 0 && (
          <section className="mb-10">
            <ul className="space-y-3">
              {c.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-3 p-3 rounded-lg border" style={{ background: card, borderColor: cardBorder }}>
                  <span className="text-lg flex-shrink-0">{/^[^\w]/.test(b) ? '' : '✓'}</span>
                  <span className="leading-relaxed">{b}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* TESTIMONIALS */}
        {def.sections.includes('testimonials') && c.testimonials && c.testimonials.length > 0 && (
          <section className="mb-10 grid sm:grid-cols-2 gap-3">
            {c.testimonials.map((t, i) => (
              <div key={i} className="p-4 rounded-xl border" style={{ background: card, borderColor: cardBorder }}>
                <div className="text-3xl mb-2" style={{ color: accent2 }}>“</div>
                <p className="text-sm leading-relaxed mb-3">{t.quote}</p>
                <div className="text-xs font-bold">{t.name}</div>
                {t.role && <div className="text-[11px]" style={{ color: muted }}>{t.role}</div>}
              </div>
            ))}
          </section>
        )}

        {/* FAQ */}
        {def.sections.includes('faq') && c.faq && c.faq.length > 0 && (
          <section className="mb-10">
            <h3 className="text-xl font-bold mb-4 text-center">שאלות נפוצות</h3>
            <div className="space-y-2">
              {c.faq.map((f, i) => (
                <details key={i} className="rounded-xl border p-4" style={{ background: card, borderColor: cardBorder }}>
                  <summary className="font-semibold cursor-pointer">{f.q}</summary>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: muted }}>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* FORM */}
        {def.sections.includes('form') && (
          <section className="mb-10">
            <div className="p-6 rounded-2xl border" style={{ background: card, borderColor: cardBorder }}>
              {submitted ? (
                <div className="text-center py-6">
                  <div className="text-5xl mb-3">🎉</div>
                  <div className="text-xl font-bold mb-1">תודה!</div>
                  <p style={{ color: muted }}>קיבלנו את הפרטים שלך — נחזור אליך בהקדם.</p>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-3">
                  {c.form_fields.map(f => (
                    <div key={f.name}>
                      <label className="block text-xs font-semibold mb-1.5">{f.label}{f.required && ' *'}</label>
                      {f.type === 'textarea' ? (
                        <textarea
                          required={f.required}
                          rows={3}
                          value={formVals[f.name] || ''}
                          onChange={e => setFormVals(v => ({ ...v, [f.name]: e.target.value }))}
                          className="w-full px-3 py-2.5 text-sm rounded-lg outline-none border"
                          style={{ background: isDark ? '#162030' : '#fff', borderColor: cardBorder, color: fg }}
                        />
                      ) : (
                        <input
                          type={f.type}
                          required={f.required}
                          value={formVals[f.name] || ''}
                          onChange={e => setFormVals(v => ({ ...v, [f.name]: e.target.value }))}
                          dir={f.type === 'email' || f.type === 'tel' ? 'ltr' : 'rtl'}
                          className="w-full px-3 py-2.5 text-sm rounded-lg outline-none border"
                          style={{ background: isDark ? '#162030' : '#fff', borderColor: cardBorder, color: fg }}
                        />
                      )}
                    </div>
                  ))}
                  {err && <div className="text-sm text-red-500">❌ {err}</div>}
                  <button type="submit" disabled={submitting}
                    className="w-full py-3 rounded-lg text-base font-bold transition-all hover:brightness-110 disabled:opacity-50"
                    style={{ background: accent, color: '#fff' }}>
                    {submitting ? 'שולח...' : c.cta_label}
                  </button>
                </form>
              )}
            </div>
          </section>
        )}

        {/* Standalone CTA (if no form) */}
        {def.sections.includes('cta') && !def.sections.includes('form') && c.cta_href && (
          <section className="mb-10 text-center">
            <a href={c.cta_href}
              className="inline-block px-8 py-3.5 rounded-lg text-base font-bold transition-all hover:brightness-110"
              style={{ background: accent, color: '#fff' }}>
              {c.cta_label}
            </a>
          </section>
        )}

        <div className="text-center text-xs mt-12" style={{ color: muted }}>
          נבנה ב-AdMaster Pro
        </div>
      </div>
    </div>
  );
}
