// lib/diagnosis/diagnose.ts
//
// DIAGNOSIS — the differentiator. Given an artifact + its measured performance,
// reason from the client's LIVING insights to decide WHICH marketing LINK failed
// (hook / avatar / creative / funnel / offer / audience / none), then persist a
// `diagnoses` row (migration 030).
//
// The reasoning itself is the REAL `diagnoseFailure()` from the decision engine
// (the moat — never mocked). This module is the thin orchestration around it:
//   • load the client's ACTIVE insights via lib/intelligence (IMPORTED, not
//     re-implemented),
//   • call diagnoseFailure({ artifact, performance:{metrics}, insights }),
//   • write the diagnoses row (best-effort; graceful when 030 is absent).
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  diagnoseFailure,
  type Diagnosis,
  type DiagnosedArtifact,
  type Insight,
  type PerformanceMetrics,
} from '@/lib/decision-engine';
import { listActiveInsights } from '@/lib/intelligence/insights';
import type { NormalizedMetrics } from '@/lib/performance/ingest';

/** What `diagnoseCampaignItem` needs to reason about one ad/campaign item. */
export interface DiagnoseCampaignItemInput {
  /** The shipped artifact tags (angle/hook/sub_audience/funnel_stage/grounded_in). */
  artifact?:        (DiagnosedArtifact & { id?: string | null }) | null;
  /** The measured performance — accepts a normalized or raw-shaped metrics bag. */
  performance:      { metrics: PerformanceMetrics | NormalizedMetrics };
  clientId:         string;
  ownerUserId:      string;
  /** Explicit scope artifact id (defaults to artifact.id). */
  scopeArtifactId?: string | null;
  /** The campaign the item belongs to (stored on the diagnosis for the loop). */
  scopeCampaignId?: string | null;
}

/** A persisted `diagnoses` row (the columns this module writes/reads). */
export interface DiagnosisRow {
  id:                 string;
  client_id:          string;
  owner_user_id:      string;
  scope_artifact_id:  string | null;
  scope_campaign_id:  string | null;
  failed_link:        Diagnosis['failed_link'];
  rationale:          string;
  evidence:           Record<string, unknown>;
  target_insight_ids: string[];
  recommended_action: Record<string, unknown>;
  applied:            boolean;
  applied_item_id:    string | null;
}

export interface DiagnoseDeps {
  /** Service-role client. Optional/mockable; when absent nothing is persisted. */
  admin?:        SupabaseClient | null;
  getAdmin?:     () => SupabaseClient | null;
  /**
   * Override how the client's active insights are loaded. Defaults to
   * lib/intelligence `listActiveInsights(admin, clientId)`. Injecting this lets
   * tests feed fixture insights into the REAL diagnoseFailure without a DB.
   */
  loadInsights?: (clientId: string) => Promise<Insight[]>;
}

export interface DiagnoseResult {
  diagnosis: Diagnosis;
  /** The persisted row, or null when it couldn't be written (030 absent / no admin). */
  row:       DiagnosisRow | null;
  persisted: boolean;
  /** The active insights the diagnosis reasoned over (for the caller / loop). */
  insights:  Insight[];
}

function resolveAdmin(deps: DiagnoseDeps): SupabaseClient | null {
  if (deps.admin) return deps.admin;
  if (deps.getAdmin) {
    try { return deps.getAdmin(); } catch { return null; }
  }
  return null;
}

/**
 * Diagnose one campaign item: load the living insights, run the REAL
 * diagnoseFailure, and persist the verdict. Returns the diagnosis even when the
 * persistence step is unavailable.
 */
export async function diagnoseCampaignItem(
  input: DiagnoseCampaignItemInput,
  deps:  DiagnoseDeps = {},
): Promise<DiagnoseResult> {
  const admin = resolveAdmin(deps);

  // ── 1. Load the client's ACTIVE insights (reuse lib/intelligence) ──────────
  let insights: Insight[] = [];
  const loader =
    deps.loadInsights ??
    (admin ? (clientId: string) => listActiveInsights(admin, clientId) : null);
  if (loader) {
    try {
      insights = (await loader(input.clientId)) ?? [];
    } catch (e: any) {
      console.error('[diagnoseCampaignItem] loadInsights failed:', e?.message ?? e);
      insights = [];
    }
  }

  // ── 2. Reason — the real decision-engine diagnosis (never mocked) ──────────
  const diagnosis = diagnoseFailure({
    artifact:    input.artifact ?? undefined,
    performance: { metrics: input.performance.metrics as PerformanceMetrics },
    insights,
  });

  const scopeArtifactId = input.scopeArtifactId ?? input.artifact?.id ?? null;
  const evidence: Record<string, unknown> = {
    metrics:           input.performance.metrics,
    scope_artifact_id: scopeArtifactId,
    scope_campaign_id: input.scopeCampaignId ?? null,
  };

  // ── 3. Persist the diagnoses row (best-effort) ─────────────────────────────
  let row: DiagnosisRow | null = null;
  if (admin) {
    try {
      const { data, error } = await admin
        .from('diagnoses')
        .insert({
          client_id:          input.clientId,
          owner_user_id:      input.ownerUserId,
          scope_artifact_id:  scopeArtifactId,
          scope_campaign_id:  input.scopeCampaignId ?? null,
          failed_link:        diagnosis.failed_link,
          rationale:          diagnosis.rationale,
          evidence,
          target_insight_ids: diagnosis.target_insight_ids,
          recommended_action: diagnosis.recommended_action,
          applied:            false,
          applied_item_id:    null,
        })
        .select(
          'id, client_id, owner_user_id, scope_artifact_id, scope_campaign_id, ' +
          'failed_link, rationale, evidence, target_insight_ids, recommended_action, ' +
          'applied, applied_item_id',
        )
        .single();
      if (error) {
        console.error('[diagnoseCampaignItem] insert failed:', error.message);
      } else {
        row = data as unknown as DiagnosisRow;
      }
    } catch (e: any) {
      console.error('[diagnoseCampaignItem] insert threw:', e?.message ?? e);
    }
  }

  return { diagnosis, row, persisted: row !== null, insights };
}
