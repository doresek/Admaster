// lib/strategy-objects — C-10 messaging architecture + funnel-as-object.
//
// Public surface of the capability (the orchestrator wires integrations
// through here, never through private files):
//   • synthesizeArchitecture / diffArchitectures — pure projection (skill §2)
//   • designFunnel / funnelHealth               — pure funnel object (skill §4)
//   • store                                     — versioned persistence + coverage
//   • synthesizeAndSave                         — the composed entrypoint

export * from './types';
export {
  synthesizeArchitecture,
  diffArchitectures,
  clusterByContent,
  titleFrom,
  PILLAR_KEYS,
} from './architecture';
export {
  designFunnel,
  funnelHealth,
  resolveAwareness,
  DEFAULT_PRIORS,
  MIN_EDGE_N,
  type AwarenessKey,
} from './funnel';
export {
  saveArchitecture,
  getLatestArchitecture,
  listArchitectureVersions,
  saveFunnel,
  getFunnel,
  listFunnels,
  updateFunnelStatus,
  coverageReport,
  type SaveArchitectureInput,
  type SaveFunnelInput,
  type ArchitectureVersionSummary,
} from './store';
export { synthesizeAndSave, type SynthesizeAndSaveResult } from './synthesize-and-save';
