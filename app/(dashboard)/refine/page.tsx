'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Textarea, Btn, OutputBox, CopyBtn, CostBadge, Alert, PageHeader, Chip, Spinner } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import { ScoreBadge } from '@/components/ScoreBadge';
import { ScorePanel } from '@/components/ScorePanel';
import { BoostButton } from '@/components/BoostButton';
import type { ScoreResult } from '@/lib/scoring';

const QUICK_FEEDBACK = [
  'קצר יותר',
  'יותר מקצועי',
  'יותר אישי וחם',
  'דחיפות חזקה יותר',
  'הוסף נתון מספרי',
  'CTA חד יותר',
  'הסר אמוג\'ים',
  'הוסף אמוג\'ים',
];

const FREE_ITERATIONS = 5;

const xt = (raw: string, t: string) => {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
};

export default function RefinePage() {
  const [original,  setOriginal]   = useState('');
  const [current,   setCurrent]    = useState('');
  const [feedback,  setFeedback]   = useState('');
  const [diff,      setDiff]       = useState('');
  const [iterCount, setIterCount]  = useState(0);
  const [history,   setHistory]    = useState<{ feedback: string; refined: string }[]>([]);
  const { call, loading, error }   = useAI();
  const [score, setScore]             = useState<(ScoreResult & { score_id: string; iteration: number; max: number }) | null>(null);
  const [showPanel, setShowPanel]     = useState(false);
  const [scoreLoading, setScoreLoading] = useState(false);

  const supabase = createClient();
  const isFree = iterCount < FREE_ITERATIONS;

  async function fetchScore(copy: string) {
    if (!copy) return;
    setScoreLoading(true);
    setScore(null);
    try {
      const r = await fetch('/api/ai/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copy, channel: 'meta_feed', locale: 'he', source: { kind: 'refine' } }),
      });
      const data = await r.json();
      if (data.ok) setScore({ ...data, iteration: 0, max: 2 });
    } catch (e) { console.error('[refine] score failed', e); }
    finally { setScoreLoading(false); }
  }

  async function refine() {
    const baseText = current || original;
    if (!baseText.trim() || !feedback.trim()) return;

    const system = `אתה עורך copy מקצועי. קיבלת מודעה / פוסט שיווקי, ופידבק על מה לשפר.
החזר גרסה משופרת שמיישמת את הפידבק, אבל שומרת על הליבה והמסר המרכזי.
החזר בפורמט הזה בלבד:
[REFINED]הגרסה המשופרת המלאה[/REFINED]
[DIFF]הסבר קצר (2-3 שורות) של מה השתנה[/DIFF]`;

    const prompt = `טקסט מקור:\n${baseText}\n\nפידבק לשיפור:\n${feedback}`;

    // First iteration costs full price; subsequent free up to FREE_ITERATIONS
    const text = await call('refine', system, prompt, 1500);
    if (!text) return;

    const refined = xt(text, 'REFINED');
    const newDiff = xt(text, 'DIFF');

    setHistory(p => [...p, { feedback, refined }]);
    setCurrent(refined);
    fetchScore(refined);
    setDiff(newDiff);
    setIterCount(c => c + 1);
    setFeedback('');

    // Save refinement to DB
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('refinements').insert({
        user_id:       user.id,
        original_text: original,
        refined_text:  refined,
        feedback,
        iteration:     iterCount + 1,
      });
    }
  }

  function reset() {
    setOriginal(''); setCurrent(''); setFeedback(''); setDiff('');
    setIterCount(0); setHistory([]);
  }

  function startWith(text: string) {
    setOriginal(text); setCurrent(''); setIterCount(0); setHistory([]); setDiff('');
  }

  return (
    <div>
      <PageHeader
        eyebrow="Refinement"
        title="🔁 שיפור אוטומטי"
        sub="פידבק → גרסה משופרת. 5 איטרציות ראשונות חינם."
        right={<CostBadge cost={4} />}
      />

      {/* Iteration counter */}
      <div className="flex items-center justify-between mb-4 bg-[#152138] border border-[#243752] rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-bold text-[#2E4459] uppercase tracking-widest">איטרציה</div>
          <div className="font-mono text-lg font-medium text-[#D9E8F5]">{iterCount}</div>
          <div className="text-xs text-[#6B8FA8]">/ {FREE_ITERATIONS} חופשיות</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-32 h-1.5 bg-[#22334D] rounded-full overflow-hidden">
            <div className="h-full transition-all" style={{
              width: `${Math.min(100, (iterCount / FREE_ITERATIONS) * 100)}%`,
              background: iterCount >= FREE_ITERATIONS ? '#D97706' : 'linear-gradient(90deg,#0A7AFF,#3D9FFF)',
            }} />
          </div>
          {iterCount > 0 && <Btn variant="ghost" size="xs" onClick={reset}>↺ אתחל</Btn>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          {!original && !current && (
            <Card className="mb-3">
              <CardLabel>טקסט מקור</CardLabel>
              <Textarea value={original} onChange={setOriginal} placeholder="הדבק את המודעה / הפוסט שאתה רוצה לשפר..." rows={8} />
              <Btn variant="primary" full onClick={() => { if (original.trim()) startWith(original); }} disabled={!original.trim()}>
                ✓ אישור — התחל לשפר
              </Btn>
            </Card>
          )}

          {(original || current) && (
            <>
              <Card className="mb-3">
                <CardLabel>פידבק לשיפור</CardLabel>
                <Textarea value={feedback} onChange={setFeedback} placeholder="לדוגמה: 'הלקוח אמר שזה יותר מדי ארוך, צריך לקצר ולהוסיף יותר דחיפות'" rows={3} />
                <div className="text-[10px] font-bold text-[#2E4459] uppercase mt-2 mb-1.5">תיקונים מהירים</div>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_FEEDBACK.map(q => (
                    <Chip key={q} label={q} onClick={() => setFeedback(p => p ? `${p}, ${q}` : q)} />
                  ))}
                </div>
              </Card>

              <Btn variant="violet" full loading={loading} onClick={refine} disabled={!feedback.trim()}>
                🔁 הפעל שיפור{!isFree && ' (4 קרדיטים)'}
              </Btn>
              {error && <Alert type="red">❌ {error}</Alert>}

              <Card className="mt-3">
                <CardLabel>טקסט מקור</CardLabel>
                <div className="text-[12.5px] text-[#6B8FA8] leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">{original}</div>
              </Card>
            </>
          )}
        </div>

        <div>
          {current ? (
            <>
              <Card className="mb-3" style={{borderColor: 'rgba(109,40,217,.3)'}}>
                <div className="flex items-center justify-between mb-2">
                  <CardLabel>✨ גרסה נוכחית</CardLabel>
                  <span className="text-[10px] text-[#A78BFA] font-mono">איטרציה {iterCount}</span>
                </div>
                <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-[#D9E8F5]">{current}</div>
                <div className="mt-3"><CopyBtn text={current} /></div>
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
                              setCurrent(b.copy);
                              setScore(prev => prev ? { ...prev, ...b } : prev);
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
              </Card>

              {diff && (
                <Card style={{borderColor: 'rgba(217,119,6,.3)'}}>
                  <CardLabel>💡 מה השתנה</CardLabel>
                  <div className="text-[12.5px] text-[#D97706] leading-relaxed whitespace-pre-wrap">{diff}</div>
                </Card>
              )}

              {history.length > 1 && (
                <Card className="mt-3">
                  <CardLabel>היסטוריית איטרציות</CardLabel>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {history.slice(0, -1).map((h, i) => (
                      <div key={i} className="bg-[#1A2A42] rounded-lg p-2.5">
                        <div className="text-[10px] font-bold text-[#2E4459] mb-1">איטרציה {i+1} · "{h.feedback}"</div>
                        <div className="text-[11.5px] text-[#6B8FA8] line-clamp-3 whitespace-pre-wrap">{h.refined}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]">
              <span className="text-5xl mb-3 opacity-30">🔁</span>
              <span className="text-sm">הזן טקסט מקור ופידבק להתחיל</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
