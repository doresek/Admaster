// ════════════════════════════════════════════════════════════
// REPORT METRICS — pure aggregation / delta / prompt helpers
// Used by app/api/reports/route.ts. Kept side-effect free so the
// outcome math + period-over-period deltas are unit-testable.
// ════════════════════════════════════════════════════════════

export interface PerfRow {
  impressions?: number | string | null;
  clicks?: number | string | null;
  spend?: number | string | null;
  reach?: number | string | null;
  conversions?: number | string | null;
  roas?: number | string | null;
}

export interface PerfTotals {
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  conversions: number;
  /** Derived revenue = Σ(roas_row × spend_row). 0 when no ROAS data. */
  revenue: number;
}

/** Coerce a possibly-string numeric (Postgres `numeric` arrives as string) to a finite number. */
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

export function aggregatePerformance(rows: PerfRow[] | null | undefined): PerfTotals {
  return (rows ?? []).reduce<PerfTotals>(
    (acc, r) => {
      const spend = num(r.spend);
      const roas = num(r.roas);
      return {
        impressions: acc.impressions + num(r.impressions),
        clicks: acc.clicks + num(r.clicks),
        spend: acc.spend + spend,
        reach: acc.reach + num(r.reach),
        conversions: acc.conversions + num(r.conversions),
        revenue: acc.revenue + roas * spend,
      };
    },
    { impressions: 0, clicks: 0, spend: 0, reach: 0, conversions: 0, revenue: 0 },
  );
}

/** Cost per acquisition — null when there are no conversions (never fabricate). */
export function cpaOf(t: PerfTotals): number | null {
  return t.conversions > 0 ? t.spend / t.conversions : null;
}

/** Spend-weighted ROAS — null unless we actually have revenue + spend. */
export function roasOf(t: PerfTotals): number | null {
  return t.revenue > 0 && t.spend > 0 ? t.revenue / t.spend : null;
}

/** Percent change vs a prior value; null when prior is 0 (avoid div-by-zero / fake ∞). */
export function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

export interface MetricDelta {
  current: number;
  prior: number;
  absChange: number;
  pctChange: number | null;
}

export interface NullableMetricDelta {
  current: number | null;
  prior: number | null;
  absChange: number | null;
  pctChange: number | null;
}

export interface PeriodComparison {
  spend: MetricDelta;
  conversions: MetricDelta;
  cpa: NullableMetricDelta;
  roas: { current: number | null; prior: number | null };
}

function delta(current: number, prior: number): MetricDelta {
  return { current, prior, absChange: current - prior, pctChange: pctChange(current, prior) };
}

export function buildPeriodComparison(current: PerfTotals, prior: PerfTotals): PeriodComparison {
  const curCpa = cpaOf(current);
  const priCpa = cpaOf(prior);
  return {
    spend: delta(current.spend, prior.spend),
    conversions: delta(current.conversions, prior.conversions),
    cpa: {
      current: curCpa,
      prior: priCpa,
      absChange: curCpa !== null && priCpa !== null ? curCpa - priCpa : null,
      pctChange: curCpa !== null && priCpa !== null ? pctChange(curCpa, priCpa) : null,
    },
    roas: { current: roasOf(current), prior: roasOf(prior) },
  };
}

// ── Prior-period date range ──────────────────────────────────
// Current period is [start, end] inclusive. The immediately-preceding
// equal-length window is [start − len, start) — gte priorStart, lt start.

const DAY_MS = 86_400_000;
const toIso = (d: Date): string => d.toISOString().slice(0, 10);

export interface PriorRange {
  start: string;      // inclusive (gte)
  endExclusive: string; // exclusive (lt) === current periodStart
}

export function priorPeriodRange(periodStart: string, periodEnd: string): PriorRange {
  const startMs = Date.parse(`${periodStart}T00:00:00Z`);
  const endMs = Date.parse(`${periodEnd}T00:00:00Z`);
  // Inclusive day count of the current period (min 1).
  const lenDays = Math.max(1, Math.round((endMs - startMs) / DAY_MS) + 1);
  return {
    start: toIso(new Date(startMs - lenDays * DAY_MS)),
    endExclusive: periodStart,
  };
}

// ── Hebrew prompt composition (outcome-led) ─────────────────
export interface ReportPromptInput {
  clientName?: string | null;
  periodStart: string;
  periodEnd: string;
  totals: PerfTotals;
  avgCtr: string;
  avgCpc: string;
  postsPublished: number;
  comparison?: PeriodComparison | null;
}

