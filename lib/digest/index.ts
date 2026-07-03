// lib/digest — the weekly/monthly digest composer (VISION-DEEP §1.3).
//
// DETERMINISTIC, LLM-free: the digest is composed by selecting, ordering and
// templating RECORDED rows (campaign_decisions / diagnoses / hypotheses /
// content_performance / atom states) — "the report is the audit trail,
// narrated". Public surface:

export { composeDigest, renderHebrew } from './compose';
export { loadDigestInputs } from './load';
export type { LoadDigestParams, LoadDigestResult } from './load';
export {
  DIGEST_COLUMNS,
  approveDigest,
  getDigest,
  listDigests,
  saveDigest,
} from './store';
export type {
  ApproveDigestResult,
  ListDigestsFilters,
  SaveDigestInput,
  SaveDigestResult,
} from './store';
export { composeAndSave } from './compose-and-save';
export type { ComposeAndSaveParams, ComposeAndSaveResult } from './compose-and-save';
export type {
  ApprovalRequest,
  ComposeResult,
  DigestContent,
  DigestDiagnosisRow,
  DigestFailedLink,
  DigestInputs,
  DigestItemRef,
  DigestPerformanceRow,
  DigestPeriod,
  DigestSections,
  DigestStats,
  GroundingCitation,
  LearnedDiagnosis,
  LearnedHypothesis,
  NextHypothesis,
  NextPrecedent,
  PerformanceVerdict,
  ResolvedHypothesisStatus,
  ResultEntry,
  ResultItem,
  WhatRanDecision,
  WhatRanItem,
} from './types';
