// ════════════════════════════════════════════
// lib/organic-publish — P1-4 organic publishing worker (DRY-RUN by default).
//
// The Meta App-Review demo flow (G0-4): organic_schedule slot → autonomy
// route ('publish_organic') → lib/meta-publish (dryRun) → slot + item status.
// Live is a flag-flip (G0-6), zero structural change — see worker.ts.
//
// Public surface:
//   publishDueSlots(params, deps)          — the worker
//   supabaseSlotStore / inMemorySlotStore  — the SlotStore seam
//   types                                  — slot row, results, seams
// ════════════════════════════════════════════

export {
  publishDueSlots,
  DEFAULT_DUE_WINDOW_MS,
  DRY_RUN_PAGE_ID,
  type PublishDueSlotsParams,
  type PublishDueSlotsDeps,
} from './worker';

export { supabaseSlotStore, inMemorySlotStore } from './store';

export type {
  OrganicSlot,
  OrganicSlotPatch,
  OrganicSlotStatus,
  OrganicPostKind,
  SlotStore,
  SlotOutcome,
  SlotResult,
  PublishDueSlotsResult,
} from './types';
