'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Chip, Textarea, Btn, OutputBox, CopyBtn, Alert, PageHeader } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';

type Mode = 'merge' | 'reframe' | 'translate';

const MODES: { id: Mode; emoji: string; label: string; desc: string }[] = [
  { id:'merge',     emoji:'🧬', label:'Merge',     desc:'משלב את שני התכנים לפוסט אחד חדש שמשלב את החוזקות' },
  { id:'reframe',   emoji:'🔄', label:'Reframe',   desc:'משנה את הזווית — אותו מסר, נקודת מבט שונה' },
  { id:'translate', emoji:'🎭', label:'Translate', desc:'מתאים את התוכן לפלטפורמה / טון / קהל אחרים' },
];

const PLATFORMS = ['Facebook', 'Instagram', 'WhatsApp', 'TikTok', 'LinkedIn', 'Email'];
const TONES     = ['חם ואישי', 'מקצועי', 'דחיפות', 'משעשע', 'יוקרתי'];

export default function LabPage() {
  const [mode,    setMode]    = useState<Mode>('merge');
  const [textA,   setTextA]   = useState('');
  const [textB,   setTextB]   = useState('');
  const [target,  setTarget]  = useState<{ platform: string; tone: string }>({ platform: 'Instagram', tone: 'חם ואישי' });
  const [output,  setOutput]  = useState('');
  const [history, setHistory] = useState<{ id: string; output: any; created_at: string }[]>([]);
  const { call, loading, error } = useAI();

  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('generated_content')
        .select('id, output, created_at')
        .eq('user_id', user.id)
        .in('type', ['post', 'lab', 'refined'])
        .order('created_at', { ascending: false })
        .limit(20)
        .then(({ data }) => setHistory(data ?? []));
    });
  }, []);

  async function generate() {
    const inputsValid = mode === 'translate' ? !!textA.trim() : !!textA.trim() && !!textB.trim();
    if (!inputsValid) return;
    setOutput('');

    const systemByMode: Record<Mode, string> = {
      merge:     `אתה עורך תוכן יצירתי. קיבלת שני פוסטים שיווקיים. צור פוסט חדש שמשלב את החוזקות של שניהם — לקח את ה-hook הטוב יותר, את ההצעה החדה יותר, ואת ה-CTA המנצח. הפוסט החדש צריך להישמע אחיד וטבעי, לא קטעי copy-paste. החזר רק את הטקסט הסופי.`,
      reframe:   `אתה אסטרטג שיווק. קיבלת שני פוסטים שיווקיים. ייצר פוסט חדש שמעביר את אותו מסר אבל מזווית שונה לגמרי — אם הם דיברו על הבעיה, דבר על ההזדמנות; אם הם דיברו על הפיצ'רים, דבר על התוצאה הרגשית. החזר רק את הטקסט הסופי.`,
      translate: `אתה מומחה התאמת תוכן. קיבלת פוסט שיווקי וצריך להתאים אותו לפלטפורמה ${target.platform} ולטון ${target.tone}. שמור על המסר אבל התאם אורך, סגנון, אמוג'ים ו-CTA למאפייני היעד. החזר רק את הטקסט הסופי.`,
    };

    const prompt = mode === 'translate'
      ? `פוסט מקור:\n${textA}`
      : `פוסט A:\n${textA}\n\nפוסט B:\n${textB}`;

    const text = await call('lab', systemByMode[mode], prompt, 1200);
    if (text) setOutput(text);
  }

  function loadFromHistory(item: any, slot: 'A' | 'B') {
    const txt = typeof item.output === 'string' ? item.output : (item.output?.text || JSON.stringify(item.output));
    if (slot === 'A') setTextA(txt); else setTextB(txt);
  }

  return (
    <div>
      <PageHeader
        eyebrow="The Lab"
        title="🧪 המעבדה"
        sub="שילוב, עיצוב מחדש ותרגום של תוכן קיים — ללא קרדיטים"
        right={
          <span className="inline-flex items-center gap-1 bg-[#059669]/15 border border-[#059669]/30 text-[#34D399] text-[11px] font-bold px-2 py-0.5 rounded-full">
            ⚡ חינם
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-3">
            <CardLabel>מצב</CardLabel>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {MODES.map(m => (
                <Chip key={m.id} label={`${m.emoji} ${m.label}`} active={mode===m.id} onClick={() => setMode(m.id)} />
              ))}
            </div>
            <div className="text-[11px] text-[#6B8FA8] bg-[#1A2A42] rounded-lg px-3 py-2 leading-relaxed">
              {MODES.find(m => m.id === mode)?.desc}
            </div>
          </Card>

          {mode === 'translate' && (
            <Card className="mb-3">
              <CardLabel>יעד</CardLabel>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">פלטפורמה</div>
                  <div className="flex flex-wrap gap-1.5">
                    {PLATFORMS.map(p => <Chip key={p} label={p} active={target.platform===p} onClick={() => setTarget(t => ({...t, platform: p}))} />)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">טון</div>
                  <div className="flex flex-wrap gap-1.5">
                    {TONES.map(t => <Chip key={t} label={t} active={target.tone===t} onClick={() => setTarget(p => ({...p, tone: t}))} />)}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <Card className="mb-3">
            <CardLabel>{mode === 'translate' ? 'תוכן מקור' : 'תוכן A'}</CardLabel>
            <Textarea value={textA} onChange={setTextA} placeholder="הדבק כאן פוסט קיים..." rows={5} />
          </Card>

          {mode !== 'translate' && (
            <Card className="mb-3">
              <CardLabel>תוכן B</CardLabel>
              <Textarea value={textB} onChange={setTextB} placeholder="הדבק כאן פוסט שני..." rows={5} />
            </Card>
          )}

          <Btn variant="primary" full loading={loading} onClick={generate}>
            🧪 הרץ במעבדה
          </Btn>
          {error && <Alert type="red">❌ {error}</Alert>}

          {history.length > 0 && (
            <Card className="mt-4">
              <CardLabel>טעון מההיסטוריה</CardLabel>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {history.map(h => {
                  const txt = typeof h.output === 'string' ? h.output : (h.output?.text || JSON.stringify(h.output));
                  return (
                    <div key={h.id} className="flex items-center gap-2 bg-[#1A2A42] rounded-lg p-2">
                      <div className="flex-1 text-[11px] text-[#6B8FA8] truncate">{txt.substring(0, 80)}</div>
                      <Btn variant="ghost" size="xs" onClick={() => loadFromHistory(h, 'A')}>→ A</Btn>
                      {mode !== 'translate' && <Btn variant="ghost" size="xs" onClick={() => loadFromHistory(h, 'B')}>→ B</Btn>}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        <div>
          {output ? (
            <>
              <OutputBox text={output} />
              <div className="flex gap-2 mt-2">
                <CopyBtn text={output} />
                <Btn variant="ghost" size="sm" onClick={generate} loading={loading}>🔄 הפעל שוב</Btn>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]">
              <span className="text-5xl mb-3 opacity-30">🧪</span>
              <span className="text-sm">הזן תוכן ובחר מצב להפעיל את המעבדה</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
