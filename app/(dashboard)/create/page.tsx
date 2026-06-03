'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardLabel, Chip, Textarea, Btn, OutputBox, Tabs, CopyBtn, CostBadge, Alert, PageHeader, Spinner } from '@/components/ui';
import { FRAMEWORKS, FRAMEWORKS_BY_ID, type FrameworkId } from '@/lib/frameworks';
import { MASTER_NOTES_MAX, type MasterV2Output } from '@/lib/master-studio';
import { ScoreBadge } from '@/components/ScoreBadge';
import { ScorePanel } from '@/components/ScorePanel';
import { BoostButton } from '@/components/BoostButton';
import type { ScoreResult } from '@/lib/scoring';

const PLATFORMS = [
  { id: 'facebook',  l: 'Facebook',  i: '📘' },
  { id: 'instagram', l: 'Instagram', i: '📸' },
  { id: 'whatsapp',  l: 'WhatsApp',  i: '💬' },
  { id: 'tiktok',    l: 'TikTok',    i: '🎵' },
];
const TONES = ['חם ואישי','מקצועי','חסידי','דחיפות','סיפור'];
const TYPES = ['הצגת מוצר','מבצע','בניית אמון','שאלה לקהל','טיפ מקצועי'];
const HOOKS = ['שאלה פרובוקטיבית','עובדה מפתיעה','סיפור אישי','הצעה חסרת תחרות','אזהרה'];

const STAGE_LABELS = ['', 'מנתח קהל ובוחר 3 משווקים…', '3 משווקים כותבים + השופט בוחר…', 'משייף את הזוכה…'];

