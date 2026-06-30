// lib/diagnosis/auto-improve.ts
//
// AUTO-IMPROVE — closes the learning loop (T5, Phase B).
//
// Given a persisted diagnosis (WHICH link failed + the target insight atoms),
// this:
//   1. regenerates ONLY the failed link, grounded in the (updated) living
//      insights — via an INJECTABLE regeneration fn (lib/master-studio in prod),
//   2. queues the result as a new `campaign_items` row with `ab_parent_id` set
//      (an A/B challenger to the original item),
//   3. emits EXACTLY ONE `learning_signal` (performance_loss / performance_win)
//      back into the brain and feeds it through the EXISTING lifecycle path —
//      lib/intelligence `applyLearningSignal` (NOT a re-implementation),
//   4. marks the diagnosis applied=true with applied_item_id.
//
// Every DB step is best-effort: when the 030 tables are absent the learning
// signal (a Phase-A `learning_signals` row) is still emitted and the atoms still
// update — the loop degrades gracefully.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FailedLink, Insight } from '@/lib/decision-engine';
import { listActiveInsights } from '@/lib/intelligence/insights';
import { applyLearningSignal } from '@/lib/intelligence/lifecycle';
import type { ClientInsight, LearningSignal } from '@/lib/intelligence/types';
import type { DiagnosisRow } from './diagnose';

/** The diagnosis fed to auto-improve — the persisted row + optional A/B context. */
export interface DiagnosisRecord extends Partial<DiagnosisRow> {
  id:                 string;
  client_id:          string;
  owner_user_id:      string;
  failed_link:        FailedLink;
  target_insight_ids: string[];
  recommended_action: Record<string, unknown>;
  scope_artifact_id?: string | null;
  scope_campaign_id?: string | null;
  /** The original campaign_item this regeneration A/B-tests against. */
  parent_item_id?:    string | null;
  /** The campaign the new item belongs to (defaults to scope_campaign_id). */
  campaign_id?:       string | null;
}

/** A campaign_items.item_type. */
export type ItemType = 'ad' | 'post' | 'adset' | 'creative' | 'message';

export interface RegenerateInput {
  failedLink:        FailedLink;
  targetInsightIds:  string[];
  recommendedAction: Record<string, unknown>;
  /** The CURRENT active insights — so regeneration is grounded in fresh knowledge. */
  insights:          Insight[];
  clientId:          string;
  ownerUserId:       string;
}

/** What the regeneration fn returns for the rebuilt link. */
export interface RegeneratedLink {
  /** A new content_artifacts id, when regeneration also recorded an artifact. */
  artifactId?:    string | null;
  itemType?:      ItemType;
  content?:       Record<string, unknown>;
  targetingSpec?: Record<string, unknown>;
  groundedIn?:    string[];
  rationale?:     string;
}

/** Injectable regeneration — wraps lib/master-studio in production. */
export type RegenerateFn = (input: RegenerateInput) => Promise<RegeneratedLink>;

/**
 * Which item_type a rebuilt link produces by default:
 *   • avatar / audience → an `adset` (re-derived targeting, no new creative)
 *   • hook / creative / offer / funnel / none → an `ad` (new copy/creative)
 */
const LINK_TO_ITEM_TYPE: Record<FailedLink, ItemType> = {
  hook:     'ad',
  creative: 'ad',
  offer:    'ad',
  funnel:   'ad',
  avatar:   'adset',
  audience: 'adset',
  none:     'ad',
};

/** Single-ad performance signals are weak until corroborated (§3 of the design). */
export const PERFORMANCE_SIGNAL_WEIGHT = 0.2;

