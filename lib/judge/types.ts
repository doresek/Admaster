// lib/judge/types.ts
// System-wide LLM-judge seam. Phase 1 ships a minimal single-call judge;
// Phase 2 deepens the internals (multi-agent fan-out) WITHOUT changing this
// contract or the journey_events shape it writes to.

export type JudgeDimension = 'operational' | 'managerial' | 'practical' | 'design';

export const JUDGE_DIMENSIONS: JudgeDimension[] = [
  'operational',
  'managerial',
  'practical',
  'design',
];

export const DIMENSION_LABEL_HE: Record<JudgeDimension, string> = {
  operational: 'תפעולי',
  managerial:  'ניהולי',
  practical:   'ביצועי',
  design:      'עיצובי',
};

// What is being judged. Kept generic so any artifact (ad copy, a campaign
// plan, a targeting spec, a whole client journey step) can be evaluated.
export interface JudgeArtifact {
  kind: 'ad_copy' | 'campaign' | 'targeting' | 'journey_step';
  copy?: string;                 // the ad/post text, when kind === 'ad_copy'
  summary?: string;              // a human-readable summary of non-text artifacts
  meta?: Record<string, unknown>; // structured payload (targeting spec, metrics, etc.)
}

export interface JudgeVerdict {
  scores: Record<JudgeDimension, number>; // 0-100 per dimension
  overall: number;                         // 0-100 (min-weighted, see index.ts)
  verdict: 'approve' | 'revise' | 'reject';
  rationale: string;                       // one short Hebrew paragraph
  flags: string[];                         // concrete issues / "will waste money" warnings
}

export interface JudgeInput {
  artifact: JudgeArtifact;
  dimensions?: JudgeDimension[];   // defaults to all four
  locale?: 'he' | 'en' | 'ar';
  userId: string;
  clientId?: string | null;
  briefId?: string | null;
  // Optional: a practical/performance score already computed elsewhere
  // (0-100). When provided it seeds the `practical` dimension instead of
  // re-asking the model — reuse over recompute.
  practicalScore?: number;
}
