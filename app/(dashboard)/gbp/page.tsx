'use client';
// ═══════════════════════════════════════════════════════════════════════════
// /gbp — Google Business Profile manual-assist console (P1-GBP-1 + P1-GBP-4).
//
// NO GBP API access yet (allowlisting = owner action, G0-GBP) — this screen is
// the manual-assist equivalent: the owner describes the profile's current
// state, we return a 0-100 completeness score + per-field cards, each with a
// copy-pasteable prepared value (derived from the client's insight atoms,
// server-side) and a business.google.com deep link to execute by hand.
// Second tab: the NAP/citations consistency checklist across the Israeli
// directory set (site JSON-LD, d.co.il, zap, easy, מידרג, Waze) — a pure
// client-side comparator, no atoms needed.
//
// STATELESS V1: form state persists in sessionStorage per client (no schema
// change without the orchestrator). The value is the AUDIT, not the storage.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Btn, Card, CardLabel, CopyBtn, Input, PageHeader, Spinner, Tabs, Textarea,
} from '@/components/ui';
import { useActiveClient } from '@/components/ClientProvider';
import {
  emptyProfileState,
  GBP_DAY_KEYS, GBP_DAY_LABELS_HE,
  type GbpAudit, type GbpAuditItem, type GbpFieldStatus, type GbpProfileState,
} from '@/lib/gbp/completeness';
import {
  checkNapConsistency, IL_DIRECTORIES,
  type DirectoryId, type NapListing, type NapReport,
} from '@/lib/gbp/citations';

// ── sessionStorage persistence (stateless V1 — see header) ───────────────────

function loadSession<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch { return fallback; }
}
function saveSession(key: string, value: unknown) {
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* quota/private mode */ }
}

// ── presentation ──────────────────────────────────────────────────────────────

const STATUS_META: Record<GbpFieldStatus, { label: string; cls: string }> = {
  ok:      { label: 'תקין ✓', cls: 'bg-[#059669]/12 border-[#059669]/30 text-[#34D399]' },
  weak:    { label: 'חלקי',   cls: 'bg-[#D97706]/12 border-[#D97706]/30 text-[#FBBF24]' },
  missing: { label: 'חסר',    cls: 'bg-red-900/20 border-red-500/30 text-red-400' },
};

function StatusBadge({ status }: { status: GbpFieldStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`text-[10.5px] px-2 py-0.5 rounded-full border ${m.cls}`}>{m.label}</span>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return '#34D399';
  if (score >= 50) return '#FBBF24';
  return '#F87171';
}

// ── NAP tab local state shape ─────────────────────────────────────────────────

interface NapFormState {
  name: string; address: string; phone: string; website: string;
  listings: Record<DirectoryId, { listed: boolean; name: string; address: string; phone: string }>;
}

function emptyNapState(): NapFormState {
  const listings = {} as NapFormState['listings'];
  for (const d of IL_DIRECTORIES) {
    listings[d.id] = { listed: false, name: '', address: '', phone: '' };
  }
  return { name: '', address: '', phone: '', website: '', listings };
}

const NAP_STATUS_META: Record<string, { label: string; cls: string }> = {
  match:     { label: 'תואם ✓',     cls: 'bg-[#059669]/12 border-[#059669]/30 text-[#34D399]' },
  deviation: { label: 'סטייה!',     cls: 'bg-red-900/20 border-red-500/30 text-red-400' },
  missing:   { label: 'אין רישום',  cls: 'bg-[#D97706]/12 border-[#D97706]/30 text-[#FBBF24]' },
  unknown:   { label: 'לא נבדק',    cls: 'bg-[#162030] border-[#1E2F42] text-[#6B8FA8]' },
};

