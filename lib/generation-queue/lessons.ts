// ════════════════════════════════════════════
// Learning-context ("לקחים") derivation — the G1 wire of the learning loop.
//
// The create path used to send the writers ZERO history: every post was written
// as if the system had never written one before (see docs/LEARNING-LOOP-MAP.md
// §b.3). This module closes the tightest loop with zero new tables: it reads
// the client's recent judged `generated_content` master_post rows (whose
// `output.scores` carry per-dimension judge verdicts since wave 1) and reduces
// them — deterministically, no LLM call — to a compact Hebrew "lessons block":
// the chronically weakest dimensions with their average scores, plus the
// judge's recent rationales. The block rides on `MasterStudioInput.learningContext`
// and enters the Creator + Editor prompts as a clearly-framed section.
//
// Everything here is best-effort: no history / no client / a query error all
// yield `undefined`, which leaves the prompts byte-identical to before.
// ════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { SCORE_DIMS, type ScoreDim } from '@/lib/master-studio';

/** How many recent master_post rows feed the lessons block. */
export const LESSONS_HISTORY_LIMIT = 8;
/** How many chronically-weak dimensions the block names. */
export const LESSONS_WEAK_DIMS = 3;
/** How many recent judge rationales the block quotes. */
export const LESSONS_MAX_RATIONALES = 3;
/** Per-rationale quote cap, so a verbose judge can't bloat the prompt. */
export const LESSONS_RATIONALE_MAX_CHARS = 200;

/** Hebrew labels for the judge dimensions (prompt-facing). */
export const DIM_LABELS_HE: Record<ScoreDim, string> = {
  scroll_stop:         'עצירת-גלילה',
  hook_strength:       'חוזק ההוק הפותח',
  clarity:             'בהירות המסר',
  emotional_resonance: 'תהודה רגשית',
  cta_strength:        'חוזק הקריאה לפעולה',
  brand_fit:           'התאמה למותג',
  awareness_match:     'התאמה לרמת המודעות',
  framework_adherence: 'נאמנות ל-framework',
};

/** The subset of a `generated_content` row the derivation reads. */
export interface JudgedHistoryRow {
  output: {
    scores?: Array<{ dims?: Partial<Record<string, number>> | null } | null> | null;
    why?:    string | null;
  } | null;
}

export interface WeakDim { dim: ScoreDim; avg: number; n: number; }

/**
 * Aggregate per-dimension averages across every judged variant in the given
 * rows and return the weakest dimensions, ascending by average.
 *
 * A dim value of 0 is treated as "not scored" (the judge parser clamps missing
 * dims to 0 — e.g. scroll_stop on rows that predate the dimension), so zeros
 * never fake a chronic weakness. Ties break by SCORE_DIMS order (deterministic).
 */
export function aggregateWeakDims(rows: JudgedHistoryRow[], take = LESSONS_WEAK_DIMS): WeakDim[] {
  const sums = new Map<ScoreDim, { sum: number; n: number }>();
  for (const row of rows) {
    const scores = row?.output?.scores;
    if (!Array.isArray(scores)) continue;
    for (const variant of scores) {
      const dims = variant?.dims;
      if (!dims) continue;
      for (const dim of SCORE_DIMS) {
        const v = Number(dims[dim]);
        if (!Number.isFinite(v) || v <= 0) continue; // 0 = unscored, not "terrible"
        const acc = sums.get(dim) ?? { sum: 0, n: 0 };
        acc.sum += v; acc.n += 1;
        sums.set(dim, acc);
      }
    }
  }
  return SCORE_DIMS
    .filter(dim => sums.has(dim))
    .map(dim => {
      const { sum, n } = sums.get(dim)!;
      return { dim, avg: Math.round(sum / n), n };
    })
    // Stable sort: ascending avg; equal avgs keep SCORE_DIMS order.
    .sort((a, b) => a.avg - b.avg)
    .slice(0, take);
}

/** Recent non-empty judge rationales, newest-first order preserved, deduped. */
export function recentRationales(rows: JudgedHistoryRow[], take = LESSONS_MAX_RATIONALES): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const why = (row?.output?.why ?? '').trim();
    if (!why) continue;
    const clipped = why.length > LESSONS_RATIONALE_MAX_CHARS
      ? `${why.slice(0, LESSONS_RATIONALE_MAX_CHARS)}…`
      : why;
    if (!out.includes(clipped)) out.push(clipped);
    if (out.length >= take) break;
  }
  return out;
}

/**
 * Reduce recent judged rows to the compact Hebrew lessons block (the BODY —
 * the prompt composers add the framed "לקחים מפוסטים קודמים" header).
 * Returns null when there is nothing judged to learn from.
 */
export function deriveLessonsBlock(rows: JudgedHistoryRow[]): string | null {
  const weak = aggregateWeakDims(rows);
  if (weak.length === 0) return null;

  const judgedRows = rows.filter(r =>
    Array.isArray(r?.output?.scores) && (r.output!.scores as unknown[]).length > 0).length;

  const lines: string[] = [];
  lines.push(`על בסיס ${judgedRows} פוסטים אחרונים שנשפטו ללקוח זה, אלו הממדים החלשים באופן עקבי (ממוצע 0-100):`);
  for (const w of weak) {
    lines.push(`• ${DIM_LABELS_HE[w.dim]} (${w.dim}) — ממוצע ${w.avg}`);
  }

  const rationales = recentRationales(rows);
  if (rationales.length > 0) {
    lines.push('נימוקי השופט האחרונים:');
    for (const r of rationales) lines.push(`• "${r}"`);
  }

  lines.push('בפוסט הזה תקוף את נקודות התורפה האלו במפורש — חזק אותן בכוונה תחילה, מבלי להחליש את הממדים שכבר חזקים.');
  return lines.join('\n');
}

/**
 * Load the client's recent master_post history and derive the lessons block.
 * Client-scoped: without an active client there is no coherent history →
 * undefined. Best-effort: any query error is silent-logged and yields
 * undefined (a generation must never fail because learning couldn't load).
 */
export async function loadLearningContext(
  supabase: SupabaseClient,
  opts: { userId: string; clientId: string | null },
): Promise<string | undefined> {
  if (!opts.clientId) return undefined;
  try {
    const { data, error } = await supabase
      .from('generated_content')
      .select('output')
      .eq('user_id', opts.userId)
      .eq('client_id', opts.clientId)
      .eq('type', 'master_post')
      .order('created_at', { ascending: false })
      .limit(LESSONS_HISTORY_LIMIT);
    if (error) {
      console.error('[lessons] history load failed:', error.message);
      return undefined;
    }
    return deriveLessonsBlock((data ?? []) as JudgedHistoryRow[]) ?? undefined;
  } catch (e) {
    console.error('[lessons] history load threw:', e);
    return undefined;
  }
}
