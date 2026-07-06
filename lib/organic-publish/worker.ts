// lib/organic-publish/worker.ts
//
// P1-4 — the organic publishing worker (ORGANIC-TASKS). This is the Meta
// App-Review demo flow (G0-4): schedule slot → autonomy route → lib/meta-publish
// (DRY-RUN) → slot + campaign-item status updates. It must run end-to-end in
// dry-run TODAY and flip to live later with ZERO structural change — every
// live-only concern (token, LIVE_PUBLISH_ENABLED, Meta-native scheduling) is
// already positioned, gated, and commented at its flip point.
//
// Safety rules, in order:
//   • NEVER auto-live: `live` defaults false; even `live: true` is refused
//     outright unless LIVE_PUBLISH_ENABLED === 'true' (same gate as paid, T9).
//   • EVERY slot routes through routeAndLog('publish_organic') — a no-money
//     kind: executes in propose_approve / act_within_caps, proposes in
//     draft_only, and a slot with no grounding/rationale is BLOCKED by the
//     policy (malformed actions never act). The verdict is respected verbatim.
//   • IDEMPOTENCY: only 'planned' rows are picked; before publishing, the slot
//     is CLAIMED (conditional planned→'publishing' update). A lost claim means
//     another worker holds it — we skip, never double-post.
//   • Per-slot failure isolation: one bad slot fails alone; the batch continues.
//   • A status-update failure AFTER a publish is logged LOUDLY and the post is
//     NEVER retried — the claim already moved the row out of 'planned', so no
//     future run can re-pick it.

import { MetaPublishClient, publishPagePhoto, publishPagePost } from '@/lib/meta-publish';
import { META_GRAPH_VERSION } from '@/lib/meta-config';
import { isLivePublishEnabled, LIVE_PUBLISH_FLAG } from '@/lib/campaigns/publish';
import type { CampaignStore } from '@/lib/campaigns/store';
import type { RouteAndLogInput, RouteAndLogResult } from '@/lib/autonomy';
import type {
  OrganicSlot,
  PublishDueSlotsResult,
  SlotResult,
  SlotStore,
} from './types';

// ── constants ─────────────────────────────────────────────────────────────────

/** Default look-ahead: slots due within the next 15 minutes are picked up. */
export const DEFAULT_DUE_WINDOW_MS = 15 * 60_000;

/**
 * Dry-run page placeholder for slots whose page_id is still null (the calendar
 * writes slots before publish wiring). In DRY-RUN the id is never sent
 * anywhere; at live-flip a real page_id must be on the slot (or resolved via
 * the injectable resolvePageId) or the slot fails cleanly.
 */
export const DRY_RUN_PAGE_ID = 'dryrun_page';

// ── params + deps (all side effects injectable) ───────────────────────────────

export interface PublishDueSlotsParams {
  ownerUserId: string;
  /** Restrict the batch to one client's due slots. */
  clientId?: string;
  /** Publish exactly this slot (must still be 'planned'); ignores the due window. */
  slotId?: string;
  /** Injectable clock — defaults to the real one. */
  now?: Date;
  /** Due look-ahead in ms; default DEFAULT_DUE_WINDOW_MS. */
  windowMs?: number;
  /**
   * Default false → DRY-RUN (no token, no network, synthetic dryrun_* ids).
   * true requests the gated live path: refused unless LIVE_PUBLISH_ENABLED
   * === 'true', and each slot additionally needs a resolved Meta token.
   */
  live?: boolean;
}

export interface PublishDueSlotsDeps {
  /** REQUIRED: the slot persistence seam (supabaseSlotStore / inMemorySlotStore). */
  slotStore: SlotStore;
  /**
   * REQUIRED: the autonomy gate — routeAndLog bound to a Supabase client in
   * prod (`(input) => routeAndLog(admin, input)`), a policy-backed stub in
   * tests. Required (not defaulted) so no caller can forget the audit trail.
   */
  route: (input: RouteAndLogInput) => Promise<RouteAndLogResult>;
  /** Meta client factory (injected in tests). Default: real MetaPublishClient. */
  makePublishClient?: (opts: { accessToken: string; dryRun: boolean }) => MetaPublishClient;
  /**
   * Resolve the client's decrypted Meta token — used ONLY when live===true
   * (wire getDecryptedMetaToken here at the G0-6 flip). Dry-run never calls it.
   */
  getToken?: (clientId: string, ownerUserId: string) => Promise<string | null>;
  /** Optional campaign-item reflection; called with `?.` (partial stores OK). */
  campaignStore?: Pick<CampaignStore, 'updateItemStatus'>;
  /** Optional page-id fallback for slots with page_id null (live path). */
  resolvePageId?: (slot: OrganicSlot) => Promise<string | null>;
}

