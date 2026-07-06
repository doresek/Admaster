'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Chip, Input, Btn, Alert, PageHeader, CostBadge, Tabs } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import { useActiveClient } from '@/components/ClientProvider';
import { countEligible, deriveTagSet, type AudienceContact } from '@/app/api/retention/enroll/eligibility';

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

interface SavedSeries {
  id: string;
  name: string;
  duration_days: number;
  created_at: string;
  goal: string;
  status: string;
  client_id: string | null;
  audience_tags: string[] | null;
  activated_at: string | null;
}

/** Contact row as returned by GET /api/retention/contacts (audience fields). */
interface AudienceContactRow extends AudienceContact {
  id: string;
}

interface EnrollResult { eligible: number; enrolled: number; already_enrolled: number }

export default function SeriesPage() {
  const { activeClient, activeClientId } = useActiveClient();
  const [tab,        setTab]        = useState('build');
  const [name,       setName]       = useState('');
  const [goal,       setGoal]       = useState<Goal>('lead_nurture');
  const [duration,   setDuration]   = useState(60);
  const [channels,   setChannels]   = useState<Channel[]>(['email', 'whatsapp']);
  const [series,     setSeries]     = useState<SavedSeries[]>([]);
  const [scheduled,  setScheduled]  = useState<SeriesMessage[]>([]);
  const [savedId,    setSavedId]    = useState<string|null>(null);
  const { call, loading, error }    = useAI();

  // ── קהל היעד (retention audience, CP-6b T5) ──
  const [contacts,      setContacts]      = useState<AudienceContactRow[]>([]);
  const [audienceTags,  setAudienceTags]  = useState<string[]>([]);
  const [activating,    setActivating]    = useState<string|null>(null);
  const [enrollResults, setEnrollResults] = useState<Record<string, EnrollResult>>({});
  const [enrollErr,     setEnrollErr]     = useState('');

  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('message_series')
        .select('id, name, duration_days, created_at, goal, status, client_id, audience_tags, activated_at')
        .eq('user_id', user.id).order('created_at', { ascending: false })
        .then(({ data }) => setSeries((data ?? []) as SavedSeries[]));
    });
  }, []);

  // The active client's CONSENTED contacts (tombstoned rows are excluded by the
  // API) — the tag universe + the eligible-count preview both derive from this.
  useEffect(() => {
    setContacts([]); setAudienceTags([]);
    if (!activeClientId) return;
    fetch(`/api/retention/contacts?client_id=${activeClientId}`)
      .then(r => r.ok ? r.json() : { contacts: [] })
      .then(d => setContacts((d.contacts ?? []) as AudienceContactRow[]))
      .catch(() => setContacts([]));
  }, [activeClientId]);

  const tagUniverse   = deriveTagSet(contacts);
  const eligibleCount = countEligible(contacts, audienceTags);

  function toggleAudienceTag(t: string) {
    setAudienceTags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  }

  // Activation = the Mode-2 approval tap (design doc §5). Enrolls eligible
  // contacts + stamps activated_at. NOTHING SENDS here — sending runs only via
  // the daily retention tick behind the compliance gate.
  async function activateSeries(s: SavedSeries) {
    if (!s.client_id || activating) return;
    setActivating(s.id); setEnrollErr('');
    try {
      const res = await fetch('/api/retention/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ series_id: s.id, client_id: s.client_id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'שגיאה בהפעלה');
      setEnrollResults(p => ({ ...p, [s.id]: { eligible: d.eligible, enrolled: d.enrolled, already_enrolled: d.already_enrolled } }));
      setSeries(p => p.map(x => x.id === s.id ? { ...x, status: 'active', activated_at: d.activated_at } : x));
    } catch (e) {
      setEnrollErr(e instanceof Error ? e.message : 'שגיאה בהפעלה');
    } finally {
      setActivating(null);
    }
  }

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
${activeClient ? `לקוח: ${activeClient.name} | תחום: ${activeClient.industry ?? 'כללי'}` : ''}

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
      client_id:     activeClientId ?? null,
      name,
      goal,
      duration_days: duration,
      channels,
      status:        'draft',
      audience_tags: audienceTags,              // '{}' = כל אנשי הקשר הפעילים (mig 052)
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
    setSeries(p => [{
      id: s.id, name: s.name, duration_days: s.duration_days, goal: s.goal, created_at: s.created_at,
      status: s.status ?? 'draft', client_id: s.client_id ?? null,
      audience_tags: s.audience_tags ?? audienceTags, activated_at: s.activated_at ?? null,
    }, ...p]);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Lifecycle"
        title="סדרת הודעות"
        sub="קמפיינים מולטי-ערוציים עד 180 ימים — לרשימת התפוצה של הלקוח בלבד"
        right={
          <div className="flex items-center gap-3">
            <Link href="/contacts" className="text-[12px] text-[#3D9FFF] hover:text-[#7AC0FF] whitespace-nowrap">
              ניהול אנשי קשר ←
            </Link>
            <CostBadge cost={20} />
          </div>
        }
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
                    className={`text-right p-3 rounded-lg border transition-all ${goal===g.id?'border-[#0A7AFF] bg-[#0A7AFF]/10':'border-[#1E2F42] bg-[#162030] hover:border-[#2A4158]'}`}>
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

            {/* קהל היעד — retention audience (mig 052 audience_tags). Only
                CONSENTED, non-opted-out contacts are ever counted or enrolled. */}
            <Card className="mb-3">
              <CardLabel>קהל היעד</CardLabel>
              {contacts.length === 0 ? (
                <div className="text-[12px] text-[#6B8FA8]">
                  {activeClientId
                    ? <>אין עדיין אנשי קשר עם הסכמה ללקוח הזה — <Link href="/contacts" className="text-[#3D9FFF] hover:underline">הוסף אנשי קשר ←</Link></>
                    : 'בחר לקוח פעיל כדי לבחור קהל'}
                </div>
              ) : (
                <>
                  {tagUniverse.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {tagUniverse.map(t => (
                        <Chip key={t} label={t} active={audienceTags.includes(t)} onClick={() => toggleAudienceTag(t)} />
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#6B8FA8] mb-2">אין תגיות לאנשי הקשר — הסדרה תפנה לכל הרשימה</div>
                  )}
                  <div className="text-[12px] text-[#34D399]">
                    ישלח ל-{eligibleCount} אנשי קשר עם הסכמה
                    {audienceTags.length === 0 && contacts.length > 0 ? ' (כל הרשימה)' : ''}
                  </div>
                </>
              )}
            </Card>

            {activeClient ? (
              <div className="mb-3 text-[12px] text-[#6B8FA8] flex items-center gap-1.5">
                פועל על: <Chip label={`${activeClient.emoji} ${activeClient.name}`} active />
              </div>
            ) : (
              <Alert type="amber" className="mb-3">בחר לקוח פעיל מהמתג למעלה כדי להתחיל</Alert>
            )}

            <Btn variant="primary" full loading={loading} onClick={build} disabled={!name.trim() || channels.length===0 || !activeClientId}>
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
                      <div key={i} className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-3">
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
              <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
                <span className="text-5xl mb-3 opacity-30">🗓</span>
                <span className="text-sm">מלא פרטים ולחץ "בנה תוכנית"</span>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'list' && (
        <div>
          {enrollErr && <Alert type="red" className="mb-3">❌ {enrollErr}</Alert>}
          {series.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <div className="text-4xl mb-3 opacity-30">📭</div>
              <div className="text-sm">אין קמפיינים שמורים</div>
            </div>
          ) : (
            series.map(s => {
              const result = enrollResults[s.id];
              const isActive = s.status === 'active';
              return (
                <div key={s.id} className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4 mb-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-[#D9E8F5]">
                        {s.name}
                        {isActive && <span className="text-[10px] text-[#34D399] mr-2">● פעילה</span>}
                      </div>
                      <div className="text-[11px] text-[#6B8FA8] mt-0.5">
                        {GOALS.find(g => g.id === s.goal)?.label} · {s.duration_days} ימים · {new Date(s.created_at).toLocaleDateString('he')}
                        {(s.audience_tags?.length ?? 0) > 0 && <> · קהל: {s.audience_tags!.join(', ')}</>}
                        {isActive && s.activated_at && <> · הופעלה ב-{new Date(s.activated_at).toLocaleDateString('he')}</>}
                      </div>
                      {result && (
                        <div className="text-[11px] text-[#34D399] mt-1">
                          ✓ נרשמו {result.enrolled} אנשי קשר
                          {result.already_enrolled > 0 && <span className="text-[#6B8FA8]"> ({result.already_enrolled} כבר היו רשומים)</span>}
                          <span className="text-[#6B8FA8]"> · {result.eligible} זכאים סה"כ</span>
                        </div>
                      )}
                    </div>
                    {!isActive && (
                      <Btn variant="green" size="sm" loading={activating === s.id}
                        onClick={() => activateSeries(s)} disabled={!s.client_id || !!activating}>
                        ▶ הפעל סדרה (אישור Mode 2)
                      </Btn>
                    )}
                  </div>
                  {!isActive && !s.client_id && (
                    <div className="text-[10px] text-amber-400 mt-2">הסדרה נשמרה בלי לקוח — אי אפשר להפעיל (צור סדרה חדשה עם לקוח פעיל)</div>
                  )}
                </div>
              );
            })
          )}
          {/* Mode-2 honesty (design doc §5): activation ENROLLS only */}
          <div className="text-[11px] text-[#6B8FA8] mt-3 leading-relaxed">
            הפעלת סדרה רושמת את אנשי הקשר הזכאים (עם הסכמה, לא הוסרו, תואמי-קהל) ומסמנת את אישורך —
            השליחה בפועל רצה דרך ה-tick היומי של מנוע השימור (החיבור ל-heartbeat במשימה נפרדת).
            שום הודעה לא נשלחת ברגע ההפעלה.
          </div>
        </div>
      )}
    </div>
  );
}