export default function CreatePage() {
  const [plt,  setPlt]   = useState('facebook');
  const [tone, setTone]  = useState('חם ואישי');
  const [type, setType]  = useState('הצגת מוצר');

  // Override (optional)
  const [fwOverride,   setFwOverride]   = useState<FrameworkId | null>(null);
  const [hookOverride, setHookOverride] = useState<string | null>(null);

  const [brief,       setBrief]       = useState('');
  const [masterNotes, setMasterNotes] = useState('');

  // Client brief picker — pass brief_id so generation grounds in a real saved brief.
  const [briefs,  setBriefs]  = useState<Array<{ id: string; values?: { biz_name?: string }; submitted_at?: string; status?: string }>>([]);
  const [briefId, setBriefId] = useState('');

  const [tab,  setTab]   = useState('post');
  const [out,  setOut]   = useState<MasterV2Output | null>(null);
  const [revealOpen, setRevealOpen] = useState(true);

  const [score, setScore]               = useState<(ScoreResult & { score_id: string; iteration: number; max: number }) | null>(null);
  const [showPanel, setShowPanel]       = useState(false);
  const [scoreLoading, setScoreLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [stage,   setStage]   = useState<0 | 1 | 2 | 3>(0); // 0 idle, 1 strategist, 2 creators+judge, 3 editor
  const pLabel = PLATFORMS.find(p => p.id === plt)?.l ?? plt;

  useEffect(() => {
    fetch('/api/briefs')
      .then(r => (r.ok ? r.json() : []))
      .then(d => { if (Array.isArray(d)) setBriefs(d); })
      .catch(() => { /* no briefs is fine */ });
  }, []);

  async function fetchScore(copy: string, sourceId?: string) {
    if (!copy) return;
    setScoreLoading(true);
    setScore(null);
    try {
      const r = await fetch('/api/ai/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copy,
          channel: 'meta_feed',
          locale:  'he',
          source:  { kind: 'master_post', id: sourceId },
        }),
      });
      const data = await r.json();
      if (data.ok) setScore({ ...data, iteration: 0, max: 2 });
    } catch (e) { console.error('[create] score failed', e); }
    finally { setScoreLoading(false); }
  }

  async function generate() {
    if (!brief.trim()) return;
    setLoading(true); setStage(1); setError(null); setOut(null); setScore(null);
    // Real progress: the route streams NDJSON stage events as each stage begins.
    const STAGE_NUM: Record<string, 1 | 2 | 3> = { strategist: 1, creators: 2, judge: 2, editor: 3 };
    try {
      const res = await fetch('/api/ai/master', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief,
          masterNotes: masterNotes.slice(0, MASTER_NOTES_MAX),
          platform:    pLabel,
          tone,
          type,
          framework:   fwOverride ?? undefined,
          hook:        hookOverride ?? undefined,
          locale:      'he',
          brief_id:    briefId || undefined,
        }),
      });

      // Pre-stream guards (401/429/400/402) return plain JSON, not a stream.
      if (!res.ok || !res.body) {
        let msg = 'שגיאה ביצירה — נסה שוב';
        try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
        setError(msg);
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '', streamDone = false;
      while (!streamDone) {
        const { value, done } = await reader.read();
        streamDone = done;
        buf += decoder.decode(value ?? new Uint8Array(), { stream: !streamDone });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let evt: any;
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.type === 'stage') {
            setStage(STAGE_NUM[evt.stage] ?? 2);
          } else if (evt.type === 'result') {
            const { type: _t, credits: _c, ...output } = evt;
            setOut(output as MasterV2Output);
            if (output.winner?.draft?.post) fetchScore(output.winner.draft.post);
            setTab('post');
            setRevealOpen(true);
          } else if (evt.type === 'error') {
            setError(evt.error ?? 'שגיאה ביצירה — נסה שוב');
          }
        }
      }
    } catch {
      setError('שגיאת רשת — נסה שוב');
    } finally {
      setLoading(false); setStage(0);
    }
  }

  const TABS = [
    { id: 'post',     label: '📝 פוסט' },
    { id: 'wa',       label: '💬 WhatsApp' },
    { id: 'img',      label: '🖼 תמונה' },
    { id: 'hashtags', label: '# האשטגים' },
    { id: 'tips',     label: '💡 טיפים' },
  ];

  return (
    <div>
      <PageHeader eyebrow="יצירה" title="צור פוסט" sub="מבריף קצר לפוסט מקצועי"
        right={<CostBadge cost={6} />} />

      <div className="grid grid-cols-2 gap-4">
        {/* Left — settings */}
        <div>
          <Card className="mb-3">
            <CardLabel>פלטפורמה</CardLabel>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {PLATFORMS.map(p => <Chip key={p.id} label={`${p.i} ${p.l}`} active={plt===p.id} onClick={()=>setPlt(p.id)} />)}
            </div>
            <CardLabel>סוג פוסט</CardLabel>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {TYPES.map(t => <Chip key={t} label={t} active={type===t} onClick={()=>setType(t)} />)}
            </div>
            <CardLabel>טון</CardLabel>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map(t => <Chip key={t} label={t} active={tone===t} onClick={()=>setTone(t)} />)}
            </div>

            <div className="border-t border-[#1E2F42] pt-3 mt-3">
              <CardLabel>🎛 Override (אופציונלי)</CardLabel>
              <div className="text-[11px] text-[#2E4459] mb-2">
                כברירת מחדל — ה-AI בוחר את ה-framework וה-hook. לחץ chip לכפיית בחירה.
              </div>

              <div className="text-[11px] text-[#6B8FA8] mb-1">Framework</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <Chip label="— AI יבחר —" active={fwOverride===null} onClick={() => setFwOverride(null)} />
                {FRAMEWORKS.map(f => (
                  <Chip
                    key={f.id}
                    label={`${f.emoji} ${f.name_he.split('—')[0].trim()}`}
                    active={fwOverride===f.id}
                    onClick={() => setFwOverride(fwOverride === f.id ? null : f.id)}
                  />
                ))}
              </div>
              {fwOverride && (
                <div className="text-[10px] text-[#6B8FA8] bg-[#162030] rounded-lg px-3 py-2 mb-3 leading-relaxed">
                  <strong className="text-[#D9E8F5]">{FRAMEWORKS_BY_ID[fwOverride].name_en}:</strong> {FRAMEWORKS_BY_ID[fwOverride].description}
                </div>
              )}

              <div className="text-[11px] text-[#6B8FA8] mb-1">Hook</div>
              <div className="flex flex-wrap gap-1.5">
                <Chip label="— AI יבחר —" active={hookOverride===null} onClick={() => setHookOverride(null)} />
                {HOOKS.map(h => (
                  <Chip
                    key={h}
                    label={h}
                    active={hookOverride===h}
                    onClick={() => setHookOverride(hookOverride === h ? null : h)}
                  />
                ))}
              </div>
            </div>
          </Card>

          {briefs.length > 0 && (
            <Card className="mb-3">
              <CardLabel>📋 בריף לקוח (אופציונלי)</CardLabel>
              <div className="text-[11px] text-[#2E4459] mb-2">
                בחר בריף לקוח קיים — היצירה תתבסס על הנתונים האמיתיים שבו (מוצר, מחיר, קהל, אווטאר) ולא תמציא. ללא בחירה — היצירה מתבססת על הטקסט למטה בלבד.
              </div>
              <select
                value={briefId}
                onChange={(e) => setBriefId(e.target.value)}
                className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2 text-sm text-[#D9E8F5] focus:outline-none focus:border-[#0A7AFF]"
              >
                <option value="">— ללא בריף לקוח —</option>
                {briefs.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.values?.biz_name || 'ללא שם'}{b.submitted_at ? ` · ${new Date(b.submitted_at).toLocaleDateString('he')}` : ''}
                  </option>
                ))}
              </select>
              {briefId && (
                <div className="text-[10px] text-[#0A7AFF] mt-1.5">✓ היצירה תתבסס על בריף הלקוח הזה</div>
              )}
            </Card>
          )}

          <Card className="mb-3">
            <CardLabel>בריף</CardLabel>
            <Textarea value={brief} onChange={setBrief}
              placeholder="תאר מה אתה רוצה לפרסם. לדוגמה: מבצע לחג שבועות — תפילין מהודרות 15% הנחה לבני מצווה..."
              rows={4} />
          </Card>

          <Card className="mb-3" style={{ borderColor: '#3D2F6B' }}>
            <CardLabel>🔒 הערות מאסטר (עדיפות עליונה)</CardLabel>
            <Textarea
              value={masterNotes}
              onChange={(v) => setMasterNotes(v.slice(0, MASTER_NOTES_MAX))}
              placeholder="הוראות שמועדפות על הכל. למשל: לא להזכיר מחיר, להדגיש את הסבא, להימנע ממילת 'מבצע'..."
              rows={3}
            />
            <div className="text-[10px] text-[#2E4459] mt-1 text-left" dir="ltr">
              {masterNotes.length} / {MASTER_NOTES_MAX}
            </div>
          </Card>

          <Btn variant="primary" full loading={loading} onClick={generate} disabled={!brief.trim()}>
            ✨ צור פוסט
          </Btn>
          {error && <Alert type="red" className="mt-3">❌ {error}</Alert>}
        </div>

        {/* Right — output */}
        <div>
          {out ? (
            <>
              <Card className="mb-3" style={{ borderColor: '#2A3E66' }}>
                <button
                  onClick={() => setRevealOpen(o => !o)}
                  className="w-full flex items-center justify-between text-right"
                >
                  <span className="text-[13px] font-semibold text-[#D9E8F5] flex items-center gap-2">
                    🧠 למה זה עובד
                  </span>
                  <span className="text-[#6B8FA8] text-xs">{revealOpen ? '▾' : '▸'}</span>
                </button>

                {revealOpen && (
                  <div className="mt-3 space-y-3 text-[12px] leading-relaxed">
                    {/* Winning marketer + score + boosted badge */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xl">{out.winner.marketer.emoji}</span>
                      <span className="font-semibold text-[#D9E8F5]">{out.winner.marketer.name}</span>
                      <span className="mr-auto text-[11px] font-semibold rounded-full bg-[#0A7AFF] text-white px-2.5 py-0.5">
                        ציון {out.winner.score}
                      </span>
                      {out.boosted && (
                        <span className="text-[11px] font-semibold rounded-full bg-emerald-500 text-white px-2.5 py-0.5">
                          שופר ✨
                        </span>
                      )}
                    </div>

                    {/* Runner-ups */}
                    {out.marketers.filter(m => m.id !== out.winner.marketer.id).length > 0 && (
                      <p className="text-[11px] text-[#6B8FA8]">
                        התחרה מול:{' '}
                        {out.marketers
                          .filter(m => m.id !== out.winner.marketer.id)
                          .map(m => `${m.emoji} ${m.name}`)
                          .join(' · ')}
                      </p>
                    )}

                    {/* Judge rationale */}
                    {out.judgeRationale && (
                      <div className="border-t border-[#1E2F42] pt-2">
                        <div className="text-[11px] font-bold text-[#6B8FA8] uppercase tracking-wider mb-1">⚖️ למה השופט בחר בזה</div>
                        <p className="text-[#D9E8F5]">{out.judgeRationale}</p>
                      </div>
                    )}

                    {/* Principles applied (from the winning draft) */}
                    {out.winner.draft.principles.length > 0 && (
                      <div className="border-t border-[#1E2F42] pt-2">
                        <div className="text-[11px] font-bold text-[#6B8FA8] uppercase tracking-wider mb-1">📚 עקרונות שיושמו</div>
                        <ul className="space-y-1 text-[#D9E8F5]">
                          {out.winner.draft.principles.map((p, i) => (
                            <li key={i}>
                              <span className="font-semibold text-[#3D9FFF]">{p.principle}</span>
                              {p.application && <span className="text-[#6B8FA8]"> → {p.application}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Collapsible avatar profile */}
                    {out.avatar && (
                      <details className="border-t border-[#1E2F42] pt-2">
                        <summary className="cursor-pointer text-[11px] font-bold text-[#6B8FA8] uppercase tracking-wider">👤 פרופיל האווטאר</summary>
                        <div className="mt-2 space-y-0.5 text-[#D9E8F5]">
                          {out.avatar.persona         && <div><span className="text-[#6B8FA8]">פרסונה:</span> {out.avatar.persona}</div>}
                          {out.avatar.fears           && <div><span className="text-[#6B8FA8]">פחדים:</span> {out.avatar.fears}</div>}
                          {out.avatar.desires         && <div><span className="text-[#6B8FA8]">רצונות:</span> {out.avatar.desires}</div>}
                          {out.avatar.awareness_level && <div><span className="text-[#6B8FA8]">מודעות:</span> {out.avatar.awareness_level}</div>}
                          {out.avatar.objections      && <div><span className="text-[#6B8FA8]">התנגדויות:</span> {out.avatar.objections}</div>}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </Card>

              <Tabs tabs={TABS} active={tab} onChange={setTab} />

              {tab === 'post' && (
                <>
                  <OutputBox text={out.winner.draft.post} />
                  <div className="flex gap-2 mt-2">
                    <CopyBtn text={out.winner.draft.post + '\n\n' + out.winner.draft.hashtags.join(' ')} />
                    <Btn variant="ghost" size="sm" onClick={generate} disabled={loading}>🔄 שוב</Btn>
                  </div>
                  {(score || scoreLoading) && (
                    <div className="flex items-center gap-3 mt-3" dir="rtl">
                      {scoreLoading && <Spinner size={14} />}
                      {score && (
                        <>
                          <ScoreBadge score={score.score} band={score.band} onClick={() => setShowPanel(v => !v)} />
                          {score.band !== 'high' && (
                            <BoostButton
                              priorScoreId={score.score_id}
                              iteration={score.iteration}
                              max={score.max}
                              onBoosted={(b) => {
                                setOut(prev => prev ? { ...prev, winner: { ...prev.winner, draft: { ...prev.winner.draft, post: b.copy } } } : prev);
                                setScore(prev => prev ? { ...prev, score: b.score, band: b.band, score_id: b.score_id, iteration: b.iteration, max: b.max } : prev);
                              }}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {showPanel && score && (
                    <div className="mt-3 max-w-md">
                      <ScorePanel result={score} onClose={() => setShowPanel(false)} />
                    </div>
                  )}
                </>
              )}

              {tab === 'wa' && (
                <>
                  <OutputBox text={out.winner.draft.whatsapp} />
                  <CopyBtn text={out.winner.draft.whatsapp} className="mt-2" />
                </>
              )}

              {tab === 'img' && (
                <>
                  <Card className="bg-[#162030]">
                    <CardLabel>Prompt לתמונה</CardLabel>
                    <div className="text-sm leading-relaxed" dir="ltr" style={{ textAlign: 'left' }}>{out.winner.draft.image}</div>
                  </Card>
                  <div className="flex gap-2 mt-2">
                    <Link
                      href={`/images?prompt=${encodeURIComponent(out.winner.draft.image.slice(0, 2000))}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-lg bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white shadow-[0_4px_14px_rgba(10,122,255,0.3)] transition-colors"
                    >
                      🎨 פתח במחולל התמונות (3⚡)
                    </Link>
                    <CopyBtn text={out.winner.draft.image} label="📋 העתק prompt" />
                  </div>
                </>
              )}

              {tab === 'hashtags' && (
                <div className="flex flex-wrap gap-2">
                  {out.winner.draft.hashtags.map((h, i) => (
                    <span key={i} className="bg-[#0A7AFF]/10 border border-[#0A7AFF]/20 text-[#3D9FFF] px-3 py-1 rounded-full text-sm font-medium">{h}</span>
                  ))}
                  <CopyBtn text={out.winner.draft.hashtags.join(' ')} className="mt-2 w-full" />
                </div>
              )}

              {tab === 'tips' && <OutputBox text={out.winner.draft.tips} className="text-sm" />}
            </>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#2A4158] rounded-xl text-[#6B8FA8] gap-4">
              <Spinner size={28} />
              <span className="text-sm font-medium text-[#D9E8F5]">{STAGE_LABELS[stage]}</span>
              <div className="flex items-center gap-2">
                {[1, 2, 3].map(s => (
                  <span
                    key={s}
                    className={`h-1.5 w-8 rounded-full transition-colors ${stage >= s ? 'bg-[#0A7AFF]' : 'bg-[#1E2F42]'}`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <span className="text-4xl mb-3 opacity-30">✨</span>
              <span className="text-sm">מלא בריף ולחץ "צור פוסט"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
