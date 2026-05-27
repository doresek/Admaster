'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Chip, Input, Btn, Alert, PageHeader, CostBadge, Tabs } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import type { MetaClient } from '@/types';

type Channel = 'email' | 'sms' | 'whatsapp';
type Goal    = 'lead_nurture' | 'onboarding' | 'reengagement' | 'launch';

const CHANNELS: { id: Channel; emoji: string; label: string }[] = [
  { id:'email',    emoji:'📧', label:'Email' },
  { id:'whatsapp', emoji:'💬', label:'WhatsApp' },
  { id:'sms',      emoji:'📱', label:'SMS' },
];

const GOALS: { id: Goal; label: string; sub: string }[] = [
  { id:'lead_nurture', label:'טיפוח לידים',    sub:'בניית אמון לאורך זמן' },
  { id:'onboarding',   label:'אונבורדינג',     sub:'הכנסת לקוחות חדשים' },
  { id:'reengagement', label:'החזרת לקוחות',   sub:'הפעלת לקוחות רדומים' },
  { id:'launch',       label:'השקת מוצר',      sub:'בנייה לקראת השקה' },
];

const DURATIONS = [30, 60, 90, 180];

const xt = (raw: string, t: string) => {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
};

interface SeriesMessage {
  day_offset: number;
  channel:    Channel;
  subject?:   string;
  body:       string;
  position:   number;
}

