// lib/organic-posts/generate.ts
//
// P1-3 — the organic post generator: one calendar-plan slot in, one full
// Facebook post + image prompt out, linted (C-07, flag-only), artifact-recorded
// (best-effort), written as a campaign_items(item_type='post') row and attached
// back onto its organic_schedule slot.
//
// This module is a THIN composition over existing contracts:
//   • generation — lib/master-studio's best-of-N pipeline, the brief composed
//     FROM the slot (topic + angle + post_type, Hebrew);
//   • lint       — lib/brand-lint's deterministic lintArtifact (never blocks);
//   • artifact   — lib/intelligence recordArtifactSafe (null-tolerant);
//   • item row   — CampaignStore.insertItem (best-effort, null-tolerant);
//   • schedule   — the SlotWriter seam (writer.ts).
//
// Failure doctrine: nothing is half-written. The campaign_item is inserted ONLY
// after a successful pipeline run; a pipeline failure returns {ok:false,reason}
// with ZERO writes. Recording failures after a successful generation degrade
// gracefully (null ids / attached:false) — a good post is never thrown away
// because a bookkeeping insert failed.

import { runMasterPipeline } from '@/lib/master-studio/pipeline';
import { deriveFunnelStage, type MasterStudioInput } from '@/lib/master-studio';
import { lintArtifact } from '@/lib/brand-lint';
import { recordArtifactSafe } from '@/lib/intelligence/artifacts';
import type { PlanPostType, PlanSlot } from '@/lib/organic-calendar/types';
import type {
  GenerateForPlanParams,
  GenerateForPlanResult,
  GenerateOrganicPostParams,
  OrganicPostResult,
} from './types';

// ── brief composition ──────────────────────────────────────────────────────────

/**
 * Per-post-type editorial instruction (Hebrew). The `label` doubles as the
 * MasterStudioInput `type`, so deriveFunnelStage maps it correctly ('הצעה/מבצע'
 * contains 'מבצע' ⇒ BOFU; the rest are organic trust-ladder content ⇒ TOFU).
 */
const POST_TYPE_BRIEF: Record<PlanPostType, { label: string; instruction: string }> = {
  tip: {
    label: 'טיפ מקצועי',
    instruction:
      'כתוב פוסט ערך אורגני לפייסבוק: טיפ מעשי אחד, קונקרטי, שאפשר ליישם מיד. בלי מכירה — הערך עצמו הוא ההוק.',
  },
  story: {
    label: 'סיפור',
    instruction:
      'כתוב פוסט סיפורי אורגני לפייסבוק: רגע אמיתי מהעסק או מלקוח, אנושי ואותנטי. בלי מכירה ישירה — הסיפור בונה אמון.',
  },
  offer: {
    label: 'הצעה/מבצע',
    instruction:
      'כתוב פוסט הצעה אורגני לפייסבוק: הצעה אחת ברורה, סיבה טובה לעכשיו, וקריאה לפעולה אחת פשוטה.',
  },
  engagement: {
    label: 'פוסט מעורבות',
    instruction:
      'כתוב פוסט מעורבות אורגני לפייסבוק: שאלה פתוחה אחת שמזמינה את הקהל לענות בתגובות. בלי מכירה.',
  },
  holiday: {
    label: 'פוסט חג',
    instruction:
      'כתוב פוסט חג אורגני לפייסבוק: ברכה חמה סביב החג שבנושא, מחוברת באופן טבעי לעסק. שם החג חייב להופיע בפוסט.',
  },
};

/**
 * Compose the master-studio brief FROM a plan slot. Deterministic — same slot,
 * same brief. The slot's topic carries the specifics (for 'holiday' slots the
 * planner puts the holiday name in the topic, so it always reaches the brief).
 */
export function composeSlotBrief(slot: PlanSlot): string {
  const { label, instruction } = POST_TYPE_BRIEF[slot.post_type];
  return [
    `סוג פוסט: ${label}`,
    `נושא: ${slot.topic}`,
    `זווית: ${slot.angle}`,
    '',
    instruction,
    '',
    `למה עכשיו (מבוסס תובנות): ${slot.rationale}`,
  ].join('\n');
}

/** The full pipeline input for a slot (exported for callers that add context). */
export function slotToStudioInput(slot: PlanSlot): MasterStudioInput {
  return {
    brief: composeSlotBrief(slot),
    platform: 'Facebook',
    locale: 'he',
    type: POST_TYPE_BRIEF[slot.post_type].label,
    hook: slot.angle,
  };
}