export interface AutoImproveDeps {
  admin?:        SupabaseClient | null;
  getAdmin?:     () => SupabaseClient | null;
  /** REQUIRED: regenerate the failed link (lib/master-studio in prod). */
  regenerate:    RegenerateFn;
  /** Load the CURRENT active insights to ground regeneration + resolve targets. */
  loadInsights?: (clientId: string) => Promise<Insight[]>;
  /** The lifecycle apply path — defaults to the REAL applyLearningSignal. */
  applySignal?:  typeof applyLearningSignal;
  /** Override the performance-signal weight. */
  signalWeight?: number;
}

export interface AutoImproveResult {
  /** The queued A/B challenger campaign_items id (null if it couldn't be written). */
  newItemId:   string | null;
  /** The emitted learning_signals id (null if it couldn't be written). */
  signalId:    string | null;
  /** The signal's polarity. */
  polarity:    'positive' | 'negative';
  /** How many target insight atoms the signal was applied to. */
  appliedToInsights: number;
  /** Whether the diagnosis was marked applied. */
  diagnosisApplied:  boolean;
  regenerated: RegeneratedLink;
}

function resolveAdmin(deps: AutoImproveDeps): SupabaseClient | null {
  if (deps.admin) return deps.admin;
  if (deps.getAdmin) {
    try { return deps.getAdmin(); } catch { return null; }
  }
  return null;
}

/** Best-effort lookup of the original campaign_item to A/B against. */
async function resolveParentItemId(
  admin:           SupabaseClient,
  scopeArtifactId: string | null | undefined,
): Promise<{ itemId: string | null; campaignId: string | null }> {
  if (!scopeArtifactId) return { itemId: null, campaignId: null };
  try {
    const { data, error } = await admin
      .from('campaign_items')
      .select('id, campaign_id')
      .eq('artifact_id', scopeArtifactId)
      .maybeSingle();
    if (error || !data) return { itemId: null, campaignId: null };
    const r = data as { id: string; campaign_id: string | null };
    return { itemId: r.id, campaignId: r.campaign_id ?? null };
  } catch {
    return { itemId: null, campaignId: null };
  }
}

/**
 * Auto-improve the failed link diagnosed for an item. See file header for the
 * four steps. Returns what was created/emitted; never throws on a DB failure.
 */