const fmtNum = (n: number): string => Math.round(n).toLocaleString('he-IL');
const fmtMoney = (n: number): string => `₪${n.toFixed(2)}`;
const fmtPct = (p: number | null): string =>
  p === null ? 'אין נתון השוואה' : `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;

export function composeReportPrompt(input: ReportPromptInput): string {
  const { clientName, periodStart, periodEnd, totals, avgCtr, avgCpc, postsPublished, comparison } = input;
  const cpa = cpaOf(totals);
  const roas = roasOf(totals);

  // ── Outcome block (leads the report) ──
  const outcomeLines = [
    `- המרות/תוצאות עסקיות: ${fmtNum(totals.conversions)}`,
    `- עלות לתוצאה (CPA): ${cpa === null ? 'אין המרות בתקופה זו — אין CPA לחישוב' : fmtMoney(cpa)}`,
    `- השקעה כוללת: ${fmtMoney(totals.spend)}`,
    roas === null
      ? `- ROAS: אין נתוני הכנסה/ערך-המרה זמינים — אל תחשב ROAS ואל תמציא אותו`
      : `- ROAS (החזר על ההשקעה): ${roas.toFixed(2)} (כל ₪1 השקעה החזיר ₪${roas.toFixed(2)})`,
  ];

  // ── Prior-period deltas (optional) ──
  let comparisonBlock = 'אין נתוני תקופה קודמת זמינים — אל תזכיר השוואה ואל תמציא מגמות.';
  if (comparison) {
    const cpaLine =
      comparison.cpa.current === null
        ? 'CPA: אין המרות בתקופה הנוכחית'
        : comparison.cpa.prior === null
          ? `CPA נוכחי ${fmtMoney(comparison.cpa.current)} (אין CPA קודם להשוואה)`
          : `CPA: ${fmtMoney(comparison.cpa.current)} מול ${fmtMoney(comparison.cpa.prior)} (${fmtPct(comparison.cpa.pctChange)})`;
    comparisonBlock = [
      `- השקעה: ${fmtMoney(comparison.spend.current)} מול ${fmtMoney(comparison.spend.prior)} (${fmtPct(comparison.spend.pctChange)})`,
      `- המרות: ${fmtNum(comparison.conversions.current)} מול ${fmtNum(comparison.conversions.prior)} (${fmtPct(comparison.conversions.pctChange)})`,
      `- ${cpaLine}`,
    ].join('\n');
  }

  return `כתוב דוח שיווקי מקצועי בעברית עבור הלקוח ${clientName ?? ''}.
תקופה: ${periodStart} עד ${periodEnd}

חוק־על: הדוח חייב להוביל בתוצאות עסקיות (ROI), לא בפעילות. לקוחות רוצים לדעת "מה יצא לי מזה", לא רק כמה הופעות היו. התחל מהתוצאה העסקית, רק אחר כך הבא מדדי פעילות כהקשר תומך. אסור להמציא מספרים — תאר אך ורק את הנתונים שמסופקים; אם אין המרות, אמור זאת בכנות ואל תמציא ROAS.

== תוצאות עסקיות (פתח בזה) ==
${outcomeLines.join('\n')}

== השוואה לתקופה הקודמת ==
${comparisonBlock}

== מדדי פעילות (הקשר תומך בלבד — הצג אחרי סיפור התוצאות) ==
- חשיפות: ${fmtNum(totals.impressions)}
- טווח (Reach): ${fmtNum(totals.reach)}
- קליקים: ${fmtNum(totals.clicks)}
- CTR: ${avgCtr}%
- CPC: ${fmtMoney(parseFloat(avgCpc))}
- פוסטים שפורסמו: ${postsPublished}

מבנה הדוח הנדרש:
1. שורת פתיחה — התוצאה העסקית המרכזית של התקופה (המרות, עלות לתוצאה, ויעילות ההשקעה).
2. "מה זה אומר לעסק" — פסקה קצרה בעברית פשוטה שמתרגמת את המספרים למשמעות עסקית (האם ההשקעה עבדה, האם השתפרנו מול התקופה הקודמת).
3. הישגים עיקריים מבוססי תוצאה.
4. מדדי פעילות תומכים (חשיפות/טווח/קליקים/CTR/CPC) — בקצרה, כהקשר בלבד.
5. המלצות פעולה לתקופה הבאה שמכוונות לשיפור התוצאה העסקית.

טון מקצועי, בהיר ונעים. אל תמציא נתונים שלא סופקו.`;
}
