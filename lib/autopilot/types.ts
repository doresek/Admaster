// lib/autopilot/types.ts
// The autopilot step contract. Each step is a thin adapter over an EXISTING
// capability (a route or a lib fn). The judge can be inserted as a gate
// between any two steps without changing this interface (Phase 2).

import type { SupabaseClient } from '@supabase/supabase-js';

export type StepName =
  | 'generate'
  | 'score'
  | 'judge'
  | 'approval'
  | 'targeting'
  | 'launch'
  | 'insights'
  | 'recommend';

// Ordered pipeline. The gate is at 'approval' (human sign-off). resume() picks
// up at 'targeting'.
export const PIPELINE: StepName[] = [
  'generate',
  'score',
  'judge',
  'approval',
  'targeting',
  'launch',
  'insights',
];

export interface StepCtx {
  supabase: SupabaseClient;
  userId: string;
  clientId: string | null;
  journeyId: string;
  runId: string;
  baseUrl: string;        // absolute origin for internal route calls
  cookieHeader: string;   // forwarded auth cookie for internal route calls
  briefId?: string | null;
  locale: 'he' | 'en' | 'ar';
}

// ── Typed pipeline bus (H2) ──────────────────────────────────
// The accumulator threaded between steps. Each step reads upstream keys and
// writes its own — modelling them as a real interface makes a misspelled key a
// compile error instead of a silent runtime `undefined`.

/** A generated ad variant (from /api/quick-campaign). */
export interface Variant {
  post: string;
  hashtags?: string[];
  wa?: string;
  image_prompt?: string;
  framework?: string;
  // The generator may attach extra fields we pass through untouched.
  [k: string]: unknown;
}

/** A variant after scoring (/api/ai/score). */
export interface ScoredVariant extends Variant {
  score: number;
  band: string;
}

export interface PipelineAcc {
  variants?: Variant[];         // generate → score
  insightIds?: string[];        // generate → approval (atoms buildAiContext grounded on)
  scored?: ScoredVariant[];     // score
  best?: ScoredVariant;         // score → judge/approval/targeting
  judge?: unknown;              // judge → approval (verdict from lib/judge)
  approvalId?: string;          // approval → launch (+ journey patch)
  token?: string;               // approval (public approve portal)
  targeting?: unknown;          // targeting → launch
  launch?: unknown;             // launch
  launchedAdId?: string | null; // launch → insights
  insights?: unknown;           // insights
}

export interface StepResult {
  ok: boolean;
  gate?: boolean;         // true → orchestrator stops here, awaiting a human
  data?: Partial<PipelineAcc>;
  error?: string;
}

export interface RunStepRecord {
  name: StepName;
  status: 'pending' | 'running' | 'ok' | 'gate' | 'error' | 'skipped';
  at?: string;
  data?: Record<string, unknown>;
  error?: string;
}
