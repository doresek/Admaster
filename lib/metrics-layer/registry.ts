// lib/metrics-layer/registry.ts
//
// THE KPI REGISTRY — the single source of truth for every number the
// dashboards show (DASHBOARD-ARCHITECTURE §0.1). Each entry is pure data plus
// a PURE formula over measurement-spine rows: no I/O, no clock, no locale —
// so every definition is reviewable in one screen and provable by hand-math
// tests.
//
// Launch registry: the honest 12 computable from the spine + campaigns TODAY
// (funnel_leads / lead_stage_events / client_economics / channel_reconciliation
// / campaigns). Metrics that would need live platform data (impressions, CTR,
// real spend) are NOT here — they arrive with the H4 flip rather than being
// faked (§0: honesty is the differentiator).
//
// Totality doctrine: a formula NEVER returns NaN/Infinity — either a finite
// number or null with a Hebrew reason the UI can show verbatim.

import type {
  FunnelLeadRow,
  LeadStage,
  LeadStageEventRow,
} from '@/lib/capability-contracts';
import type {
  FormulaContext,
  MetricDef,
  MetricResult,
  PeriodSlice,
} from './types';

// ── deterministic numeric helpers ─────────────────────────────────────────────

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** 2-dp rounding — the layer's only rounding authority (float-noise control). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

const ok = (value: number): MetricResult => ({ value: round2(value), reason: null });
const notComputable = (reason: string): MetricResult => ({ value: null, reason });

/** Percentage num/den at 2 dp; caller guarantees den > 0. */
const pctOf = (num: number, den: number): MetricResult => ok((num / den) * 100);

// ── stage semantics ───────────────────────────────────────────────────────────

/** Stages that mean "this lead qualified (or went further)". */
const QUALIFIED_OR_BEYOND: readonly LeadStage[] = ['qualified', 'meeting', 'closed_won'];

const isQualifiedOrBeyond = (stage: LeadStage): boolean =>
  QUALIFIED_OR_BEYOND.some((s) => s === stage);

/**
 * Distinct lead ids that qualified: a lead counts when EITHER its live
 * current_stage is qualified-or-beyond OR a qualified-or-beyond stage event
 * exists in the slice. WHY the union: current_stage loses history (a lead that
 * qualified then closed_lost reads 'closed_lost'), and the slice's events only
 * cover the period — together they recover every RECORDED qualification
 * without inventing one.
 */
function qualifiedLeadIds(slice: PeriodSlice): Set<string> {
  const ids = new Set<string>();
  for (const lead of slice.leads) {
    if (isQualifiedOrBeyond(lead.current_stage)) ids.add(lead.id);
  }
  const inCohort = new Set(slice.leads.map((l) => l.id));
  for (const e of slice.stageEvents) {
    if (inCohort.has(e.lead_id) && isQualifiedOrBeyond(e.stage)) ids.add(e.lead_id);
  }
  return ids;
}

/** closed_won events in the slice with a recorded finite value. */
const wonEventsWithValue = (events: readonly LeadStageEventRow[]): LeadStageEventRow[] =>
  events.filter((e) => e.stage === 'closed_won' && isFiniteNumber(e.value));

// ── reusable formula cores (shared by composed metrics — cost_per_lead, ROAS) ──

const NO_LEADS_REASON = 'אין לידים בתקופה';

function leadsTotal(slice: PeriodSlice): MetricResult {
  return ok(slice.leads.length);
}

/**
 * Planned spend: Σ daily_budget × periodDays over LIVE, non-dry-run campaigns.
 * WHY planned: live platform spend is H4-gated; the only recorded spend signal
 * today is the daily budget of running campaigns. Every consumer carries the
 * 'תקציב מתוכנן' honesty label — a labeled approximation beats a fabricated
 * "actual" (§0).
 */
function spendTotal(slice: PeriodSlice, ctx: FormulaContext): MetricResult {
  if (ctx.periodDays < 1) return notComputable('תקופה לא תקינה — לא ניתן לחשב הוצאה');
  const live = slice.campaigns.filter(
    (c) => c.status === 'live' && !c.dry_run && isFiniteNumber(c.daily_budget),
  );
  if (live.length === 0) {
    return notComputable('אין קמפיינים חיים עם תקציב — נתוני הוצאה ייכנסו כשחיבור המודעות יעלה');
  }
  let total = 0;
  for (const c of live) {
    if (isFiniteNumber(c.daily_budget)) total += c.daily_budget * ctx.periodDays;
  }
  return ok(total);
}

/** Σ recorded closed_won values; 0 when nothing closed (an honest zero). */
function closedValue(slice: PeriodSlice): MetricResult {
  const won = slice.stageEvents.filter((e) => e.stage === 'closed_won');
  if (won.length === 0) return ok(0);
  const valued = wonEventsWithValue(won);
  if (valued.length === 0) {
    return notComputable('נסגרו עסקאות אך בלי ערך רשום — סמן ערך כדי לחשב הכנסה');
  }
  let sum = 0;
  for (const e of valued) {
    if (isFiniteNumber(e.value)) sum += e.value;
  }
  return ok(sum);
}

