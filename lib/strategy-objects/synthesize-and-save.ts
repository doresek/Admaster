// lib/strategy-objects/synthesize-and-save.ts
//
// Composition: living atoms → pure synthesis → diff vs the persisted latest →
// version save (or an explicit skip). The ONLY file in this module that
// composes I/O with the pure engine, mirroring the split in lib/hypotheses
// (core = pure, resolve-and-learn = composition).
//
// No-churn discipline: re-synthesis is triggered on atom drift (or manually),
// but atoms can move WITHOUT changing the projection (e.g. a confidence bump
// that reorders nothing). Persisting an identical projection as a new version
// would be noise in the changelog and would defeat "version = the strategy
// actually changed" — so an identical projection returns {skipped: true}.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageArchitectureRow } from '@/lib/capability-contracts';
import { listActiveInsights } from '@/lib/intelligence/insights';
import { diffArchitectures, synthesizeArchitecture } from './architecture';
import { getLatestArchitecture, saveArchitecture } from './store';
import type { ArchitectureDiff } from './types';

export interface SynthesizeAndSaveResult {
  skipped: boolean;
  /** Present when skipped — why no new version was written. */
  reason?: string;
  /** The saved row (fresh version) or the still-current latest (skipped). */
  architecture: MessageArchitectureRow;
  /** Diff vs the previous latest; null when this is version 1. */
  diff: ArchitectureDiff | null;
  warnings: string[];
}

/**
 * Synthesize the client's message architecture from its active atoms and
 * persist it as the next version — unless the projection is identical to the
 * current latest, in which case the save is skipped (no version churn).
 *
 * `trigger` is recorded in synth_meta ('manual' | 'atom_drift' | 'brief' | ...)
 * so every version answers "why did this exist".
 */
export async function synthesizeAndSave(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  trigger:     string,
): Promise<SynthesizeAndSaveResult> {
  const insights = await listActiveInsights(supabase, clientId);
  const { architecture, warnings } = synthesizeArchitecture({ insights }, trigger);

  const latest = await getLatestArchitecture(supabase, clientId, ownerUserId);
  if (latest) {
    const diff = diffArchitectures(latest, architecture);
    if (diff.identical) {
      return {
        skipped: true,
        reason:  `projection identical to version ${latest.version} — no version churn`,
        architecture: latest,
        diff,
        warnings,
      };
    }
    const saved = await saveArchitecture(supabase, { clientId, ownerUserId, draft: architecture });
    return { skipped: false, architecture: saved, diff, warnings };
  }

  const saved = await saveArchitecture(supabase, { clientId, ownerUserId, draft: architecture });
  return { skipped: false, architecture: saved, diff: null, warnings };
}
