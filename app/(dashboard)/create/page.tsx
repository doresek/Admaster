'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardLabel, Chip, Textarea, Btn, OutputBox, Tabs, CopyBtn, CostBadge, Alert, PageHeader, Spinner } from '@/components/ui';
import { FRAMEWORKS, FRAMEWORKS_BY_ID, type FrameworkId } from '@/lib/frameworks';
import { MASTER_NOTES_MAX, type MasterV2Output } from '@/lib/master-studio';
import { buildEditSignal } from '@/lib/master-studio/edit-signal';
import { ScoreBadge } from '@/components/ScoreBadge';
import { ScorePanel } from '@/components/ScorePanel';
import { BoostButton } from '@/components/BoostButton';
import { SignalButtons } from '@/components/intelligence/SignalButtons';
import { useActiveClient } from '@/components/ClientProvider';
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

// ── Recent generations (read-back from GET /api/ai/master) ──
// `output` is the stored jsonb — old rows may hold only a subset of the fields
// (early versions stored just post/marketer/score/…), so every field is Partial
// and the restore path guards each one with a fallback.
type StoredOutput = Partial<{
  post:        string;
  hashtags:    string[];
  image:       string;
  whatsapp:    string;
  tips:        string;
  principles:  MasterV2Output['winner']['draft']['principles'];
  marketer:    MasterV2Output['winner']['marketer'];
  marketers:   MasterV2Output['marketers'];
  score:       number;
  boosted:     boolean;
  avatar:      MasterV2Output['avatar'];
  scores:      MasterV2Output['scores'];
  why:         string;
  artifact_id: string | null;
}>;

type RecentRow = {
  id:         string;
  client_id:  string | null;
  platform:   string | null;
  input:      { brief?: string } | null;
  output:     StoredOutput | null;
  created_at: string;
};

// ── In-flight runs (CP-3: non-blocking + batch creation) ──
// Generation is already navigation-safe server-side (a POST completes and
// persists its generated_content row even if the client disconnects — CP-4),
// so "background" here is purely client-side bookkeeping: a marker per run
// started in this session, persisted in sessionStorage so returning to the page
// mid-flight resumes polling the GET until the finished post shows up in the
// recent list (or a 3-minute cap expires).
type PendingMarker = {
  key:       string;
  kind:      'single' | 'batch';
  startedAt: number;
  expected:  number;    // 1 for a single run, the batch count for a batch
  baseline:  string[];  // generated_content ids visible when the run started
};

const PENDING_STORE  = 'am:create:pending';
const PENDING_TTL_MS = 180_000; // 3-minute polling cap per run

function loadPendingMarkers(): PendingMarker[] {
  try {
    const raw = sessionStorage.getItem(PENDING_STORE);
    const arr = raw ? (JSON.parse(raw) as PendingMarker[]) : [];
    return Array.isArray(arr) ? arr.filter(m => Date.now() - m.startedAt < PENDING_TTL_MS) : [];
  } catch { return []; }
}

function savePendingMarkers(markers: PendingMarker[]) {
  try { sessionStorage.setItem(PENDING_STORE, JSON.stringify(markers)); } catch { /* private mode etc. */ }
}

function newMarker(kind: 'single' | 'batch', expected: number, baseline: string[]): PendingMarker {
  return {
    key: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind, expected, baseline, startedAt: Date.now(),
  };
}

/** How many rows landed since this marker's run started (new vs its baseline). */
function landedCount(marker: PendingMarker, rows: RecentRow[]): number {
  return rows.filter(r => !marker.baseline.includes(r.id)).length;
}

function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)     return 'עכשיו';
  const m = Math.floor(s / 60);
  if (m < 60)     return `לפני ${m} דק׳`;
  const h = Math.floor(m / 60);
  if (h < 24)     return h === 1 ? 'לפני שעה' : `לפני ${h} שעות`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'לפני יום' : `לפני ${d} ימים`;
}

