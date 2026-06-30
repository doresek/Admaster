// lib/diagnosis/index.ts
//
// Public surface for diagnosis + auto-improvement (the DIAGNOSE → AUTO-IMPROVE
// arc that closes the learning loop).
export { diagnoseCampaignItem } from './diagnose';
export type {
  DiagnoseCampaignItemInput,
  DiagnosisRow,
  DiagnoseDeps,
  DiagnoseResult,
} from './diagnose';

export { autoImprove, PERFORMANCE_SIGNAL_WEIGHT } from './auto-improve';
export type {
  DiagnosisRecord,
  ItemType,
  RegenerateInput,
  RegeneratedLink,
  RegenerateFn,
  AutoImproveDeps,
  AutoImproveResult,
} from './auto-improve';