// ── the worker ────────────────────────────────────────────────────────────────

/**
 * Publish the owner's due organic slots (or one explicit slot). Returns a
 * per-slot outcome list; the batch itself never throws on a bad slot.
 */
export async function publishDueSlots(
  params: PublishDueSlotsParams,
  deps: PublishDueSlotsDeps,
): Promise<PublishDueSlotsResult> {
  const now = params.now ?? new Date();
  const wantLive = params.live === true;

  // ── NEVER auto-live: the explicit env gate, checked before touching any slot. ──
  if (wantLive && !isLivePublishEnabled()) {
    return {
      live: false,
      dryRun: true,
      refused: true,
      message: `Live publish refused: ${LIVE_PUBLISH_FLAG} is not "true". No slots were touched.`,
      results: [],
    };
  }
  const live = wantLive;
  const dryRun = !live;

  // ── load the work ──────────────────────────────────────────────────────────
  let slots: OrganicSlot[];
  if (params.slotId) {
    const one = await deps.slotStore.getSlot(params.slotId, params.ownerUserId);
    slots = one ? [one] : [];
    if (!one) {
      return {
        live, dryRun, refused: false,
        message: `Slot ${params.slotId} not found for this owner.`,
        results: [{ slotId: params.slotId, outcome: 'skipped', reason: 'slot not found (or not owned by this user)' }],
      };
    }
  } else {
    const dueBefore = new Date(now.getTime() + (params.windowMs ?? DEFAULT_DUE_WINDOW_MS));
    slots = await deps.slotStore.listDue({
      ownerUserId: params.ownerUserId,
      clientId: params.clientId,
      dueBeforeIso: dueBefore.toISOString(),
    });
  }

  // Token cache: one resolution per client per run (live only).
  const tokenCache = new Map<string, string | null>();

  const results: SlotResult[] = [];
  for (const slot of slots) {
    // Per-slot isolation: publishOneSlot handles its own errors; a truly
    // unexpected throw still only fails this slot, never the batch.
    try {
      results.push(await publishOneSlot(slot, params.ownerUserId, now, live, deps, tokenCache));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[organic-publish] slot ${slot.id} failed unexpectedly:`, msg);
      await deps.slotStore.updateSlot(slot.id, { status: 'failed' });
      results.push({ slotId: slot.id, outcome: 'failed', reason: msg });
    }
  }

  const published = results.filter((r) => r.outcome === 'published' || r.outcome === 'scheduled').length;
  return {
    live,
    dryRun,
    refused: false,
    message: dryRun
      ? `Dry-run: ${published}/${results.length} slot(s) published with synthetic ids — zero network, zero live posts.`
      : `Live: ${published}/${results.length} slot(s) published to Meta.`,
    results,
  };
}

// ── one slot ──────────────────────────────────────────────────────────────────

async function publishOneSlot(
  slot: OrganicSlot,
  ownerUserId: string,
  now: Date,
  live: boolean,
  deps: PublishDueSlotsDeps,
  tokenCache: Map<string, string | null>,
): Promise<SlotResult> {
  const dryRun = !live;

  // Idempotency precondition: only 'planned' rows are actionable. A
  // 'publishing' row is a live claim (possibly a crashed worker's — a human
  // resolves those, the worker NEVER re-publishes them).
  if (slot.status !== 'planned') {
    return {
      slotId: slot.id,
      outcome: 'skipped',
      reason: `slot is '${slot.status}' — only 'planned' slots publish (idempotency claim)`,
    };
  }

  // Content gate: P1-3 attaches the message; a message-less slot is plan-only.
  if (!slot.message || slot.message.trim() === '') {
    return {
      slotId: slot.id,
      outcome: 'skipped',
      reason: 'no message attached yet (P1-3 content generation pending) — slot left planned',
    };
  }

  // ── the autonomy gate — every publish routes + audits, no exceptions. The
  // slot's own grounding passes through UNTOUCHED: a slot with no grounded_in
  // or no rationale is malformed by policy and BLOCKS (never acts). ──────────
  const { route } = await deps.route({
    clientId: slot.client_id,
    ownerUserId,
    action: {
      kind: 'publish_organic',
      ref: slot.id,
      rationale: (slot.rationale ?? '') as string,
      grounded_in: slot.grounded_in as string[], // pass through as-is; policy validates
    },
    spendContext: { todaySpendIls: 0, monthSpendIls: 0 }, // organic moves no money
  });

  if (route.route === 'propose') {
    // Owner approval pending — the slot stays 'planned' and untouched; the
    // approval flow re-runs this worker (or the owner publishes manually).
    return { slotId: slot.id, outcome: 'proposed', reason: route.reason };
  }
  if (route.route === 'block') {
    await deps.slotStore.updateSlot(slot.id, { status: 'failed' });
    return { slotId: slot.id, outcome: 'blocked', reason: route.reason };
  }

  // Verdict: execute. Resolve live-only preconditions BEFORE claiming, so a
  // missing token/page never burns the claim.
  let token = 'dry-run'; // placeholder for dry-run clients — never sent anywhere
  if (live) {
    if (!tokenCache.has(slot.client_id)) {
      tokenCache.set(slot.client_id, (await deps.getToken?.(slot.client_id, ownerUserId)) ?? null);
    }
    const resolved = tokenCache.get(slot.client_id) ?? null;
    if (!resolved) {
      await deps.slotStore.updateSlot(slot.id, { status: 'failed' });
      return { slotId: slot.id, outcome: 'failed', reason: 'live publish: no Meta token resolved for this client' };
    }
    token = resolved;
  }

  const pageId =
    slot.page_id ??
    (await deps.resolvePageId?.(slot)) ??
    (dryRun ? DRY_RUN_PAGE_ID : null);
  if (!pageId) {
    await deps.slotStore.updateSlot(slot.id, { status: 'failed' });
    return { slotId: slot.id, outcome: 'failed', reason: 'live publish: no page_id on the slot and none resolvable' };
  }

  // ── the claim: planned → publishing, atomically. Lost claim = someone else
  // is publishing this exact slot right now — never double-post. ─────────────
  const claimed = await deps.slotStore.claimSlot(slot.id);
  if (!claimed) {
    return { slotId: slot.id, outcome: 'skipped', reason: 'claim lost — another worker holds this slot' };
  }

  const makeClient =
    deps.makePublishClient ??
    ((o: { accessToken: string; dryRun: boolean }) =>
      new MetaPublishClient({ ...o, graphVersion: META_GRAPH_VERSION }));
  const client = makeClient({ accessToken: token, dryRun });

  // Future-dated (within the due window) ⇒ record a scheduling INTENT, not a
  // publication: slot status 'scheduled', no published_at.
  const isFuture = Date.parse(slot.scheduled_at) > now.getTime();

  try {
    let postId: string;
    if (slot.post_kind === 'photo') {
      // publishPagePhoto throws on a missing imageUrl — caught below → 'failed'.
      const res = await publishPagePhoto(client, {
        pageId,
        message: slot.message,
        imageUrl: slot.image_url ?? '',
      });
      postId = res.post_id ?? res.id;
    } else {
      // LIVE-FLIP NOTE (G0-6): Meta-native future scheduling goes RIGHT HERE —
      // for a future-dated slot the live payload must add
      //   { published: false, scheduled_publish_time: <unix(slot.scheduled_at)> }
      // which means extending PublishPagePostParams in lib/meta-publish (not
      // this module's to edit). Until then, dry-run records the intent below
      // (status 'scheduled' + the client's synthetic id).
      const res = await publishPagePost(client, {
        pageId,
        message: slot.message,
        link: slot.post_kind === 'link' ? slot.link_url ?? undefined : undefined,
      });
      postId = res.id;
    }

    const finalStatus = isFuture ? ('scheduled' as const) : ('published' as const);
    const updated = await deps.slotStore.updateSlot(slot.id, {
      status: finalStatus,
      meta_post_id: postId,
      ...(isFuture ? {} : { published_at: now.toISOString() }),
    });
    if (!updated) {
      // LOUD, deliberate: the post EXISTS (dry-run: as a recorded intent) but
      // the row write-back failed. The claim already moved the row out of
      // 'planned', so no run will ever re-publish it — a human reconciles.
      console.error(
        `[organic-publish] LOUD: slot ${slot.id} published (post ${postId}) but the slot update FAILED — ` +
          `row is claimed ('publishing'), it will NOT be re-published; reconcile manually.`,
      );
    }

    // Reflect on the campaign item (optional method, optional store — `?.`).
    if (slot.campaign_item_id) {
      await deps.campaignStore?.updateItemStatus?.(slot.campaign_item_id, finalStatus);
    }

    return {
      slotId: slot.id,
      outcome: finalStatus,
      metaPostId: postId,
      reason: updated
        ? isFuture
          ? `intent recorded for ${slot.scheduled_at} (${dryRun ? 'dry-run' : 'live'})`
          : `published (${dryRun ? 'dry-run — synthetic id, zero network' : 'live'})`
        : `published (post ${postId}) but the slot update failed — see server log, do not re-publish`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await deps.slotStore.updateSlot(slot.id, { status: 'failed' });
    return { slotId: slot.id, outcome: 'failed', reason: msg };
  }
}