// ── the launch registry ───────────────────────────────────────────────────────

const BENCHMARK_NOTE =
  'בנצ׳מרק ענפי ייכנס כשיהיו מספיק לקוחות במערכת (C-12) — עד אז אין השוואה מומצאת.';

/** Attribution-derived numbers carry the honesty label (§1 spine plan). */
const CLICK_BASED = 'מבוסס קליקים';
const PLANNED_BUDGET = 'תקציב מתוכנן — לא הוצאה בפועל מהפלטפורמה';

export const METRIC_REGISTRY: readonly MetricDef[] = [
  {
    key:            'leads_total',
    name_he:        'לידים',
    description_he: 'כמה לידים חדשים נכנסו בתקופה (כל המקורות, רישום קנוני ב-funnel_leads).',
    unit:           'count',
    grain:          'week',
    direction:      'up_good',
    honesty_label:  null,
    benchmark:      null,
    formula:        (slice) => leadsTotal(slice),
  },
  {
    key:            'leads_qualified',
    name_he:        'לידים רלוונטיים',
    description_he: 'כמה מהלידים של התקופה הגיעו לשלב "רלוונטי" ומעלה (פגישה/סגירה).',
    unit:           'count',
    grain:          'week',
    direction:      'up_good',
    honesty_label:  null,
    benchmark:      null,
    formula:        (slice) => ok(qualifiedLeadIds(slice).size),
  },
  {
    key:            'qualified_rate',
    name_he:        'אחוז לידים רלוונטיים',
    description_he: `איזה חלק מהלידים של התקופה רלוונטי — מדד איכות הקהל. ${BENCHMARK_NOTE}`,
    unit:           'pct',
    grain:          'week',
    direction:      'up_good',
    honesty_label:  null,
    benchmark:      null,
    formula:        (slice) =>
      slice.leads.length === 0
        ? notComputable(NO_LEADS_REASON)
        : pctOf(qualifiedLeadIds(slice).size, slice.leads.length),
  },
  {
    key:            'irrelevant_rate',
    name_he:        'אחוז לידים לא רלוונטיים',
    description_he: 'איזה חלק מהלידים סומן "לא רלוונטי" — האיתות השלילי שמזין את המוח (U2).',
    unit:           'pct',
    grain:          'week',
    direction:      'down_good',
    honesty_label:  null,
    benchmark:      null,
    formula:        (slice) =>
      slice.leads.length === 0
        ? notComputable(NO_LEADS_REASON)
        : pctOf(
            slice.leads.filter((l: FunnelLeadRow) => l.current_stage === 'irrelevant').length,
            slice.leads.length,
          ),
  },
  {
    key:            'close_rate',
    name_he:        'אחוז סגירה',
    description_he: 'מתוך העסקאות שהוכרעו בתקופה (נסגרו/אבדו) — כמה נסגרו בהצלחה.',
    unit:           'pct',
    grain:          'month',
    direction:      'up_good',
    honesty_label:  null,
    benchmark:      null,
    formula:        (slice) => {
      // Decided-this-period win rate: a lead is WON if any closed_won event
      // exists in the slice; LOST only if closed_lost and never won.
      const won  = new Set<string>();
      const lost = new Set<string>();
      for (const e of slice.stageEvents) {
        if (e.stage === 'closed_won') won.add(e.lead_id);
        else if (e.stage === 'closed_lost') lost.add(e.lead_id);
      }
      for (const id of won) lost.delete(id);
      const decided = won.size + lost.size;
      return decided === 0
        ? notComputable('אף עסקה לא הוכרעה בתקופה — אין ממה לחשב אחוז סגירה')
        : pctOf(won.size, decided);
    },
  },
  {
    key:            'closed_value',
    name_he:        'הכנסה מעסקאות שנסגרו',
    description_he: 'סכום הערכים שנרשמו על סגירות בתקופה (₪). אפס = לא נסגר כלום, בכנות.',
    unit:           'ils',
    grain:          'month',
    direction:      'up_good',
    honesty_label:  null,
    benchmark:      null,
    formula:        (slice) => closedValue(slice),
  },
  {
    key:            'contacted_24h_rate',
    name_he:        'מענה תוך 24 שעות',
    description_he: 'איזה חלק מהלידים החדשים קיבל מענה (כל שלב אחרי "חדש") בתוך יממה — מהירות התגובה היא המנוף הכי זול לשיפור סגירות.',
    unit:           'pct',
    grain:          'week',
    direction:      'up_good',
    honesty_label:  null,
    benchmark:      null,
    formula:        (slice) => {
      if (slice.leads.length === 0) return notComputable(NO_LEADS_REASON);
      // First recorded non-'new' touch per lead; a lead with no touch counts
      // as not-answered (denominator honesty). Leads born near period end may
      // read low — v1 accepts this over inventing a grace window.
      const firstTouch = new Map<string, number>();
      for (const e of slice.stageEvents) {
        if (e.stage === 'new') continue;
        const t = Date.parse(e.created_at);
        if (!Number.isFinite(t)) continue;
        const prev = firstTouch.get(e.lead_id);
        if (prev === undefined || t < prev) firstTouch.set(e.lead_id, t);
      }
      const DAY_MS = 24 * 60 * 60 * 1000;
      let within = 0;
      for (const lead of slice.leads) {
        const born = Date.parse(lead.created_at);
        const touch = firstTouch.get(lead.id);
        if (Number.isFinite(born) && touch !== undefined && touch - born <= DAY_MS) within += 1;
      }
      return pctOf(within, slice.leads.length);
    },
  },
  {
    key:            'consent_rate',
    name_he:        'אחוז הסכמה לדיוור',
    description_he: 'איזה חלק מהלידים נתן הסכמה שיווקית מפורשת (חוק הספאם 30א) — גודל קהל הרימרקטינג החוקי.',
    unit:           'pct',
    grain:          'month',
    direction:      'up_good',
    honesty_label:  null,
    benchmark:      null,
    formula:        (slice) =>
      slice.leads.length === 0
        ? notComputable(NO_LEADS_REASON)
        : pctOf(slice.leads.filter((l) => l.consent_marketing === true).length, slice.leads.length),
  },
  {
    key:            'spend_total',
    name_he:        'השקעה בפרסום',
    description_he: 'תקציב יומי מתוכנן של קמפיינים חיים × ימי התקופה. הוצאה אמיתית מהפלטפורמה תחליף את זה כשחיבור המודעות יעלה (H4).',
    unit:           'ils',
    grain:          'week',
    direction:      'down_good',
    honesty_label:  PLANNED_BUDGET,
    benchmark:      null,
    formula:        (slice, ctx) => spendTotal(slice, ctx),
  },
  {
    key:            'cost_per_lead',
    name_he:        'עלות לליד',
    description_he: 'השקעה בפרסום חלקי לידים שנכנסו — המספר שבעל עסק באמת מרגיש.',
    unit:           'ils',
    grain:          'week',
    direction:      'down_good',
    honesty_label:  CLICK_BASED,
    benchmark:      null,
    formula:        (slice, ctx) => {
      const spend = spendTotal(slice, ctx);
      if (spend.value === null) return notComputable(spend.reason ?? 'אין נתוני הוצאה');
      if (slice.leads.length === 0) return notComputable('אין לידים בתקופה — אין ממה לחשב עלות לליד');
      return ok(spend.value / slice.leads.length);
    },
  },
  {
    key:            'roas_vs_breakeven',
    name_he:        'יחס לנקודת האיזון',
    description_he: 'החזר על הפרסום חלקי נקודת האיזון (1/שולי הרווח, מחושב — לא מנוחש). מעל 1 = משתלם; מתחת = מפסיד.',
    unit:           'ratio',
    grain:          'month',
    direction:      'up_good',
    honesty_label:  CLICK_BASED,
    benchmark:      null,
    formula:        (slice, ctx) => {
      const cm = ctx.economics?.contribution_margin_pct;
      if (!isFiniteNumber(cm) || cm <= 0) {
        return notComputable('חסרים נתוני כלכלה — הגדר שולי רווח כדי לחשב נקודת איזון');
      }
      const spend = spendTotal(slice, ctx);
      if (spend.value === null) return notComputable(spend.reason ?? 'אין נתוני הוצאה');
      if (spend.value === 0) return notComputable('הוצאה אפס — אין ממה לחשב החזר');
      const revenue = closedValue(slice);
      if (revenue.value === null) return notComputable(revenue.reason ?? 'אין נתוני הכנסה');
      const roas = revenue.value / spend.value;
      const breakeven = 100 / cm; // break-even ROAS = 1 / contribution margin
      return ok(roas / breakeven);
    },
  },
  {
    key:            'reconciliation_ratio',
    name_he:        'יחס דיווח פלטפורמה מול CRM',
    description_he: 'כמה המרות הפלטפורמה טוענת מול כמה לידים באמת נרשמו (משוקלל לפי CRM). מטא נוטה לדווח ביתר ~15–20%; מעל פי 2 = דדופ שבור.',
    unit:           'ratio',
    grain:          'month',
    direction:      'down_good',
    honesty_label:  null,
    // The one honest static prior we have: Meta over-reports ~15–20% vs CRM
    // (MEASUREMENT-SPINE-PLAN §1) → a healthy ratio sits at/below ~1.2.
    benchmark:      1.2,
    formula:        (slice) => {
      if (slice.reconciliation.length === 0) {
        return notComputable('אין נתוני הצלבה לתקופה — ריצת ההצלבה החודשית טרם רצה');
      }
      let claimed = 0;
      let truth = 0;
      for (const r of slice.reconciliation) {
        if (isFiniteNumber(r.platform_claimed)) claimed += r.platform_claimed;
        if (isFiniteNumber(r.crm_truth)) truth += r.crm_truth;
      }
      if (truth <= 0) return notComputable('אין לידים ב-CRM בתקופת ההצלבה — היחס לא מוגדר');
      return ok(claimed / truth);
    },
  },
];

/** Registry lookup by key (defs are unique-keyed; tested). */
export function metricDef(key: string): MetricDef | null {
  return METRIC_REGISTRY.find((d) => d.key === key) ?? null;
}