export default function SeriesPage() {
  const [tab,        setTab]        = useState('build');
  const [clients,    setClients]    = useState<MetaClient[]>([]);
  const [selC,       setSelC]       = useState<MetaClient|null>(null);
  const [name,       setName]       = useState('');
  const [goal,       setGoal]       = useState<Goal>('lead_nurture');
  const [duration,   setDuration]   = useState(60);
  const [channels,   setChannels]   = useState<Channel[]>(['email', 'whatsapp']);
  const [series,     setSeries]     = useState<{ id: string; name: string; duration_days: number; created_at: string; goal: string }[]>([]);
  const [scheduled,  setScheduled]  = useState<SeriesMessage[]>([]);
  const [savedId,    setSavedId]    = useState<string|null>(null);
  const { call, loading, error }    = useAI();

  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('meta_clients').select('*').eq('user_id', user.id).then(({ data }) => setClients(data ?? []));
      supabase.from('message_series').select('id, name, duration_days, created_at, goal').eq('user_id', user.id).order('created_at', { ascending: false })
        .then(({ data }) => setSeries(data ?? []));
    });
  }, []);

  function toggleCh(c: Channel) {
    setChannels(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c]);
  }

  async function build() {
    if (!name.trim() || channels.length === 0) return;
    setScheduled([]); setSavedId(null);

    const goalLabel = GOALS.find(g => g.id === goal)!.label;
    const channelList = channels.map(c => CHANNELS.find(x => x.id === c)!.label).join(', ');

    const system = `אתה אסטרטג Lifecycle Marketing.
תכנן סדרת הודעות מולטי-ערוצית למשך ${duration} ימים עבור קמפיין "${goalLabel}".
ערוצים זמינים: ${channelList}.
${selC ? `לקוח: ${selC.name} | תחום: ${selC.industry ?? 'כללי'}` : ''}

עקרונות:
- מקסימום 1-2 הודעות בשבוע (לא להציף)
- שלבים: היכרות → ערך → חיבור → הצעה → דחיפות → relations
- שלב את כל הערוצים הזמינים בחוכמה (כל ערוץ לתפקיד שלו)

החזר את התוכנית בפורמט הבא בלבד — כל שורה היא הודעה אחת:
[MSG day=<מספר ימים מההתחלה> ch=<email|sms|whatsapp>]
SUBJECT: <נושא — רק לאימייל, אחרת השמט>
BODY: <גוף ההודעה — לפי המגבלות של הערוץ>
[/MSG]
[MSG day=...]
...
[/MSG]

ייצר 8-20 הודעות בהתאם למשך התוכנית.`;

    const prompt = `צור תוכנית ${duration} ימים, מטרה: ${goalLabel}. שם הקמפיין: ${name}.`;
    const text = await call('series', system, prompt, 3500);
    if (!text) return;

    // Parse all [MSG ...] blocks
    const blocks = Array.from(text.matchAll(/\[MSG([^\]]+)\]([\s\S]*?)\[\/MSG\]/g));
    const msgs: SeriesMessage[] = blocks.map((b, i) => {
      const attrs = Object.fromEntries(Array.from(b[1].matchAll(/(\w+)=([^\s]+)/g)).map(m => [m[1], m[2]]));
      const body  = b[2].trim();
      const subjMatch = body.match(/SUBJECT:\s*(.*)/);
      const bodyMatch = body.match(/BODY:\s*([\s\S]*)/);
      const ch = (attrs.ch as Channel) || 'email';
      return {
        day_offset: parseInt(attrs.day) || 0,
        channel:    CHANNELS.some(c => c.id === ch) ? ch : 'email',
        subject:    subjMatch?.[1]?.trim(),
        body:       bodyMatch?.[1]?.trim() || body,
        position:   i,
      };
    }).sort((a, b) => a.day_offset - b.day_offset);

    setScheduled(msgs);
  }

  async function saveSeries() {
    if (scheduled.length === 0 || !name.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: s, error: sErr } = await supabase.from('message_series').insert({
      user_id:       user.id,
      client_id:     selC?.id ?? null,
      name,
      goal,
      duration_days: duration,
      channels,
      status:        'draft',
    }).select().single();
    if (sErr || !s) return;

    await supabase.from('series_messages').insert(scheduled.map(m => ({
      series_id:  s.id,
      day_offset: m.day_offset,
      channel:    m.channel,
      subject:    m.subject ?? null,
      body:       m.body,
      position:   m.position,
    })));

    setSavedId(s.id);
    setSeries(p => [{ id: s.id, name: s.name, duration_days: s.duration_days, goal: s.goal, created_at: s.created_at }, ...p]);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Lifecycle"
        title="סדרת הודעות"
        sub="קמפיינים מולטי-ערוציים עד 180 ימים"
        right={<CostBadge cost={20} />}
      />

      <Tabs tabs={[{id:'build',label:'🔨 בנייה'},{id:'list',label:`📚 קמפיינים (${series.length})`}]} active={tab} onChange={setTab} />

      {tab === 'build' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Card className="mb-3">
              <CardLabel>שם הקמפיין</CardLabel>
              <Input value={name} onChange={setName} placeholder="לדוגמה: השקת קורס Q3" />
            </Card>

            <Card className="mb-3">
              <CardLabel>מטרה</CardLabel>
              <div className="grid grid-cols-2 gap-2">
                {GOALS.map(g => (
                  <button key={g.id} onClick={() => setGoal(g.id)}
                    className={`text-right p-3 rounded-lg border transition-all ${goal===g.id?'border-[#0A7AFF] bg-[#0A7AFF]/10':'border-[#243752] bg-[#1A2A42] hover:border-[#324C6B]'}`}>
                    <div className="font-medium text-sm text-[#D9E8F5]">{g.label}</div>
                    <div className="text-[11px] text-[#6B8FA8] mt-0.5">{g.sub}</div>
                  </button>
                ))}
              </div>
            </Card>

            <Card className="mb-3">
              <CardLabel>משך הקמפיין</CardLabel>
              <div className="flex gap-2">
                {DURATIONS.map(d => (
                  <Chip key={d} label={`${d} ימים`} active={duration===d} onClick={() => setDuration(d)} />
                ))}
              </div>
            </Card>

            <Card className="mb-3">
              <CardLabel>ערוצים</CardLabel>
              <div className="flex gap-2">
                {CHANNELS.map(c => (
                  <Chip key={c.id} label={`${c.emoji} ${c.label}`} active={channels.includes(c.id)} onClick={() => toggleCh(c.id)} />
                ))}
              </div>
            </Card>

            {clients.length > 0 && (
              <Card className="mb-3">
                <CardLabel>לקוח (אופציונלי)</CardLabel>
                <div className="flex flex-wrap gap-2">
                  <Chip label="ללא" active={!selC} onClick={() => setSelC(null)} />
                  {clients.map(c => (
                    <Chip key={c.id} label={`${c.emoji} ${c.name}`} active={selC?.id===c.id} onClick={() => setSelC(c)} />
                  ))}
                </div>
              </Card>
            )}

            <Btn variant="primary" full loading={loading} onClick={build} disabled={!name.trim() || channels.length===0}>
              🗓 בנה תוכנית {duration} ימים
            </Btn>
            {error && <Alert type="red">❌ {error}</Alert>}
          </div>

          <div>
            {scheduled.length > 0 ? (
              <>
                <Card className="mb-3" style={{borderColor: 'rgba(5,150,105,.3)'}}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-sm text-[#34D399]">{scheduled.length} הודעות מתוכננות</div>
                      <div className="text-[11px] text-[#6B8FA8] mt-0.5">לאורך {duration} ימים · {channels.length} ערוצים</div>
                    </div>
                    <Btn variant="green" size="sm" onClick={saveSeries} disabled={!!savedId}>
                      {savedId ? '✓ נשמר' : '💾 שמור תוכנית'}
                    </Btn>
                  </div>
                </Card>

                {/* Timeline */}
                <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                  {scheduled.map((m, i) => {
                    const cInfo = CHANNELS.find(c => c.id === m.channel);
                    return (
                      <div key={i} className="bg-[#152138] border border-[#243752] rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-[#0A7AFF]/15 text-[#3D9FFF] text-[11px] font-bold flex items-center justify-center">
                              {m.day_offset}
                            </div>
                            <span className="text-xs text-[#6B8FA8]">יום</span>
                            <span className="text-base">{cInfo?.emoji}</span>
                            <span className="text-xs text-[#D9E8F5]">{cInfo?.label}</span>
                          </div>
                        </div>
                        {m.subject && <div className="text-sm font-semibold text-[#D9E8F5] mb-1">{m.subject}</div>}
                        <div className="text-[12.5px] text-[#6B8FA8] leading-relaxed whitespace-pre-wrap line-clamp-3">{m.body}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]">
                <span className="text-5xl mb-3 opacity-30">🗓</span>
                <span className="text-sm">מלא פרטים ולחץ "בנה תוכנית"</span>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'list' && (
        <div>
          {series.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]">
              <div className="text-4xl mb-3 opacity-30">📭</div>
              <div className="text-sm">אין קמפיינים שמורים</div>
            </div>
          ) : (
            series.map(s => (
              <div key={s.id} className="bg-[#152138] border border-[#243752] rounded-xl p-4 mb-2 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm text-[#D9E8F5]">{s.name}</div>
                  <div className="text-[11px] text-[#6B8FA8] mt-0.5">
                    {GOALS.find(g => g.id === s.goal)?.label} · {s.duration_days} ימים · {new Date(s.created_at).toLocaleDateString('he')}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
