// ════════════════════════════════════════════
// Edit-capture (G2, capture side) — map a manual user edit of the winning post
// onto the EXISTING user-signal contract, pure and deterministic.
//
// The signal route (`POST /api/intelligence/signal`) speaks only
// `kind: 'worked' | 'wrong'` (+ free-text `detail`). An edit is neither a clean
// ✓ nor a clean ✗, so we use the closest supported shape, decided by how much
// of the text the user rewrote (word-level diff):
//   • small edit  (< EDIT_WRONG_THRESHOLD changed) → 'worked' — the creative
//     direction held; the correction rides in `detail`.
//   • heavy rewrite (≥ threshold)                 → 'wrong'  — the post missed;
//     the user's replacement rides in `detail`.
// The `detail` string carries the change % + before/after snippets, persisted
// to `learning_signals.detail` (today write-only — the capture is the point).
//
// No new plumbing, no lib/intelligence changes: callers POST the same route
// SignalButtons uses, best-effort (failures silent-logged, never block the user).
// ════════════════════════════════════════════

/** Changed-fraction at/above which an edit counts as "the post was wrong". */
export const EDIT_WRONG_THRESHOLD = 0.5;

const SNIPPET_MAX = 140;

function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

/**
 * Fraction of the text changed between original and edited, in [0, 1]:
 * 1 − (2·LCS / (|a| + |b|)) over words. 0 = identical, 1 = fully rewritten.
 */
export function changedFraction(original: string, edited: string): number {
  const a = words(original), b = words(edited);
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0 || b.length === 0) return 1;
  // Word-level LCS, single rolling row (posts are ≤2000 chars — tiny).
  const dp = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0; // dp[i-1][j-1]
    for (let j = 1; j <= b.length; j++) {
      const above = dp[j]; // dp[i-1][j]
      dp[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(above, dp[j - 1]);
      diagonal = above;
    }
  }
  return 1 - (2 * dp[b.length]) / (a.length + b.length);
}

export interface EditSignal {
  kind:    'worked' | 'wrong';
  detail:  string;
  /** Changed fraction in [0,1] — exposed for UI/telemetry. */
  changed: number;
}

/**
 * Build the signal payload for a manual edit, or null when there is nothing to
 * learn (no real change, or the user emptied the post).
 */
export function buildEditSignal(original: string, edited: string): EditSignal | null {
  const o = original.trim();
  const e = edited.trim();
  if (!e || o === e) return null;

  const changed = changedFraction(o, e);
  const pct = Math.round(changed * 100);
  const kind: EditSignal['kind'] = changed >= EDIT_WRONG_THRESHOLD ? 'wrong' : 'worked';
  const snip = (s: string) => {
    const flat = s.replace(/\s+/g, ' ');
    return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX)}…` : flat;
  };
  const detail =
    `עריכה ידנית של המשתמש (כ-${pct}% מהטקסט שונה). ` +
    `לפני: "${snip(o)}" | אחרי: "${snip(e)}"`;
  return { kind, detail, changed };
}