// ══════════════════════════════════════════════════════════════════════════════
export default function GbpPage() {
  const { activeClient } = useActiveClient();
  const clientId = activeClient?.id ?? null;

  const [tab, setTab] = useState<'completeness' | 'nap'>('completeness');

  // ── completeness state ──────────────────────────────────────────────────────
  const [state, setState] = useState<GbpProfileState>(emptyProfileState());
  const [audit, setAudit] = useState<GbpAudit | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── NAP state ───────────────────────────────────────────────────────────────
  const [nap, setNap] = useState<NapFormState>(emptyNapState());

  // Load persisted per-client form state on client switch.
  useEffect(() => {
    if (!clientId) return;
    setState(loadSession(`gbp-state-${clientId}`, emptyProfileState()));
    setNap(loadSession(`gbp-nap-${clientId}`, emptyNapState()));
    setAudit(null);
    setError(null);
  }, [clientId]);

  // Persist on change.
  useEffect(() => { if (clientId) saveSession(`gbp-state-${clientId}`, state); }, [clientId, state]);
  useEffect(() => { if (clientId) saveSession(`gbp-nap-${clientId}`, nap); }, [clientId, nap]);

  const patch = (p: Partial<GbpProfileState>) => setState((s) => ({ ...s, ...p }));

  async function runAudit() {
    if (!clientId) return;
    setAuditing(true);
    setError(null);
    try {
      const res = await fetch('/api/gbp/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, state }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'שגיאה בהרצת הביקורת');
      setAudit(d.audit as GbpAudit);
    } catch (e: any) {
      setError(e?.message ?? 'שגיאה בהרצת הביקורת');
    } finally {
      setAuditing(false);
    }
  }

  // NAP report — pure, computed live.
  const napReport: NapReport | null = useMemo(() => {
    if (nap.name.trim() === '' && nap.phone.trim() === '' && nap.address.trim() === '') return null;
    const listings: NapListing[] = IL_DIRECTORIES.map((d) => {
      const l = nap.listings[d.id];
      return { directory: d.id, listed: l.listed, name: l.name, address: l.address, phone: l.phone };
    });
    return checkNapConsistency(
      { name: nap.name, address: nap.address, phone: nap.phone, website: nap.website },
      listings,
    );
  }, [nap]);

  if (!activeClient) {
    return (
      <div className="max-w-3xl mx-auto">
        <PageHeader eyebrow="GBP" title="פרופיל העסק בגוגל" />
        <Alert type="blue">בחרו לקוח פעיל למעלה כדי להריץ ביקורת GBP.</Alert>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-16">
      <PageHeader
        eyebrow="GBP · Local SEO"
        title={`פרופיל העסק בגוגל — ${activeClient.name}`}
        sub="מצב עזרה-ידנית — עד אישור Google Business Profile API. אתם ממלאים את המצב הנוכחי, אנחנו מחזירים ציון + ערכים מוכנים להדבקה + קישורים ישירים לעריכה."
      />

      <Tabs
        tabs={[
          { id: 'completeness', label: '📋 שלמות הפרופיל' },
          { id: 'nap', label: '🔗 עקביות NAP (ציטוטים)' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as 'completeness' | 'nap')}
      />

      {tab === 'completeness' && (
        <div className="space-y-4">
          <Card>
            <CardLabel>המצב הנוכחי בפרופיל (מילוי חד-פעמי — נשמר בדפדפן)</CardLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              <Input label="שם העסק הקנוני (האמיתי)" value={state.canonical_name}
                onChange={(v) => patch({ canonical_name: v })} placeholder="למשל: קליניקת שלם" />
              <Input label="השם כפי שמופיע ב-GBP" value={state.gbp_name}
                onChange={(v) => patch({ gbp_name: v })} placeholder="בדיוק כמו בפרופיל" />
              <Input label="עיר" value={state.city}
                onChange={(v) => patch({ city: v })} placeholder="למשל: רעננה" />
              <Input label="קטגוריה ראשית" value={state.primary_category}
                onChange={(v) => patch({ primary_category: v })} placeholder="הקטגוריה שנבחרה בפרופיל" />
              <Input label="טלפון בפרופיל" value={state.phone}
                onChange={(v) => patch({ phone: v })} placeholder="050-1234567" />
              <Input label="כתובת בפרופיל" value={state.address}
                onChange={(v) => patch({ address: v })} placeholder="רחוב, מספר, עיר" />
              <Input label="קישור לאתר" value={state.website}
                onChange={(v) => patch({ website: v })} placeholder="https://..." />
              <Input label="תאריך פתיחת העסק (אם הוגדר)" value={state.opening_date}
                onChange={(v) => patch({ opening_date: v })} placeholder="YYYY-MM" />
            </div>

            <div className="mt-3">
              <Textarea
                label="שירותים שמופיעים בלשונית Services (אחד בכל שורה)"
                value={state.services.join('\n')}
                onChange={(v) => patch({ services: v.split('\n').map((s) => s.trim()).filter(Boolean) })}
                rows={3}
                placeholder={'טיפול א\nטיפול ב'}
              />
            </div>
            <div className="mt-3">
              <Textarea
                label="תיאור העסק הנוכחי בפרופיל"
                value={state.description}
                onChange={(v) => patch({ description: v })}
                rows={3}
                placeholder="ריק אם אין תיאור"
              />
              <div className="text-[10.5px] text-[#6B8FA8] mt-1">{state.description.trim().length} / 750 תווים</div>
            </div>

            {/* hours grid */}
            <div className="mt-4">
              <CardLabel>שעות פעילות (כפי שמוגדרות בפרופיל)</CardLabel>
              <div className="space-y-1.5 mt-2">
                {GBP_DAY_KEYS.map((day) => {
                  const h = state.hours[day];
                  const closed = h?.closed === true;
                  return (
                    <div key={day} className="flex items-center gap-2 text-[12px]">
                      <span className="w-14 text-[#6B8FA8]">{GBP_DAY_LABELS_HE[day]}</span>
                      <label className="flex items-center gap-1 text-[#6B8FA8] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={closed}
                          onChange={(e) =>
                            patch({ hours: { ...state.hours, [day]: e.target.checked ? { closed: true } : undefined } })}
                        />
                        סגור
                      </label>
                      {!closed && (
                        <>
                          <input
                            type="time" value={h?.open ?? ''}
                            onChange={(e) =>
                              patch({ hours: { ...state.hours, [day]: { closed: false, open: e.target.value, close: h?.close ?? '' } } })}
                            className="bg-[#0C141D] border border-[#1E2F42] rounded px-2 py-1 text-[#D9E8F5] text-[12px]"
                          />
                          <span className="text-[#2E4459]">–</span>
                          <input
                            type="time" value={h?.close ?? ''}
                            onChange={(e) =>
                              patch({ hours: { ...state.hours, [day]: { closed: false, open: h?.open ?? '', close: e.target.value } } })}
                            className="bg-[#0C141D] border border-[#1E2F42] rounded px-2 py-1 text-[#D9E8F5] text-[12px]"
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <Input label="תמונות שהועלו ב-30 הימים האחרונים" type="number"
                value={String(state.photos_last_30d)}
                onChange={(v) => patch({ photos_last_30d: Math.max(0, parseInt(v, 10) || 0) })} />
              <Input label="כמה מאפיינים (Attributes) מסומנים" type="number"
                value={String(state.attributes_count)}
                onChange={(v) => patch({ attributes_count: Math.max(0, parseInt(v, 10) || 0) })} />
              <label className="flex items-end gap-2 text-[12px] text-[#6B8FA8] pb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.holiday_hours_set}
                  onChange={(e) => patch({ holiday_hours_set: e.target.checked })}
                />
                הוגדרו שעות מיוחדות לחגים הקרובים
              </label>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Btn onClick={runAudit} loading={auditing} disabled={auditing}>
                🔍 הרץ ביקורת שלמות
              </Btn>
              {auditing && <Spinner />}
            </div>
            {error && <div className="mt-3"><Alert type="red">{error}</Alert></div>}
          </Card>

          {audit && (
            <>
              <Card>
                <div className="flex items-center gap-4">
                  <div className="font-mono text-4xl font-semibold leading-none" style={{ color: scoreColor(audit.score) }}>
                    {audit.score}
                  </div>
                  <div>
                    <div className="text-[13px] text-[#D9E8F5] font-medium">ציון שלמות הפרופיל (0–100)</div>
                    <div className="text-[11px] text-[#6B8FA8]">
                      GBP ≈32% ממשקל דירוג ה-Pack המקומי (Whitespark 2026) — כל שדה שסוגרים מזיז את המחט.
                    </div>
                  </div>
                </div>
              </Card>

              <div className="space-y-3">
                {audit.items.map((it: GbpAuditItem) => (
                  <Card key={it.field}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[13px] font-medium text-[#D9E8F5]">{it.label_he}</div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={it.status} />
                        <a
                          href={it.deep_link} target="_blank" rel="noopener noreferrer"
                          className="text-[11.5px] text-[#3D9FFF] hover:underline whitespace-nowrap"
                        >
                          פתח ב-GBP ↗
                        </a>
                      </div>
                    </div>
                    <div className="text-[11.5px] text-[#6B8FA8] mt-1.5 leading-relaxed">{it.why_he}</div>
                    {it.details_he && (
                      <div className="text-[11.5px] text-[#FBBF24] mt-1.5 leading-relaxed">{it.details_he}</div>
                    )}
                    {it.prepared_value && it.status !== 'ok' && (
                      <div className="mt-2.5 bg-[#0C141D] border border-[#1E2F42] rounded-md p-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10.5px] text-[#6B8FA8]">ערך מוכן להדבקה:</span>
                          <CopyBtn text={it.prepared_value} />
                        </div>
                        <pre className="text-[12px] text-[#D9E8F5] whitespace-pre-wrap font-sans leading-relaxed">
                          {it.prepared_value}
                        </pre>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'nap' && (
        <div className="space-y-4">
          <Alert type="blue">
            ציטוטים אחידים (שם/כתובת/טלפון זהים בכל מקום) הם "הקישורים הנכנסים החדשים" של תשובות ה-AI —
            כל סטייה (טלפון ישן בזאפ, "רח&apos;" מול "רחוב") מפצלת את זהות העסק.
          </Alert>

          <Card>
            <CardLabel>ה-NAP הקנוני (המקור היחיד לאמת)</CardLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              <Input label="שם העסק" value={nap.name} onChange={(v) => setNap({ ...nap, name: v })} />
              <Input label="טלפון" value={nap.phone} onChange={(v) => setNap({ ...nap, phone: v })} placeholder="050-1234567" />
              <Input label="כתובת מלאה" value={nap.address} onChange={(v) => setNap({ ...nap, address: v })} placeholder="רחוב הרצל 12, רעננה" />
              <Input label="אתר" value={nap.website} onChange={(v) => setNap({ ...nap, website: v })} placeholder="https://..." />
            </div>
            {napReport && (
              <div className="mt-3 flex items-center gap-3 text-[11.5px]">
                <span className="text-[#6B8FA8]">
                  טלפון מנורמל (E.164):{' '}
                  <span className={napReport.canonical_phone_e164 ? 'text-[#34D399] font-mono' : 'text-red-400'}>
                    {napReport.canonical_phone_e164 ?? 'לא תקין — בדקו את המספר'}
                  </span>
                </span>
                <CopyBtn text={`${nap.name}\n${nap.address}\n${nap.phone}`} label="📋 העתק NAP" />
              </div>
            )}
          </Card>

          {IL_DIRECTORIES.map((d) => {
            const l = nap.listings[d.id];
            const result = napReport?.results.find((r) => r.directory === d.id);
            const meta = result ? NAP_STATUS_META[result.status] : null;
            return (
              <Card key={d.id}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[13px] font-medium text-[#D9E8F5]">{d.name_he}</div>
                  <div className="flex items-center gap-2">
                    {meta && <span className={`text-[10.5px] px-2 py-0.5 rounded-full border ${meta.cls}`}>{meta.label}</span>}
                    {result?.deep_link ? (
                      <a href={result.deep_link} target="_blank" rel="noopener noreferrer"
                        className="text-[11.5px] text-[#3D9FFF] hover:underline whitespace-nowrap">
                        פתח ↗
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="text-[11px] text-[#6B8FA8] mt-1">{d.note_he}</div>

                <label className="flex items-center gap-2 mt-2.5 text-[12px] text-[#6B8FA8] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={l.listed}
                    onChange={(e) =>
                      setNap({ ...nap, listings: { ...nap.listings, [d.id]: { ...l, listed: e.target.checked } } })}
                  />
                  יש רישום {d.id === 'site_jsonld' ? '(JSON-LD קיים באתר)' : 'במדריך הזה'}
                </label>

                {l.listed && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                    <Input label="שם כפי שמופיע שם" value={l.name}
                      onChange={(v) => setNap({ ...nap, listings: { ...nap.listings, [d.id]: { ...l, name: v } } })} />
                    <Input label="כתובת כפי שמופיעה" value={l.address}
                      onChange={(v) => setNap({ ...nap, listings: { ...nap.listings, [d.id]: { ...l, address: v } } })} />
                    <Input label="טלפון כפי שמופיע" value={l.phone}
                      onChange={(v) => setNap({ ...nap, listings: { ...nap.listings, [d.id]: { ...l, phone: v } } })} />
                  </div>
                )}

                {result && result.deviations.length > 0 && (
                  <div className="mt-2.5 space-y-1.5">
                    {result.deviations.map((dev, i) => (
                      <div key={i} className="bg-red-900/10 border border-red-500/20 rounded-md p-2 text-[11.5px]">
                        <div className="text-red-400">{dev.note_he}</div>
                        <div className="text-[#6B8FA8] mt-0.5">
                          צפוי: <span className="text-[#D9E8F5]">{dev.expected}</span>
                          {' · '}
                          נמצא: <span className="text-red-300">{dev.found}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}

          {napReport && (
            <Alert type={napReport.consistent ? 'green' : 'amber'}>
              {napReport.consistent
                ? 'ה-NAP אחיד בכל המקורות שנבדקו ✓'
                : `נמצאו ${napReport.issues_count} בעיות עקביות — תקנו דרך הקישורים למעלה, מקור-מקור.`}
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
