// lib/organic-posts/index.ts
//
// Public surface of P1-3 organic post generation. Callers (calendar UI,
// heartbeat weekly tick, API routes) import from here only.

export {
  composeSlotBrief,
  generateForPlan,
  generateOrganicPost,
  slotToStudioInput,
} from './generate';

export { inMemorySlotWriter, supabaseSlotWriter } from './writer';

export type {
  GenerateForPlanParams,
  GenerateForPlanResult,
  GenerateOrganicPostParams,
  OrganicPostResult,
  PlanSlotRef,
  SlotAttachPatch,
  SlotWriter,
} from './types';