// ── single-slot generation ─────────────────────────────────────────────────────

/**
 * Generate one organic post for one plan slot. See module header for the
 * write-ordering doctrine (pipeline first, writes only on success).
 */
export async function generateOrganicPost(
  params: GenerateOrganicPostParams,
): Promise<OrganicPostResult> {
  const { slot, slotId, clientId, ownerUserId, campaignId, run, store, slotWriter } = params;

  // 1. Generate — the only step allowed to fail the whole call.
  const result = await runMasterPipeline(slotToStudioInput(slot), run);
  if (!result.ok) {
    return { ok: false, reason: `master-studio pipeline failed: ${result.reason}` };
  }
  const out = result.output;
  const draft = out.winner.draft;

  // 2. Lint (C-07) — deterministic, total, advisory. NEVER blocks: the verdict
  //    is stamped into the result + artifact; the publish gate reads it later.
  const lint = await lintArtifact(draft.post, params.brandAtoms ?? []);

  // 3. Artifact — best-effort, null-tolerant (recordArtifactSafe never throws).
  const funnelStage = deriveFunnelStage(POST_TYPE_BRIEF[slot.post_type].label);
  const artifact = params.admin
    ? await recordArtifactSafe(params.admin, {
        clientId,
        ownerUserId,
        type: 'post',
        content: {
          post: draft.post,
          hashtags: draft.hashtags,
          // `image` is the generation PROMPT (the image itself is a later step).
          image: draft.image,
          marketer: out.winner.marketer,
          score: out.winner.score,
        },
        angle: slot.angle,
        funnelStage,
        avatarRef: (out.avatar as Record<string, unknown> | null) ?? null,
        insightIds: slot.grounded_in,
        generatedFrom: {
          source: 'organic-posts',
          post_type: slot.post_type,
          slot_date: slot.date,
          // C-07 stamp: the lint verdict travels with the artifact.
          lint: {
            score: lint.score,
            passed: lint.passed,
            violations: lint.violations.map((v) => ({
              rule: v.rule,
              severity: v.severity,
              message: v.message,
            })),
          },
        },
      })
    : null;

  // 4. Item row — the post joins the ONE decision trace under the calendar's
  //    campaign. Best-effort: a null insert degrades (no attach) but the
  //    generated post is still returned.
  const item = await store.insertItem({
    campaign_id: campaignId,
    client_id: clientId,
    owner_user_id: ownerUserId,
    artifact_id: artifact?.id ?? null,
    item_type: 'post',
    status: 'assembled',
    meta_object_id: null,
    targeting_spec: {},
    grounded_in: slot.grounded_in,
    rationale: slot.rationale,
  });

  // 5. Attach to the schedule slot — needs both a slot id and a real item id
  //    (organic_schedule.campaign_item_id FKs campaign_items).
  let attached = false;
  if (item && slotId) {
    attached = await slotWriter.attachToSlot(slotId, {
      campaign_item_id: item.id,
      message: draft.post,
      image_prompt: draft.image,
    });
  }

  return {
    ok: true,
    post: draft.post,
    imagePrompt: draft.image,
    hashtags: draft.hashtags,
    lint,
    itemId: item?.id ?? null,
    artifactId: artifact?.id ?? null,
    attached,
  };
}

// ── whole-plan generation ──────────────────────────────────────────────────────

/**
 * Generate posts for every slot of a plan — SEQUENTIALLY (rate-limit
 * friendliness: each slot is itself a multi-call best-of-N pipeline), and
 * resilient: one slot's failure (pipeline partial OR an unexpected throw) is
 * recorded as its {ok:false} result and the loop continues to the next slot.
 */
export async function generateForPlan(
  params: GenerateForPlanParams,
): Promise<GenerateForPlanResult> {
  const { slots, ...rest } = params;
  const results: GenerateForPlanResult['results'] = [];
  let generated = 0;
  let failed = 0;

  for (const ref of slots) {
    let result: OrganicPostResult;
    try {
      result = await generateOrganicPost({ ...rest, slot: ref.slot, slotId: ref.slotId ?? null });
    } catch (e) {
      // Defensive: the deps are all null-tolerant by contract, but a misbehaving
      // injected seam must not kill the remaining slots.
      result = { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    if (result.ok) generated += 1;
    else failed += 1;
    results.push({ slot: ref.slot, result });
  }

  return { results, generated, failed };
}
