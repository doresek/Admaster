// ════════════════════════════════════════════
// Batch generation ("צור לי X פוסטים") — pure, deterministic helpers.
//
// planBatchVariations: a batch must read like a varied week of content, not X
// clones — so each run rotates the post `type` and the `hook` through the same
// vocabularies the create page offers, starting from the user's chosen type.
//
// settleBatch: credit math for the up-front-deduct / per-failure-refund model.
// Kept pure so refund semantics are unit-testable without a Supabase client.
// ════════════════════════════════════════════

export const BATCH_MIN = 2;
export const BATCH_MAX = 5;

/** Same vocabulary as the create page's סוג פוסט chips, ordered as a varied week. */
export const BATCH_TYPES = ['הצגת מוצר', 'טיפ מקצועי', 'בניית אמון', 'שאלה לקהל', 'מבצע'] as const;
/** Same vocabulary as the create page's Hook chips. */
export const BATCH_HOOKS = ['שאלה פרובוקטיבית', 'עובדה מפתיעה', 'סיפור אישי', 'הצעה חסרת תחרות', 'אזהרה'] as const;

export interface BatchVariation { type: string; hook: string; }

export function isValidBatchCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= BATCH_MIN && n <= BATCH_MAX;
}

/**
 * Plan `count` (type, hook) pairs. Types rotate one step per run starting at the
 * user's chosen type (unknown/omitted type starts at index 0), so the user's
 * pick leads the batch. Hooks rotate with a stride of 2 — coprime with the
 * 5-item list — so within any batch of ≤5 all hooks are distinct AND the
 * type↔hook pairing differs from a simple parallel walk.
 */
export function planBatchVariations(count: number, base?: { type?: string | null }): BatchVariation[] {
  const start = Math.max(0, BATCH_TYPES.indexOf((base?.type ?? '') as typeof BATCH_TYPES[number]));
  return Array.from({ length: count }, (_, i) => ({
    type: BATCH_TYPES[(start + i) % BATCH_TYPES.length],
    hook: BATCH_HOOKS[(start + 2 * i) % BATCH_HOOKS.length],
  }));
}

export interface BatchSettlement {
  succeeded: number;
  failed:    number;
  /** Credits to give back — one unit cost per failed run (whole batch failed ⇒ everything). */
  refunded:  number;
  /** Best-known balance after refunds: balance after the up-front deduction + the refund. */
  credits:   number;
}

/**
 * Refund math for a settled batch. The route deducted `okFlags.length` units up
 * front (`creditsAfterDeduct` = balance the last deduction reported); every
 * failed run refunds exactly one unit — never more (no double-refund), never
 * less (no swallowed refunds).
 */
export function settleBatch(opts: {
  okFlags: boolean[];
  unitCost: number;
  creditsAfterDeduct: number;
}): BatchSettlement {
  const succeeded = opts.okFlags.filter(Boolean).length;
  const failed    = opts.okFlags.length - succeeded;
  const refunded  = failed * opts.unitCost;
  return { succeeded, failed, refunded, credits: opts.creditsAfterDeduct + refunded };
}
