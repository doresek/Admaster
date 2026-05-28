'use client';
import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { TEMPLATES_BY_ID, type LandingTemplate, type LandingContent } from '@/lib/landing-templates';
import { coerceDesignSpec, DEFAULT_DESIGN, FONT_PAIRS, radiusFor, densityFor, type DesignSpec } from '@/lib/landing-design';
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

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

// Mix a hex color with another (for hover/gradient effects)
function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0,2), 16);
  const g = parseInt(h.substring(2,4), 16);
  const b = parseInt(h.substring(4,6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export default function PublicLandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data,     setData]     = useState<LPData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [notFoundDetail, setNotFoundDetail] = useState<string>('');
  const [submitted, setSubmitted] = useState(false);
  const [formVals,  setFormVals]  = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const supabase = createClient();
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    (async () => {
      let decodedSlug = slug;
      try { decodedSlug = decodeURIComponent(slug); } catch {}
      const res = await fetch(`/api/landing/public?slug=${encodeURIComponent(decodedSlug)}`);
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
      supabase.rpc('increment_lp_view', { p_slug: decodedSlug }).then(() => {}, () => {});
    })();
    return () => { alive = false; };
  }, [slug]);

  const def = data ? TEMPLATES_BY_ID[data.template] : null;
  const c   = data?.content;

  const design: DesignSpec = useMemo(() => {
    if (c?.design) return coerceDesignSpec(c.design as any);
    return DEFAULT_DESIGN;
  }, [c?.design]);

  const fontPair = FONT_PAIRS[design.fonts];
  const r        = radiusFor(design);
  const d        = densityFor(design);
  const cd       = useCountdown(c?.countdown_to);

  // Inject Google Fonts <link> dynamically (once per design)
  useEffect(() => {
    if (!fontPair) return;
    const id = `gf-${design.fonts}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = fontPair.googleFontsHref;
    document.head.appendChild(link);
  }, [fontPair, design.fonts]);

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
    } finally { setSubmitting(false); }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0E1230' }}>
      <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  );

  if (notFound || !data || !def || !c) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6" dir="rtl">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-3">😕</div>
        <div className="text-slate-700 font-semibold mb-3">הדף לא נמצא</div>
        {notFoundDetail && (
          <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-lg p-3 leading-relaxed">{notFoundDetail}</div>
        )}
        <div className="text-xs text-slate-400 mt-4" dir="ltr">slug: {slug}</div>
      </div>
    </div>
  );

  // ─── Hero background style ───
  const heroBgStyle = (() => {
    const p = design.primary, s = design.secondary, a = design.accent;
    switch (design.heroBg) {
      case 'mesh':
        return `radial-gradient(ellipse 80% 50% at 50% 0%, ${alpha(p,.30)}, transparent), radial-gradient(ellipse 60% 40% at 80% 100%, ${alpha(s,.25)}, transparent), radial-gradient(ellipse 50% 40% at 15% 60%, ${alpha(a,.15)}, transparent), linear-gradient(180deg, ${design.bg}, ${design.bgAlt})`;
      case 'orbs':
        return `radial-gradient(circle at 20% 30%, ${alpha(p,.30)}, transparent 40%), radial-gradient(circle at 80% 70%, ${alpha(s,.25)}, transparent 40%), linear-gradient(180deg, ${design.bg}, ${design.bgAlt})`;
      case 'duotone':
        return `linear-gradient(135deg, ${alpha(p,.18)}, ${alpha(s,.18)}), linear-gradient(180deg, ${design.bg}, ${design.bgAlt})`;
      case 'grid':
        return `linear-gradient(180deg, ${design.bg}, ${design.bgAlt})`;
      case 'noise':
      case 'solid':
      default:
        return `linear-gradient(180deg, ${design.bg}, ${design.bgAlt})`;
    }
  })();

  // ─── Card visual style ───
  const cardBaseStyle = (): React.CSSProperties => {
    switch (design.card) {
      case 'glass':
        return {
          background: design.isDark ? alpha('#FFFFFF', .05) : alpha('#FFFFFF', .65),
          border: `1px solid ${design.border}`,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)' as any,
        };
      case 'soft':
        return {
          background: design.surface,
          border: '1px solid transparent',
          boxShadow: design.isDark ? '0 8px 32px rgba(0,0,0,.35)' : '0 8px 28px rgba(0,0,0,.06)',
        };
      case 'bordered':
        return { background: design.surface, border: `2px solid ${design.border}` };
      case 'gradient':
        return {
          background: design.surface,
          border: `2px solid transparent`,
          backgroundImage: `linear-gradient(${design.surface}, ${design.surface}), linear-gradient(135deg, ${design.primary}, ${design.secondary})`,
          backgroundOrigin: 'border-box',
          backgroundClip: 'padding-box, border-box',
        };
      case 'lifted':
        return {
          background: design.surface,
          border: `1px solid ${design.border}`,
          boxShadow: `0 1px 0 0 ${alpha(design.primary, .15)}, 0 18px 40px -12px rgba(0,0,0,${design.isDark ? .55 : .12})`,
        };
      case 'flat':
      default:
        return { background: design.surface, border: `1px solid ${design.border}` };
    }
  };

  const cardClass = `transition-all duration-300`;

  // ─── Hero size by variant ───
  const heroSizeClass = (() => {
    switch (design.hero) {
      case 'cinematic':      return 'text-5xl sm:text-7xl lg:text-8xl font-black';
      case 'dramatic':       return 'text-5xl sm:text-7xl lg:text-8xl font-black';
      case 'magazine':       return 'text-5xl sm:text-6xl lg:text-7xl font-bold leading-[0.95]';
      case 'minimal':        return 'text-4xl sm:text-5xl lg:text-6xl font-light tracking-tight';
      case 'gradient_blob':  return 'text-5xl sm:text-6xl lg:text-7xl font-extrabold';
      case 'split':          return 'text-4xl sm:text-5xl lg:text-6xl font-bold';
      case 'centered':
      default:               return 'text-5xl sm:text-6xl lg:text-7xl font-bold';
    }
  })();

  const containerWidth = design.hero === 'magazine' || design.hero === 'dramatic' || design.hero === 'cinematic'
    ? 'max-w-6xl' : 'max-w-4xl';

  return (
    <div
      className="min-h-screen relative overflow-x-hidden"
      style={{
        background: design.bg,
        color: design.text,
        fontFamily: fontPair.body,
      }}
      dir="rtl"
    >
      {/* Hero background — under everything */}
      <div className="absolute inset-x-0 top-0 h-[820px] pointer-events-none" style={{ background: heroBgStyle }} />

      {/* Grid overlay (if heroBg=grid) */}
      {design.heroBg === 'grid' && (
        <div className="absolute inset-x-0 top-0 h-[820px] pointer-events-none opacity-20"
             style={{
               backgroundImage: `linear-gradient(${design.border} 1px, transparent 1px), linear-gradient(90deg, ${design.border} 1px, transparent 1px)`,
               backgroundSize: '60px 60px',
               maskImage: 'radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent 70%)',
             }} />
      )}

      {/* Animated orbs for gradient_blob hero */}
      {design.hero === 'gradient_blob' && !reducedMotion && (
        <>
          <div className="absolute top-20 -right-20 w-96 h-96 rounded-full opacity-30 blur-3xl pointer-events-none"
               style={{ background: design.primary, animation: 'floaty 9s ease-in-out infinite' }} />
          <div className="absolute top-40 -left-32 w-[28rem] h-[28rem] rounded-full opacity-25 blur-3xl pointer-events-none"
               style={{ background: design.secondary, animation: 'floaty 11s ease-in-out infinite reverse' }} />
        </>
      )}

      <style jsx global>{`
        @keyframes floaty {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(20px, -30px) scale(1.05); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideRight {
          from { opacity: 0; transform: translateX(${design.hero === 'split' ? '20px' : '0'}); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .reveal   { animation: fadeUp .6s ease both; }
        .reveal-2 { animation: fadeUp .6s ease .1s both; }
        .reveal-3 { animation: fadeUp .6s ease .2s both; }
        .reveal-4 { animation: fadeUp .6s ease .3s both; }
      `}</style>

      <div className={`${containerWidth} mx-auto px-5 sm:px-8 relative`}>

        {/* ═══ HERO ═══ */}
        <section className={`${d.section} ${design.hero === 'centered' || design.hero === 'gradient_blob' || design.hero === 'minimal' || design.hero === 'cinematic' ? 'text-center' : ''}`}>

          {/* HERO: CINEMATIC — full-bleed photo bg with overlay (luxury lifestyle) */}
          {design.hero === 'cinematic' && (
            <div className="relative -mx-5 sm:-mx-8">
              {/* Background image — full bleed */}
              {c.hero_image && (
                <div className="absolute inset-0 overflow-hidden">
                  <img src={c.hero_image} alt="" className="w-full h-full object-cover" />
                  {/* Multi-layer overlay for readable text */}
                  <div className="absolute inset-0" style={{
                    background: `linear-gradient(180deg, ${alpha(design.bg, .35)} 0%, ${alpha(design.bg, .55)} 60%, ${design.bg} 100%)`,
                  }} />
                  <div className="absolute inset-0" style={{
                    background: `radial-gradient(ellipse 80% 60% at 50% 50%, transparent 0%, ${alpha(design.bg, .35)} 100%)`,
                  }} />
                </div>
              )}
              {!c.hero_image && (
                <div className="absolute inset-0 overflow-hidden" style={{
                  background: `linear-gradient(135deg, ${alpha(design.primary,.7)}, ${alpha(design.secondary,.7)}), ${design.bg}`,
                }} />
              )}

              {/* Content */}
              <div className="relative z-10 px-5 sm:px-12 py-24 sm:py-36 text-center">
                {design.eyebrow && (
                  <div className="reveal inline-block px-4 py-1.5 mb-8 text-xs font-bold uppercase tracking-[0.3em] rounded-full backdrop-blur-md"
                       style={{
                         background: alpha('#000000', .3),
                         color: '#fff',
                         border: `1px solid ${alpha('#FFFFFF', .25)}`,
                       }}>
                    {design.hero_emoji && <span className="me-1">{design.hero_emoji}</span>}
                    {design.eyebrow}
                  </div>
                )}
                <h1 className={`${heroSizeClass} reveal-2 leading-[1.0] mb-8 max-w-4xl mx-auto`}
                    style={{
                      fontFamily: fontPair.display,
                      color: '#fff',
                      textShadow: '0 4px 30px rgba(0,0,0,0.5)',
                    }}>
                  {c.hero_title}
                </h1>
                <p className="text-xl sm:text-2xl leading-relaxed max-w-2xl mx-auto reveal-3"
                   style={{
                     color: alpha('#FFFFFF', .92),
                     textShadow: '0 2px 12px rgba(0,0,0,0.4)',
                   }}>
                  {c.hero_sub}
                </p>
              </div>
            </div>
          )}

          {/* HERO: DRAMATIC — full-bleed-style with overlay */}
          {design.hero === 'dramatic' && (
            <div className="relative text-center">
              {c.hero_image && (
                <div className="absolute inset-0 -z-10 overflow-hidden" style={{ borderRadius: r.card }}>
                  <img src={c.hero_image} alt="" className="w-full h-full object-cover opacity-30" />
                  <div className="absolute inset-0" style={{
                    background: `linear-gradient(180deg, ${alpha(design.bg, .4)}, ${alpha(design.bg, .9)})`,
                  }} />
                </div>
              )}
              {!c.hero_image && design.hero_emoji && (
                <div className="text-6xl mb-6 reveal" aria-hidden>{design.hero_emoji}</div>
              )}
              {design.eyebrow && (
                <div className="reveal inline-block px-4 py-1.5 mb-6 text-xs font-bold uppercase tracking-widest rounded-full"
                     style={{ background: alpha(design.primary, .15), color: design.primary, border: `1px solid ${alpha(design.primary, .4)}` }}>
                  {design.eyebrow}
                </div>
              )}
              <h1 className={`${heroSizeClass} reveal-2 leading-[1.0] mb-6 uppercase`}
                  style={{ fontFamily: fontPair.display, color: design.text }}>
                {c.hero_title}
              </h1>
              <p className="text-xl sm:text-2xl leading-relaxed max-w-3xl mx-auto reveal-3" style={{ color: design.textMuted }}>
                {c.hero_sub}
              </p>
            </div>
          )}

          {/* HERO: MAGAZINE — editorial, off-center */}
          {design.hero === 'magazine' && (
            <div className="grid md:grid-cols-12 gap-8 items-end">
              <div className="md:col-span-7 md:col-start-1">
                {design.eyebrow && (
                  <div className="reveal mb-4 text-xs font-bold uppercase tracking-[0.3em]" style={{ color: design.accent }}>
                    — {design.eyebrow}
                  </div>
                )}
                <h1 className={`${heroSizeClass} reveal-2 mb-6`}
                    style={{ fontFamily: fontPair.display, color: design.text }}>
                  {c.hero_title}
                </h1>
              </div>
              <div className="md:col-span-5 md:col-start-8 reveal-3">
                {c.hero_image ? (
                  <div className="mb-4 overflow-hidden" style={{ borderRadius: r.card, aspectRatio: '4/5' }}>
                    <img src={c.hero_image} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : null}
                <div className="border-t-2 pt-4" style={{ borderColor: design.primary }}>
                  <p className="text-lg leading-relaxed" style={{ color: design.textMuted }}>{c.hero_sub}</p>
                </div>
              </div>
            </div>
          )}

          {/* HERO: SPLIT — 50/50 */}
          {design.hero === 'split' && (
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                {design.eyebrow && (
                  <div className="reveal mb-4 inline-block px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full"
                       style={{ background: alpha(design.accent, .12), color: design.accent }}>
                    {design.eyebrow}
                  </div>
                )}
                <h1 className={`${heroSizeClass} reveal-2 leading-[1.05] mb-5`}
                    style={{ fontFamily: fontPair.display, color: design.text }}>
                  {c.hero_title}
                </h1>
                <p className="text-lg leading-relaxed reveal-3" style={{ color: design.textMuted }}>{c.hero_sub}</p>
              </div>
              <div className="reveal-3 hidden md:block">
                {c.hero_image ? (
                  <div className="aspect-square relative overflow-hidden" style={{
                    borderRadius: r.card,
                    border: `1px solid ${design.border}`,
                    boxShadow: `0 20px 60px -12px ${alpha(design.primary, .35)}`,
                  }}>
                    <img src={c.hero_image} alt={c.hero_title} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="aspect-square relative overflow-hidden" style={{
                    borderRadius: r.card,
                    background: `linear-gradient(135deg, ${alpha(design.primary,.25)}, ${alpha(design.secondary,.25)}), ${design.surface}`,
                    border: `1px solid ${design.border}`,
                  }}>
                    <div className="absolute inset-0 flex items-center justify-center text-9xl opacity-40" style={{ color: design.primary }}>
                      {design.hero_emoji || def.emoji}
                    </div>
                    <div className="absolute bottom-4 left-4 right-4 backdrop-blur-md px-4 py-2.5"
                         style={{ borderRadius: r.button, background: design.isDark ? alpha('#FFFFFF',.06) : alpha('#000000',.04) }}>
                      <div className="text-xs font-medium" style={{ color: design.textMuted }}>{def.tagline}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* HERO: MINIMAL — sparse, lots of whitespace */}
          {design.hero === 'minimal' && (
            <div className="max-w-2xl mx-auto py-10">
              {design.eyebrow && (
                <div className="reveal mb-8 text-[11px] tracking-[0.4em] uppercase" style={{ color: design.accent }}>
                  {design.eyebrow}
                </div>
              )}
              <h1 className={`${heroSizeClass} reveal-2 mb-8`}
                  style={{ fontFamily: fontPair.display, color: design.text }}>
                {c.hero_title}
              </h1>
              <div className="w-20 h-px mx-auto mb-8 reveal-3" style={{ background: design.primary }} />
              <p className="text-lg leading-loose reveal-3" style={{ color: design.textMuted }}>{c.hero_sub}</p>
            </div>
          )}

          {/* HERO: GRADIENT_BLOB — bold w/ floating shapes */}
          {design.hero === 'gradient_blob' && (
            <div className="relative z-10 max-w-3xl mx-auto">
              {c.hero_image && (
                <div className="reveal mx-auto mb-6 w-28 h-28 rounded-full overflow-hidden border-4 shadow-xl"
                     style={{ borderColor: design.surface, boxShadow: `0 0 0 4px ${alpha(design.primary, .3)}` }}>
                  <img src={c.hero_image} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              {!c.hero_image && design.hero_emoji && (
                <div className="reveal text-5xl mb-6">{design.hero_emoji}</div>
              )}
              {design.eyebrow && (
                <div className="reveal inline-block px-3 py-1.5 mb-6 text-xs font-bold rounded-full"
                     style={{ background: alpha(design.accent,.15), color: design.accent, border: `1px solid ${alpha(design.accent,.3)}` }}>
                  {design.eyebrow}
                </div>
              )}
              <h1 className={`${heroSizeClass} reveal-2 mb-6`}
                  style={{
                    fontFamily: fontPair.display,
                    background: `linear-gradient(135deg, ${design.text} 60%, ${design.primary})`,
                    WebkitBackgroundClip: 'text', backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent', color: 'transparent',
                  }}>
                {c.hero_title}
              </h1>
              <p className="text-lg sm:text-xl leading-relaxed reveal-3" style={{ color: design.textMuted }}>{c.hero_sub}</p>
            </div>
          )}

          {/* HERO: CENTERED — default, classic */}
          {design.hero === 'centered' && (
            <div>
              {c.hero_image && (
                <div className="reveal mx-auto mb-6 w-24 h-24 rounded-full overflow-hidden border-4 shadow-lg"
                     style={{ borderColor: design.surface, boxShadow: `0 0 0 4px ${alpha(design.accent, .25)}` }}>
                  <img src={c.hero_image} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              {design.eyebrow && (
                <div className="reveal inline-block px-3 py-1 mb-5 text-xs font-bold uppercase tracking-wider rounded-full"
                     style={{ background: alpha(design.accent,.12), color: design.accent }}>
                  {design.eyebrow}
                </div>
              )}
              <h1 className={`${heroSizeClass} reveal-2 leading-[1.05] mb-5 max-w-3xl mx-auto`}
                  style={{ fontFamily: fontPair.display, color: design.text }}>
                {c.hero_title}
              </h1>
              <p className="text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto reveal-3" style={{ color: design.textMuted }}>
                {c.hero_sub}
              </p>
            </div>
          )}

          {/* CTA inline (non-form layouts) */}
          {def.sections.includes('cta') && !def.sections.includes('form') && c.cta_href && (
            <div className={`${design.hero === 'magazine' ? 'mt-8' : 'mt-10 text-center'}`}>
              <a href={c.cta_href}
                 className="reveal-4 inline-block px-8 py-4 text-base font-bold transition-all hover:brightness-110 hover:scale-[1.02]"
                 style={{
                   background: `linear-gradient(135deg, ${design.primary}, ${design.secondary})`,
                   color: design.isDark ? '#fff' : (design.bg === '#FFFFFF' ? '#000' : design.bg),
                   borderRadius: r.button,
                   boxShadow: `0 8px 24px ${alpha(design.primary, .35)}`,
                 }}>
                {c.cta_label}
              </a>
            </div>
          )}
        </section>

        {/* ═══ VIDEO ═══ */}
        {def.sections.includes('video') && c.video_url && (
          <section className="mb-16">
            <div className="overflow-hidden" style={{ borderRadius: r.card, border: `1px solid ${design.border}` }}>
              <div className="aspect-video">
                <iframe src={c.video_url} className="w-full h-full" allowFullScreen allow="autoplay; encrypted-media" />
              </div>
            </div>
          </section>
        )}

        {/* ═══ TRUST ═══ */}
        {def.sections.includes('trust') && c.trust_signals && c.trust_signals.length > 0 && (
          <section className={d.section}>
            <div className={`grid grid-cols-1 sm:grid-cols-3 ${d.gap}`}>
              {c.trust_signals.map((t, i) => (
                <div key={i} className={`${cardClass} ${d.cardPad} text-center`}
                     style={{ ...cardBaseStyle(), borderRadius: r.card }}>
                  <div className="text-4xl mb-3">{t.icon}</div>
                  <div className="font-semibold text-base" style={{ color: design.text }}>{t.label}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ═══ STORY ═══ */}
        {def.sections.includes('story') && c.story && c.story.length > 0 && (
          <section className={d.section}>
            <div className="max-w-2xl mx-auto">
              {c.story.map((s, i) => (
                <div key={i} className="mb-10">
                  <h3 className="text-2xl sm:text-3xl font-bold mb-4"
                      style={{ fontFamily: fontPair.display, color: design.text }}>
                    {s.title}
                  </h3>
                  <p className="leading-loose text-lg" style={{ color: design.textMuted }}>{s.body}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ═══ QUALIFIER ═══ */}
        {def.sections.includes('qualifier') && c.qualifier && (
          <section className={d.section}>
            <div className={`${d.cardPad} max-w-3xl mx-auto`}
                 style={{
                   borderRadius: r.card,
                   background: alpha(design.primary, .08),
                   border: `2px solid ${design.primary}`,
                 }}>
              <div className="mb-3 text-xs font-bold uppercase tracking-widest" style={{ color: design.primary }}>
                ⚠️ זה לא לכולם
              </div>
              <p className="leading-relaxed text-lg" style={{ color: design.text }}>{c.qualifier}</p>
            </div>
          </section>
        )}

        {/* ═══ WEBINAR INFO ═══ */}
        {def.sections.includes('webinar_info') && c.webinar_at && (
          <section className={d.section}>
            <div className={`${cardClass} ${d.cardPad} text-center max-w-2xl mx-auto`}
                 style={{ ...cardBaseStyle(), borderRadius: r.card }}>
              <div className="mb-3 text-xs font-bold uppercase tracking-widest" style={{ color: design.primary }}>
                📅 מועד השידור
              </div>
              <div className="text-3xl font-bold"
                   style={{ fontFamily: fontPair.display, color: design.text }}>
                {new Date(c.webinar_at).toLocaleString('he')}
              </div>
            </div>
          </section>
        )}

        {/* ═══ COUNTDOWN ═══ */}
        {def.sections.includes('countdown') && cd && !cd.expired && (
          <section className={d.section}>
            <div className="text-center">
              <div className="mb-4 text-xs font-bold uppercase tracking-widest" style={{ color: design.textMuted }}>
                זמן עד תחילת המבצע
              </div>
              <div className="flex justify-center gap-3 sm:gap-4">
                {[['ימים', cd.d],['שעות', cd.h],['דקות', cd.m],['שניות', cd.s]].map(([l, v]) => (
                  <div key={l as string} className={`${cardClass} px-5 py-4 min-w-[72px] sm:min-w-[88px]`}
                       style={{ ...cardBaseStyle(), borderRadius: r.card }}>
                    <div className="font-mono text-3xl sm:text-4xl font-bold tabular-nums" style={{ color: design.primary }}>
                      {(v as number).toString().padStart(2, '0')}
                    </div>
                    <div className="mt-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: design.textMuted }}>
                      {l}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ═══ BULLETS ═══ */}
        {def.sections.includes('bullets') && c.bullets && c.bullets.length > 0 && (
          <section className={d.section}>
            <ul className={`grid grid-cols-1 sm:grid-cols-2 ${d.gap} max-w-3xl mx-auto`}>
              {c.bullets.map((b, i) => (
                <li key={i} className={`${cardClass} flex items-start gap-3 ${d.cardPad}`}
                    style={{ ...cardBaseStyle(), borderRadius: r.card }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 font-bold text-sm"
                       style={{
                         background: `linear-gradient(135deg, ${design.primary}, ${design.secondary})`,
                         color: '#fff',
                       }}>
                    ✓
                  </div>
                  <span className="leading-relaxed text-base" style={{ color: design.text }}>
                    {b.replace(/^[^a-zא-ת]*/, '')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ═══ TESTIMONIALS ═══ */}
        {def.sections.includes('testimonials') && c.testimonials && c.testimonials.length > 0 && (
          <section className={d.section}>
            <div className="mb-8 text-center text-xs font-bold uppercase tracking-widest" style={{ color: design.textMuted }}>
              לקוחות שעברו את התהליך
            </div>
            <div className={`grid grid-cols-1 sm:grid-cols-2 ${d.gap} max-w-4xl mx-auto`}>
              {c.testimonials.map((t, i) => (
                <div key={i} className={`${cardClass} ${d.cardPad} relative`}
                     style={{ ...cardBaseStyle(), borderRadius: r.card }}>
                  <div className="text-6xl absolute top-2 right-4 opacity-30 leading-none"
                       style={{ color: design.accent, fontFamily: fontPair.display }}>"</div>
                  <p className="leading-relaxed mb-4 relative pt-3" style={{ color: design.text }}>{t.quote}</p>
                  <div className="border-t pt-3" style={{ borderColor: design.border }}>
                    <div className="font-bold" style={{ color: design.text }}>{t.name}</div>
                    {t.role && <div className="text-sm" style={{ color: design.textMuted }}>{t.role}</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ═══ FAQ ═══ */}
        {def.sections.includes('faq') && c.faq && c.faq.length > 0 && (
          <section className={d.section}>
            <h3 className="text-3xl sm:text-4xl font-bold mb-8 text-center"
                style={{ fontFamily: fontPair.display, color: design.text }}>
              שאלות נפוצות
            </h3>
            <div className={`space-y-3 max-w-2xl mx-auto`}>
              {c.faq.map((f, i) => (
                <details key={i} className={`${cardClass} ${d.cardPad} group cursor-pointer`}
                         style={{ ...cardBaseStyle(), borderRadius: r.card }}>
                  <summary className="font-semibold flex items-center justify-between list-none"
                           style={{ color: design.text }}>
                    <span>{f.q}</span>
                    <span className="text-xl transition-transform group-open:rotate-45 flex-shrink-0 mr-3"
                          style={{ color: design.primary }}>+</span>
                  </summary>
                  <p className="mt-3 leading-relaxed" style={{ color: design.textMuted }}>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* ═══ FORM ═══ */}
        {def.sections.includes('form') && (
          <section className={d.section}>
            <div className={`${cardClass} max-w-md mx-auto ${d.cardPad}`}
                 style={{ ...cardBaseStyle(), borderRadius: r.card, padding: '2rem' }}>
              {submitted ? (
                <div className="text-center py-6">
                  <div className="text-6xl mb-3">🎉</div>
                  <div className="text-2xl font-bold mb-2"
                       style={{ fontFamily: fontPair.display, color: design.text }}>תודה!</div>
                  <p style={{ color: design.textMuted }}>קיבלנו את הפרטים שלך — נחזור אליך בהקדם.</p>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-3">
                  {c.form_fields.map(f => (
                    <div key={f.name}>
                      <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: design.textMuted }}>
                        {f.label}{f.required && ' *'}
                      </label>
                      {f.type === 'textarea' ? (
                        <textarea
                          required={f.required}
                          rows={3}
                          value={formVals[f.name] || ''}
                          onChange={e => setFormVals(v => ({ ...v, [f.name]: e.target.value }))}
                          className="w-full px-4 py-3 outline-none border transition-colors focus:border-current"
                          style={{ background: design.bgAlt, borderColor: design.border, color: design.text, borderRadius: r.button }}
                        />
                      ) : (
                        <input
                          type={f.type}
                          required={f.required}
                          value={formVals[f.name] || ''}
                          onChange={e => setFormVals(v => ({ ...v, [f.name]: e.target.value }))}
                          dir={f.type === 'email' || f.type === 'tel' ? 'ltr' : 'rtl'}
                          className="w-full px-4 py-3 outline-none border transition-colors focus:border-current"
                          style={{ background: design.bgAlt, borderColor: design.border, color: design.text, borderRadius: r.button }}
                        />
                      )}
                    </div>
                  ))}
                  {err && <div className="text-sm" style={{ color: '#DC2626' }}>❌ {err}</div>}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-4 mt-2 text-base font-bold transition-all hover:brightness-110 hover:scale-[1.01] disabled:opacity-50 disabled:scale-100"
                    style={{
                      background: `linear-gradient(135deg, ${design.primary}, ${design.secondary})`,
                      color: '#fff',
                      borderRadius: r.button,
                      boxShadow: `0 8px 20px ${alpha(design.primary, .3)}`,
                    }}>
                    {submitting ? 'שולח...' : c.cta_label}
                  </button>
                </form>
              )}
            </div>
          </section>
        )}

        {/* ═══ FOOTER ═══ */}
        <div className="text-center py-10 text-xs" style={{ color: design.textMuted }}>
          נבנה ב-AdMaster Pro
        </div>
      </div>
    </div>
  );
}