export async function autoImprove(
  diagnosis: DiagnosisRecord,
  deps:      AutoImproveDeps,
): Promise<AutoImproveResult> {
  const admin = resolveAdmin(deps);
  const applySignal = deps.applySignal ?? applyLearningSignal;
  const weight = deps.signalWeight ?? PERFORMANCE_SIGNAL_WEIGHT;

  // ── 1. Load CURRENT insights to ground regeneration + resolve target atoms ──
  let insights: Insight[] = [];
  const loader =
    deps.loadInsights ??
    (admin ? (clientId: string) => listActiveInsights(admin, clientId) : null);
  if (loader) {
    try {
      insights = (await loader(diagnosis.client_id)) ?? [];
    } catch (e: any) {
      console.error('[autoImprove] loadInsights failed:', e?.message ?? e);
    }
  }

  // ── 2. Regenerate ONLY the failed link, grounded in the updated knowledge ───
  const regenerated = await deps.regenerate({
    failedLink:        diagnosis.failed_link,
    targetInsightIds:  diagnosis.target_insight_ids ?? [],
    recommendedAction: diagnosis.recommended_action ?? {},
    insights,
    clientId:          diagnosis.client_id,
    ownerUserId:       diagnosis.owner_user_id,
  });

  // ── 3. Resolve the A/B parent + campaign, then queue the challenger item ────
  let parentItemId = diagnosis.parent_item_id ?? null;
  let campaignId   = diagnosis.campaign_id ?? diagnosis.scope_campaign_id ?? null;
  if (admin && (!parentItemId || !campaignId)) {
    const resolved = await resolveParentItemId(admin, diagnosis.scope_artifact_id);
    parentItemId ??= resolved.itemId;
    campaignId   ??= resolved.campaignId;
  }

  const itemType = regenerated.itemType ?? LINK_TO_ITEM_TYPE[diagnosis.failed_link];
  const groundedIn = regenerated.groundedIn ?? diagnosis.target_insight_ids ?? [];

  let newItemId: string | null = null;
  if (admin) {
    try {
      const { data, error } = await admin
        .from('campaign_items')
        .insert({
          campaign_id:    campaignId,
          client_id:      diagnosis.client_id,
          owner_user_id:  diagnosis.owner_user_id,
          artifact_id:    regenerated.artifactId ?? null,
          item_type:      itemType,
          status:         'draft',
          targeting_spec: regenerated.targetingSpec ?? {},
          ab_parent_id:   parentItemId,
          grounded_in:    groundedIn,
          rationale:
            regenerated.rationale ??
            `auto-improve: regenerated ${diagnosis.failed_link} link`,
        })
        .select('id')
        .single();
      if (error) console.error('[autoImprove] campaign_items insert failed:', error.message);
      else newItemId = (data as { id: string }).id;
    } catch (e: any) {
      console.error('[autoImprove] campaign_items insert threw:', e?.message ?? e);
    }
  }

  // ── 4. Emit EXACTLY ONE learning_signal back into the brain ────────────────
  // A diagnosed failure is a performance LOSS → negative signal (weakens the
  // atoms the failed artifact was grounded on). A clean bill ('none') is a win.
  const polarity: 'positive' | 'negative' =
    diagnosis.failed_link === 'none' ? 'positive' : 'negative';
  const signalType = polarity === 'positive' ? 'performance_win' : 'performance_loss';
  const targetIds = diagnosis.target_insight_ids ?? [];

  let signalId: string | null = null;
  if (admin) {
    try {
      const { data, error } = await admin
        .from('learning_signals')
        .insert({
          client_id:     diagnosis.client_id,
          owner_user_id: diagnosis.owner_user_id,
          artifact_id:   diagnosis.scope_artifact_id ?? null,
          insight_id:    targetIds[0] ?? null,
          signal_type:   signalType,
          polarity,
          weight,
          detail:        `auto-improve(${diagnosis.failed_link}) from diagnosis ${diagnosis.id}`,
          processed:     false,
        })
        .select('id')
        .single();
      if (error) console.error('[autoImprove] learning_signals insert failed:', error.message);
      else signalId = (data as { id: string }).id;
    } catch (e: any) {
      console.error('[autoImprove] learning_signals insert threw:', e?.message ?? e);
    }
  }

  // Feed the signal through the EXISTING lifecycle engine for each target atom.
  let appliedToInsights = 0;
  if (admin && targetIds.length) {
    const targets: ClientInsight[] = insights.filter((i) => targetIds.includes(i.id)) as ClientInsight[];
    const signal: LearningSignal = {
      polarity,
      weight,
      signalId: signalId ?? undefined,
      reason:   `auto-improve(${diagnosis.failed_link})`,
    };
    for (const target of targets) {
      try {
        await applySignal(admin, target, signal);
        appliedToInsights++;
      } catch (e: any) {
        console.error('[autoImprove] applyLearningSignal failed:', e?.message ?? e);
      }
    }
    if (signalId) {
      try {
        await admin.from('learning_signals').update({ processed: true }).eq('id', signalId);
      } catch { /* best-effort */ }
    }
  }

  // ── 5. Mark the diagnosis applied ──────────────────────────────────────────
  let diagnosisApplied = false;
  if (admin) {
    try {
      const { error } = await admin
        .from('diagnoses')
        .update({ applied: true, applied_item_id: newItemId })
        .eq('id', diagnosis.id);
      if (error) console.error('[autoImprove] diagnoses update failed:', error.message);
      else diagnosisApplied = true;
    } catch (e: any) {
      console.error('[autoImprove] diagnoses update threw:', e?.message ?? e);
    }
  }

  return {
    newItemId,
    signalId,
    polarity,
    appliedToInsights,
    diagnosisApplied,
    regenerated,
  };
}
