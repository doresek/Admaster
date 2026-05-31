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

export interface StepResult {
  ok: boolean;
  gate?: boolean;         // true → orchestrator stops here, awaiting a human
  data?: Record<string, unknown>;
  error?: string;
}

export interface RunStepRecord {
  name: StepName;
  status: 'pending' | 'running' | 'ok' | 'gate' | 'error' | 'skipped';
  at?: string;
  data?: Record<string, unknown>;
  error?: string;
}