export default function CreatePage() {
  const [plt,  setPlt]   = useState('facebook');
  const [tone, setTone]  = useState('חם ואישי');
  const [type, setType]  = useState('הצגת מוצר');

  // Override (optional)
  const [fwOverride,   setFwOverride]   = useState<FrameworkId | null>(null);
  const [hookOverride, setHookOverride] = useState<string | null>(null);

  const [brief,       setBrief]       = useState('');
  const [masterNotes, setMasterNotes] = useState('');

  // Active client + its brief come from the app-wide ClientProvider — the single
  // source of truth. Picking a client in the top switcher re-renders this instantly;
  // there is no client picker here. Generation is grounded in these when present.
  const { activeClient, activeBriefId: briefId, activeHasBrief: hasBrief } = useActiveClient();

  const [tab,  setTab]   = useState('post');
  const [out,  setOut]   = useState<MasterV2Output | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [revealOpen, setRevealOpen] = useState(true);

  // Manual edit of the winning post (G2 — edits are learning signals). The
  // textarea toggles over the read-only OutputBox; saving diffs vs the original
  // and feeds the existing /api/intelligence/signal loop, best-effort.
  const [editing,    setEditing]    = useState(false);
  const [editedPost, setEditedPost] = useState('');
  const [editNote,   setEditNote]   = useState<string | null>(null);

  const [score, setScore]               = useState<(ScoreResult & { score_id: string; iteration: number; max: number }) | null>(null);
  const [showPanel, setShowPanel]       = useState(false);
  const [scoreLoading, setScoreLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [stage,   setStage]   = useState<0 | 1 | 2 | 3>(0); // 0 idle, 1 strategist, 2 creators+judge, 3 editor
  const pLabel = PLATFORMS.find(p => p.id === plt)?.l ?? plt;

  // Batch — "📦 שבוע של תוכן"
  const [batchCount,   setBatchCount]   = useState(3);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchNotice,  setBatchNotice]  = useState<string | null>(null);

  // Recent generations — the server-persisted history that survives navigation.
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const activeClientId = activeClient?.id ?? null;

  const fetchRecent = useCallback(async () => {
    try {
      const qs = activeClientId ? `?clientId=${encodeURIComponent(activeClientId)}` : '';
      const r = await fetch(`/api/ai/master${qs}`);
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data.items)) setRecent(data.items as RecentRow[]);
    } catch (e) { console.error('[create] recent fetch failed', e); }
  }, [activeClientId]);

  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  // ── In-flight run markers (see PendingMarker above). Loaded on mount so a
  //    run started before navigating away resumes being tracked on return.
  const [pending, setPending] = useState<PendingMarker[]>([]);
  useEffect(() => { setPending(loadPendingMarkers()); }, []);

  const updatePending = useCallback((fn: (prev: PendingMarker[]) => PendingMarker[]) => {
    setPending(prev => {
      const next = fn(prev);
      savePendingMarkers(next);
      return next;
    });
  }, []);

  // While ANY run from this session is still unaccounted for, poll the recent
  // list every 10s — finished runs land there progressively (each server-side
  // run inserts its own row on completion).
  const hasPending = pending.length > 0;
  useEffect(() => {
    if (!hasPending) return;
    const iv = setInterval(fetchRecent, 10_000);
    return () => clearInterval(iv);
  }, [hasPending, fetchRecent]);

  // Retire markers whose runs all landed in the list, or that hit the 3-min cap.
  useEffect(() => {
    if (pending.length === 0) return;
    const now = Date.now();
    const next = pending.filter(m =>
      now - m.startedAt < PENDING_TTL_MS && landedCount(m, recent) < m.expected
    );
    if (next.length !== pending.length) updatePending(() => next);
  }, [recent, pending, updatePending]);

  const singleMarker = pending.find(m => m.kind === 'single');
  const batchMarker  = pending.find(m => m.kind === 'batch');
  const batchLanded  = batchMarker ? Math.min(batchMarker.expected, landedCount(batchMarker, recent)) : 0;

  // Restore a stored generation into the page state. Old rows may miss fields
  // (hashtags/image/whatsapp/tips/artifact_id) — fall back so the post text at
  // minimum always renders.
  function restoreRow(row: RecentRow) {
    const o = row.output ?? {};
    const marketer = o.marketer ?? { id: 'unknown', name: 'משווק', emoji: '🎯' };
    const restored: MasterV2Output = {
      avatar:    o.avatar ?? null,
      marketers: Array.isArray(o.marketers) && o.marketers.length > 0 ? o.marketers : [marketer],
      winner: {
        marketer,
        draft: {
          post:       typeof o.post === 'string' ? o.post : '',
          hashtags:   Array.isArray(o.hashtags) ? o.hashtags : [],
          image:      typeof o.image === 'string' ? o.image : '',
          tips:       typeof o.tips === 'string' ? o.tips : '',
          whatsapp:   typeof o.whatsapp === 'string' ? o.whatsapp : '',
          principles: Array.isArray(o.principles) ? o.principles : [],
        },
        score: typeof o.score === 'number' ? o.score : 0,
      },
      scores:         Array.isArray(o.scores) ? o.scores : [],
      judgeRationale: typeof o.why === 'string' ? o.why : '',
      boosted:        Boolean(o.boosted),
    };
    setOut(restored);
    setArtifactId(typeof o.artifact_id === 'string' ? o.artifact_id : null);
    setScore(null); setShowPanel(false); setError(null);
    setEditing(false); setEditNote(null);
    setTab('post');
    setRevealOpen(true);
  }

  // ── G2 (capture side): the winning post is editable; a saved edit is a
  //    learning signal. We diff original→final (word-level, deterministic) and
  //    POST the same route SignalButtons uses — a light edit corroborates
  //    ('worked', the fix rides in `detail`), a heavy rewrite refutes ('wrong').
  //    Strictly best-effort: failures are silent-logged, the user is never blocked.
  function startEdit() {
    if (!out) return;
    setEditedPost(out.winner.draft.post);
    setEditing(true);
    setEditNote(null);
  }

  function saveEdit() {
    if (!out) { setEditing(false); return; }
    const original = out.winner.draft.post;
    const finalText = editedPost.trim();
    setEditing(false);
    if (!finalText || finalText === original.trim()) return;
    setOut(prev => prev
      ? { ...prev, winner: { ...prev.winner, draft: { ...prev.winner.draft, post: finalText } } }
      : prev);
    const sig = buildEditSignal(original, finalText);
    if (sig && artifactId) {
      fetch('/api/intelligence/signal', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ artifactId, kind: sig.kind, detail: sig.detail }),
      })
        .then(r => { if (!r.ok) console.error('[create] edit signal failed:', r.status); })
        .catch(e => console.error('[create] edit signal failed:', e));
      setEditNote('✓ העריכה נשמרה — הלקח הוזן למודל הלמידה');
    } else {
      setEditNote('✓ העריכה נשמרה');
    }
  }

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
    // Generate when EITHER a short brief is typed OR the active client already has
    // a brief (we ground in it). Otherwise show a clear error — never fail silently.
    if (!brief.trim() && !(hasBrief && briefId)) {
      setError('הזן בריף קצר, או בחר לקוח פעיל שכבר יש לו בריף — ואז ניצור על בסיסו.');
      return;
    }
    setLoading(true); setStage(1); setError(null); setOut(null); setScore(null); setArtifactId(null);
    setEditing(false); setEditNote(null);
    // Track the run so it survives navigation: the server persists on completion
    // (CP-4), and this marker keeps the recent list polling until it shows up.
    const marker = newMarker('single', 1, recent.map(r => r.id));
    updatePending(prev => [...prev, marker]);
    // Optimistic stage ticker (no SSE in v1): advance the label on a timer.
    const t1 = setTimeout(() => setStage(2), 12_000);
    const t2 = setTimeout(() => setStage(3), 75_000);
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
          // Bind generation to the active client + its brief explicitly, so it
          // doesn't depend on the active-client cookie reaching the server.
          client_id:   activeClient?.id ?? undefined,
          brief_id:    briefId ?? undefined,
        }),
      });
      const data = await res.json();
      updatePending(prev => prev.filter(m => m.key !== marker.key));
      if (!res.ok) { setError(data.error ?? 'שגיאה ביצירה — נסה שוב'); return; }
      const output = data as MasterV2Output;
      setOut(output);
      setArtifactId((data as { artifact_id?: string | null }).artifact_id ?? null);
      if (output.winner?.draft?.post) fetchScore(output.winner.draft.post);
      setTab('post');
      setRevealOpen(true);
      fetchRecent(); // the route just persisted this generation — refresh the history list
    } catch {
      // Network drop — the server keeps running and persists on completion, so
      // KEEP the marker: polling will surface the post in יצירות אחרונות.
      setError('שגיאת רשת — אם היצירה הושלמה בשרת, הפוסט יופיע ב"יצירות אחרונות" תוך דקות');
    } finally {
      clearTimeout(t1); clearTimeout(t2); setLoading(false); setStage(0);
    }
  }

  async function generateBatch() {
    if (batchLoading || loading) return;
    if (!brief.trim() && !(hasBrief && briefId)) {
      setError('הזן בריף קצר, או בחר לקוח פעיל שכבר יש לו בריף — ואז ניצור על בסיסו.');
      return;
    }
    setBatchLoading(true); setError(null); setBatchNotice(null);
    // The batch route inserts each post's row the moment ITS pipeline finishes,
    // so this marker + the 10s polling render "x/y מוכנים" progressively.
    const marker = newMarker('batch', batchCount, recent.map(r => r.id));
    updatePending(prev => [...prev, marker]);
    try {
      const res = await fetch('/api/ai/master/batch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count:       batchCount,
          brief,
          masterNotes: masterNotes.slice(0, MASTER_NOTES_MAX),
          platform:    pLabel,
          tone,
          type,
          locale:      'he',
          client_id:   activeClient?.id ?? undefined,
          brief_id:    briefId ?? undefined,
        }),
      });
      const data = await res.json();
      updatePending(prev => prev.filter(m => m.key !== marker.key));
      if (!res.ok && !data.succeeded) {
        setError(data.error ?? 'שגיאה ביצירת החבילה — נסה שוב');
        return;
      }
      if (data.failed > 0) {
        setBatchNotice(`נוצרו ${data.succeeded} מתוך ${data.requested} פוסטים — ${data.refunded}⚡ הוחזרו על הכושלים`);
      } else {
        setBatchNotice(`📦 ${data.succeeded} פוסטים מוכנים ב"יצירות אחרונות"`);
      }
      fetchRecent();
    } catch {
      // Network drop mid-batch — the server keeps running; finished posts land
      // in the list via polling, so keep the marker.
      setBatchNotice('שגיאת רשת — היצירה ממשיכה בשרת; פוסטים שיושלמו יופיעו ב"יצירות אחרונות"');
    } finally {
      setBatchLoading(false);
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

          <Card className="mb-3">
            <CardLabel>על מה הפוסט הזה?</CardLabel>

            {hasBrief && activeClient ? (
              <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold rounded-lg px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                ✓ מבוסס על הבריף של {activeClient.emoji} {activeClient.name}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 mb-2 text-[11px] rounded-lg px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-300">
                <span>
                  {activeClient
                    ? `אין בריף ל${activeClient.name} — הפוסט ייווצר מהטקסט בלבד`
                    : 'לא נבחר לקוח פעיל — הפוסט ייווצר מהטקסט בלבד'}
                </span>
                <Link href="/briefs" className="font-semibold underline shrink-0 hover:text-amber-200">
                  {activeClient ? 'צור בריף ←' : 'לבריפים ←'}
                </Link>
              </div>
            )}

            <Textarea value={brief} onChange={setBrief}
              placeholder="מבצע סוף עונה, השקת מוצר…"
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

          <Btn variant="primary" full loading={loading} onClick={generate} disabled={!brief.trim() && !(hasBrief && briefId)}>
            ✨ צור פוסט
          </Btn>

          {/* Batch — a varied week of content in one click (CP-3). The POST is
              non-blocking: posts land progressively in יצירות אחרונות. */}
          <Card className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <CardLabel>📦 שבוע של תוכן</CardLabel>
              <CostBadge cost={batchCount * 6} />
            </div>
            <div className="text-[11px] text-[#6B8FA8] mb-2">
              כמה פוסטים ליצור בבת אחת? כל פוסט בסוג ובזווית שונים — התוצאות יופיעו ב"יצירות אחרונות" ככל שהן מוכנות.
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {[2, 3, 4, 5].map(n => (
                <Chip key={n} label={`${n} פוסטים`} active={batchCount === n} onClick={() => setBatchCount(n)} />
              ))}
            </div>
            <Btn variant="ghost" full loading={batchLoading} onClick={generateBatch}
              disabled={(!brief.trim() && !(hasBrief && briefId)) || batchLoading || loading}>
              📦 צור {batchCount} פוסטים ({batchCount}×6⚡)
            </Btn>
            {batchNotice && <Alert type="blue" className="mt-2">{batchNotice}</Alert>}
          </Card>

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
                  {editing ? (
                    <>
                      <Textarea value={editedPost} onChange={setEditedPost} rows={10} />
                      <div className="flex gap-2">
                        <Btn variant="primary" size="sm" onClick={saveEdit}>💾 שמור</Btn>
                        <Btn variant="ghost" size="sm" onClick={() => setEditing(false)}>ביטול</Btn>
                      </div>
                    </>
                  ) : (
                    <>
                      <OutputBox text={out.winner.draft.post} />
                      <div className="flex gap-2 mt-2">
                        <CopyBtn text={out.winner.draft.post + '\n\n' + out.winner.draft.hashtags.join(' ')} />
                        <Btn variant="ghost" size="sm" onClick={startEdit} disabled={loading}>✏️ ערוך</Btn>
                        <Btn variant="ghost" size="sm" onClick={generate} disabled={loading}>🔄 שוב</Btn>
                      </div>
                      {editNote && <div className="text-[11px] text-emerald-400 mt-2" dir="rtl">{editNote}</div>}
                    </>
                  )}
                  {artifactId && <SignalButtons artifactId={artifactId} className="mt-3" />}
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
            /* Non-blocking: a light placeholder, not a freeze — the form stays
               usable and the pinned strip below carries the progress. */
            <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#2A4158] rounded-xl text-[#6B8FA8] gap-3">
              <span className="text-4xl opacity-30">⏳</span>
              <span className="text-sm">פוסט בהפקה — אפשר להמשיך לערוך את הטופס בינתיים</span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <span className="text-4xl mb-3 opacity-30">✨</span>
              <span className="text-sm">מלא בריף ולחץ "צור פוסט"</span>
            </div>
          )}

          {/* In-flight strip (pinned above יצירות אחרונות) — one row per running
              kind, fed by the pending markers + the 10s polling. Survives
              navigation via sessionStorage; capped at 3 minutes per run. */}
          {(singleMarker || batchMarker) && (
            <Card className="mt-3" style={{ borderColor: '#2A3E66' }}>
              <div className="space-y-2 text-[12px] text-[#D9E8F5]">
                {singleMarker && (
                  <div className="flex items-center gap-2">
                    <Spinner size={14} />
                    <span>⏳ פוסט בהפקה… ~60-90 שנ׳{loading && stage > 0 ? ` · ${STAGE_LABELS[stage]}` : ''}</span>
                  </div>
                )}
                {batchMarker && (
                  <div className="flex items-center gap-2">
                    <Spinner size={14} />
                    <span>📦 שבוע של תוכן: {batchLanded}/{batchMarker.expected} מוכנים…</span>
                    <span className="mr-auto flex items-center gap-1" dir="ltr">
                      {Array.from({ length: batchMarker.expected }, (_, i) => (
                        <span key={i} className={`h-1.5 w-6 rounded-full transition-colors ${i < batchLanded ? 'bg-[#0A7AFF]' : 'bg-[#1E2F42]'}`} />
                      ))}
                    </span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Recent generations — server-persisted history; a click restores the
              full result into the page (so nothing is lost on navigation). */}
          {recent.length > 0 && (
            <Card className="mt-3">
              <CardLabel>🕘 יצירות אחרונות{activeClient ? ` · ${activeClient.emoji} ${activeClient.name}` : ''}</CardLabel>
              <div className="space-y-1.5">
                {recent.map(row => {
                  const o = row.output ?? {};
                  const firstLine = (o.post ?? '').split('\n').find(l => l.trim()) ?? '(ללא טקסט)';
                  return (
                    <button
                      key={row.id}
                      onClick={() => restoreRow(row)}
                      className="w-full flex items-center gap-2 text-right rounded-lg px-3 py-2 bg-[#162030] hover:bg-[#1E2F42] border border-transparent hover:border-[#2A3E66] transition-colors"
                    >
                      <span className="text-lg shrink-0">{o.marketer?.emoji ?? '📝'}</span>
                      <span className="flex-1 min-w-0 truncate text-[12px] text-[#D9E8F5]">{firstLine}</span>
                      {typeof o.score === 'number' && (
                        <span className="shrink-0 text-[10px] font-semibold rounded-full bg-[#0A7AFF] text-white px-2 py-0.5">
                          {o.score}
                        </span>
                      )}
                      {row.platform && (
                        <span className="shrink-0 text-[10px] text-[#6B8FA8] bg-[#0F1826] rounded-full px-2 py-0.5" dir="ltr">
                          {row.platform}
                        </span>
                      )}
                      <span className="shrink-0 text-[10px] text-[#2E4459]">{relTime(row.created_at)}</span>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
