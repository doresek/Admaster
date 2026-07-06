'use client';
// ═══════════════════════════════════════════════════════════════════════════
// /calendar — the client's REAL content calendar (P1-5): the owner-facing face
// of the P1 organic pipeline. Generate a 2-4 week plan (deterministic topics,
// grounded in the client's insight atoms), review the week-grouped slots,
// generate a post per slot (best-of-N, 6⚡), and publish (dry-run demo) — all
// against the app-wide active client. Replaces the old one-off holiday
// generator: holidays now surface as 'holiday' slots inside the plan itself.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from 'react';
import { Card, CardLabel, Chip, Btn, Alert, PageHeader, CostBadge, Spinner } from '@/components/ui';
import { useActiveClient } from '@/components/ClientProvider';

// ── API shapes (mirror app/api/organic/plan/route.ts responses) ──────────────
interface ApiSlot {
  schedule_id: string;
  date: string;                 // YYYY-MM-DD
  post_type: string;
  topic: string;
  angle: string;
  status: string;               // planned | scheduled | publishing | published | failed | cancelled
  message: string | null;
  meta_post_id?: string | null;
  grounded_in: string[];
  rationale?: string | null;
}
interface ApiPlan {
  campaign_id: string;
  name: string;
  created_at: string;
  rationale: string | null;
  slots: ApiSlot[];
}

// ── presentation maps ─────────────────────────────────────────────────────────
const TYPE_META: Record<string, { emoji: string; label: string }> = {
  tip:        { emoji: '💡', label: 'טיפ' },
  story:      { emoji: '📖', label: 'סיפור' },
  engagement: { emoji: '💬', label: 'מעורבות' },
  offer:      { emoji: '🎁', label: 'הצעה' },
  holiday:    { emoji: '🎉', label: 'חג' },
};

function statusBadge(s: ApiSlot): { text: string; cls: string } {
  if (s.status === 'published')  return { text: 'פורסם ✓',   cls: 'bg-[#059669]/12 border-[#059669]/30 text-[#34D399]' };
  if (s.status === 'scheduled')  return { text: 'מתוזמן',     cls: 'bg-[#0A7AFF]/12 border-[#0A7AFF]/30 text-[#3D9FFF]' };
  if (s.status === 'publishing') return { text: 'מפרסם…',     cls: 'bg-[#0A7AFF]/12 border-[#0A7AFF]/30 text-[#3D9FFF]' };
  if (s.status === 'failed')     return { text: 'נכשל',       cls: 'bg-red-900/20 border-red-500/30 text-red-400' };
  if (s.status === 'cancelled')  return { text: 'בוטל',       cls: 'bg-[#162030] border-[#1E2F42] text-[#2E4459]' };
  if (s.message)                 return { text: 'יש תוכן ✍️', cls: 'bg-[#6D28D9]/12 border-[#6D28D9]/30 text-[#A78BFA]' };
  return { text: 'מתוכנן', cls: 'bg-[#162030] border-[#1E2F42] text-[#6B8FA8]' };
}

const DAY_MS = 86_400_000;

function hebDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('he-IL', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

/** Group a plan's slots into weeks relative to the plan's first slot date. */
function groupByWeek(slots: ApiSlot[]): ApiSlot[][] {
  if (slots.length === 0) return [];
  const first = Date.parse(`${slots[0].date}T00:00:00Z`);
  const weeks: ApiSlot[][] = [];
  for (const s of slots) {
    const idx = Math.max(0, Math.floor((Date.parse(`${s.date}T00:00:00Z`) - first) / (7 * DAY_MS)));
    (weeks[idx] ??= []).push(s);
  }
  return weeks.filter(Boolean);
}

// ══════════════════════════════════════════════════════════════════════════════
export default function CalendarPage() {
  const { activeClient } = useActiveClient();

  const [plans, setPlans]         = useState<ApiPlan[]>([]);
  const [loading, setLoading]     = useState(false);
  const [creating, setCreating]   = useState(false);
  const [weeks, setWeeks]         = useState<2 | 3 | 4>(2);
  const [perWeek, setPerWeek]     = useState(3);
  const [error, setError]         = useState<string | null>(null);
  const [genBusy, setGenBusy]     = useState<Record<string, boolean>>({});
  const [pubBusy, setPubBusy]     = useState<Record<string, boolean>>({});
  const [pubNote, setPubNote]     = useState<Record<string, { text: string; tone: 'green' | 'amber' | 'red' | 'blue' }>>({});
  const [open, setOpen]           = useState<Record<string, boolean>>({});

  const clientId = activeClient?.id ?? null;

  // ── load the existing plans on mount / client switch ─────────────────────────
  const load = useCallback(async () => {
    if (!clientId) { setPlans([]); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/organic/plan?client_id=${encodeURIComponent(clientId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה בטעינה');
      setPlans(data.plans ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // ── actions ──────────────────────────────────────────────────────────────────
  async function createPlan() {
    if (!clientId) return;
    setCreating(true); setError(null);
    try {
      const res = await fetch('/api/organic/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, weeks, posts_per_week: perWeek }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה ביצירת התוכנית');
      await load(); // the GET is the single source of truth for display
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  function patchSlot(scheduleId: string, patch: Partial<ApiSlot>) {
    setPlans((ps) => ps.map((p) => ({
      ...p,
      slots: p.slots.map((s) => (s.schedule_id === scheduleId ? { ...s, ...patch } : s)),
    })));
  }

  async function generatePost(slot: ApiSlot) {
    setGenBusy((b) => ({ ...b, [slot.schedule_id]: true })); setError(null);
    try {
      const res = await fetch('/api/organic/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule_id: slot.schedule_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'נכשל ביצירת הפוסט');
      patchSlot(slot.schedule_id, { message: data.post });
      setOpen((o) => ({ ...o, [slot.schedule_id]: true }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenBusy((b) => ({ ...b, [slot.schedule_id]: false }));
    }
  }

  async function publishSlot(slot: ApiSlot) {
    setPubBusy((b) => ({ ...b, [slot.schedule_id]: true })); setError(null);
    try {
      const res = await fetch('/api/organic/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_id: slot.schedule_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'נכשל בפרסום');
      const r = (data.results ?? [])[0] as { outcome?: string; metaPostId?: string | null; reason?: string } | undefined;
      const outcome = r?.outcome ?? 'failed';
      if (outcome === 'published') {
        patchSlot(slot.schedule_id, { status: 'published', meta_post_id: r?.metaPostId ?? null });
        setPubNote((n) => ({ ...n, [slot.schedule_id]: { text: `פורסם (דמו) ✓ ${r?.metaPostId ? `· ${r.metaPostId}` : ''}`, tone: 'green' } }));
      } else if (outcome === 'scheduled') {
        patchSlot(slot.schedule_id, { status: 'scheduled' });
        setPubNote((n) => ({ ...n, [slot.schedule_id]: { text: 'נרשם תזמון לפרסום עתידי', tone: 'blue' } }));
      } else if (outcome === 'proposed') {
        setPubNote((n) => ({ ...n, [slot.schedule_id]: { text: 'ממתין לאישור (מצב טיוטה)', tone: 'amber' } }));
      } else if (outcome === 'blocked' || outcome === 'failed') {
        setPubNote((n) => ({ ...n, [slot.schedule_id]: { text: `לא פורסם: ${r?.reason ?? outcome}`, tone: 'red' } }));
      } else { // skipped
        setPubNote((n) => ({ ...n, [slot.schedule_id]: { text: `דולג: ${r?.reason ?? ''}`, tone: 'amber' } }));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPubBusy((b) => ({ ...b, [slot.schedule_id]: false }));
    }
  }

  // ── no active client ─────────────────────────────────────────────────────────
  if (!activeClient) {
    return (
      <div>
        <PageHeader eyebrow="לוח שנה" title="לוח התוכן שלך" sub="תוכנית תוכן אורגני מבוססת תובנות — שבוע אחר שבוע" />
        <Alert type="amber">⚠️ בחר לקוח פעיל (למעלה) כדי לבנות ולנהל את לוח התוכן שלו.</Alert>
      </div>
    );
  }

  const noteTone: Record<string, string> = {
    green: 'text-[#34D399]', amber: 'text-[#D97706]', red: 'text-red-400', blue: 'text-[#3D9FFF]',
  };

  return (
    <div>
      <PageHeader
        eyebrow="לוח שנה"
        title={`לוח התוכן של ${activeClient.name}`}
        sub="תוכנית → פוסטים → פרסום · כל תא מנומק ומבוסס על תובנות הלקוח"
      />

      {/* ── plan generation controls ─────────────────────────────────────────── */}
      <Card className="mb-6">
        <CardLabel>צור תוכנית תוכן</CardLabel>
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <div className="text-[11px] text-[#6B8FA8] mb-1.5">משך (שבועות)</div>
            <div className="flex gap-2">
              {([2, 3, 4] as const).map((w) => (
                <Chip key={w} label={`${w} שבועות`} active={weeks === w} onClick={() => setWeeks(w)} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#6B8FA8] mb-1.5">פוסטים בשבוע</div>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <Chip key={n} label={String(n)} active={perWeek === n} onClick={() => setPerWeek(n)} />
              ))}
            </div>
          </div>
          <Btn onClick={createPlan} loading={creating}>
            📅 צור תוכנית תוכן
          </Btn>
          <span className="text-[11px] text-[#2E4459]">
            התוכנית עצמה חינם · יצירת פוסט לכל תא עולה <span className="text-[#D4AF55]">6⚡</span>
          </span>
        </div>
      </Card>

      {error && <Alert type="red">❌ {error}</Alert>}
      {loading && (
        <div className="flex items-center justify-center py-10 gap-3 text-[#6B8FA8]">
          <Spinner size={18} /><span className="text-sm">טוען את לוח התוכן…</span>
        </div>
      )}

      {!loading && plans.length === 0 && (
        <Card className="text-center py-10">
          <div className="text-3xl mb-2">🗓️</div>
          <div className="font-bold mb-1">עדיין אין תוכנית תוכן</div>
          <div className="text-sm text-[#6B8FA8]">בחר משך ותדירות למעלה ולחץ ״צור תוכנית תוכן״ — הנושאים ייבנו מהתובנות של {activeClient.name}.</div>
        </Card>
      )}

      {/* ── the plans, newest first ─────────────────────────────────────────── */}
      {!loading && plans.map((plan) => (
        <div key={plan.campaign_id} className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div className="font-bold text-[#D9E8F5]">{plan.name}</div>
            <div className="text-[11px] text-[#2E4459]">
              נוצר {new Date(plan.created_at).toLocaleDateString('he-IL')}
            </div>
          </div>
          {plan.rationale && (
            <div className="text-[12px] text-[#6B8FA8] mb-3 leading-relaxed">🧭 {plan.rationale}</div>
          )}

          {groupByWeek(plan.slots).map((week, wi) => (
            <div key={wi} className="mb-4">
              <CardLabel>שבוע {wi + 1}</CardLabel>
              <div className="flex flex-col gap-2">
                {week.map((slot) => {
                  const meta = TYPE_META[slot.post_type] ?? { emoji: '📝', label: slot.post_type };
                  const badge = statusBadge(slot);
                  const isHoliday = slot.post_type === 'holiday';
                  // Holiday slots carry "<emoji> <name> · <topic>" — surface the chag.
                  const [holidayPart, ...restTopic] = isHoliday ? slot.topic.split(' · ') : [null];
                  const note = pubNote[slot.schedule_id];
                  return (
                    <Card
                      key={slot.schedule_id}
                      className="!p-3.5"
                      style={isHoliday ? { borderColor: 'rgba(217,119,6,.35)', background: 'rgba(217,119,6,.05)' } : undefined}
                    >
                      <div className="flex items-start gap-3 flex-wrap">
                        {/* date + type */}
                        <div className="min-w-[150px]">
                          <div className="text-[13px] font-bold text-[#D9E8F5]">{hebDate(slot.date)}</div>
                          <div className="text-[11px] text-[#2E4459]">{slot.date}</div>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-[#1E2F42] bg-[#162030] text-[#6B8FA8]">
                          {meta.emoji} {meta.label}
                        </span>

                        {/* topic */}
                        <div className="flex-1 min-w-[220px]">
                          {isHoliday && holidayPart && (
                            <div className="text-[15px] font-bold text-[#D97706] mb-0.5">{holidayPart}</div>
                          )}
                          <div className="text-[13px] text-[#D9E8F5]">
                            {isHoliday ? restTopic.join(' · ') : slot.topic}
                          </div>
                          <div className="text-[11px] text-[#6B8FA8] mt-0.5">
                            זווית: {slot.angle}
                            {slot.grounded_in.length > 0 && (
                              <span className="text-[#2E4459]"> · מבוסס על {slot.grounded_in.length} תובנות</span>
                            )}
                          </div>
                        </div>

                        {/* status + actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${badge.cls}`}>
                            {badge.text}
                          </span>
                          {!slot.message && slot.status === 'planned' && (
                            <Btn size="xs" variant="violet" loading={genBusy[slot.schedule_id]} onClick={() => generatePost(slot)}>
                              ✨ צור פוסט <CostBadge cost={6} />
                            </Btn>
                          )}
                          {slot.message && slot.status !== 'published' && slot.status !== 'publishing' && (
                            <Btn size="xs" variant="green" loading={pubBusy[slot.schedule_id]} onClick={() => publishSlot(slot)}>
                              🚀 פרסם (דמו)
                            </Btn>
                          )}
                          {slot.message && (
                            <button
                              onClick={() => setOpen((o) => ({ ...o, [slot.schedule_id]: !o[slot.schedule_id] }))}
                              className="text-[#2E4459] hover:text-[#6B8FA8] text-[11px] font-semibold"
                            >
                              {open[slot.schedule_id] ? '▲ הסתר תוכן' : '▼ הצג תוכן'}
                            </button>
                          )}
                        </div>
                      </div>

                      {note && (
                        <div className={`text-[12px] mt-2 font-semibold ${noteTone[note.tone]}`}>{note.text}</div>
                      )}

                      {slot.message && open[slot.schedule_id] && (
                        <div className="mt-3 bg-[#162030] border border-[#1E2F42] rounded-lg p-3.5 whitespace-pre-wrap text-[13px] leading-relaxed text-[#D9E8F5]">
                          {slot.message}
                          {slot.meta_post_id && (
                            <div className="text-[11px] text-[#2E4459] mt-2 border-t border-[#1E2F42] pt-2" dir="ltr">
                              meta_post_id: {slot.meta_post_id}
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* ── honesty footer ──────────────────────────────────────────────────── */}
      <div className="text-[11px] text-[#2E4459] text-center mt-8 mb-2">
        מצב דמו — פרסום אמיתי לפייסבוק ייפתח לאחר אישור מטא (App Review)
      </div>
    </div>
  );
}
