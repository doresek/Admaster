// lib/campaigns/publish.ts
//
// T9 — the LIVE publish path (organic + paid), FULLY BUILT but DISABLED by
// default. When Meta creds land, going live is a flag flip; nothing here is a
// half-built stub. Two hard, non-negotiable safety rules are enforced in code:
//
//   (1) PAID OBJECTS ARE ALWAYS CREATED **PAUSED**. This module never sets a
//       campaign / ad set / ad to ACTIVE and therefore never spends. Unpausing
//       is a separate, deliberate human action (the MONEY gate) that lives
//       nowhere in this file.
//   (2) THE LIVE PATH ONLY RUNS when BOTH are true: the explicit environment
//       flag `LIVE_PUBLISH_ENABLED === 'true'` AND a Meta token is resolved for
//       the client. If either is missing the call is REFUSED with a clear,
//       inspectable result — never a silent no-op, never a partial publish.
//
// A third safety rail — a SPEND CAP — refuses any live paid publish whose daily
// budget exceeds `META_MAX_DAILY_BUDGET` (default 100, account-currency major
// units).
//
// DRY-RUN is the default everywhere: with `live` unset/false, publishCampaign
// assembles the exact same objects through dry-run Meta clients (synthetic ids,
// zero network, zero spend), returns the would-be objects, and persists item
// statuses. All side-effecting collaborators — the store, the token resolver,
// and the Meta client factories — are INJECTABLE so tests run fully offline.

import type { SupabaseClient } from '@supabase/supabase-js';

import { MetaAdsClient } from '@/lib/meta-ads';
import type {
  BillingEvent,
  CampaignObjective,
  OptimizationGoal,
  TargetingSpec,
} from '@/lib/meta-ads';
import { MetaPublishClient, publishPagePost } from '@/lib/meta-publish';
import { META_GRAPH_VERSION } from '@/lib/meta-config';
import { getDecryptedMetaToken } from '@/lib/meta';
import { resolveClientSelection } from '@/lib/meta-connections';
import { createAdminClient } from '@/lib/supabase/server';

import { ilsToAgorot } from './targeting-map';
import { supabaseCampaignStore, type CampaignStore } from './store';
import type {
  Campaign,
  CampaignItemType,
  CampaignObjectiveDb,
} from './types';

// ── env flags (the two hard gates + the spend cap) ──────────────────────────────

/** Master switch for the LIVE path. Anything other than the string 'true' = off. */
export const LIVE_PUBLISH_FLAG = 'LIVE_PUBLISH_ENABLED';
/** Env var name for the per-campaign daily-budget ceiling (major units). */
export const MAX_DAILY_BUDGET_FLAG = 'META_MAX_DAILY_BUDGET';
/** Fallback ceiling when META_MAX_DAILY_BUDGET is unset/invalid. */
export const DEFAULT_MAX_DAILY_BUDGET = 100;

/** True only when the operator has explicitly opted into live publishing. */
export function isLivePublishEnabled(): boolean {
  return process.env[LIVE_PUBLISH_FLAG] === 'true';
}

/** The effective daily-budget cap (major units). Guards against bad env values. */
export function maxDailyBudget(): number {
  const raw = Number(process.env[MAX_DAILY_BUDGET_FLAG]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_DAILY_BUDGET;
}

// ── the publish plan (what to actually push to Meta) ────────────────────────────
//
// The runner already RECORDED the campaign; publish resolves it into a concrete,
// self-contained plan so this module never has to reach back into decision/
// generation internals. `resolvePlan` (an injectable dep) produces it.

export interface PaidPublishPlan {
  channel:          'meta_paid';
  clientId:         string;
  adAccountId:      string;
  pageId:           string;
  name:             string;
  metaObjective:    CampaignObjective;
  optimizationGoal: OptimizationGoal;
  billingEvent:     BillingEvent;
  /** Daily budget in ACCOUNT-CURRENCY MAJOR units. The spend cap checks THIS. */
  dailyBudget:      number;
  targeting:        TargetingSpec;
  message:          string;
  link:             string;
  imageUrl:         string;
}

export interface OrganicPublishPlan {
  channel:  'meta_organic';
  clientId: string;
  pageId:   string;
  message:  string;
  link?:    string;
}

export type PublishPlan = PaidPublishPlan | OrganicPublishPlan;

// ── result + refusal model ──────────────────────────────────────────────────────

export type PublishRefusalReason =
  | 'not_found'            // no publishable plan for this campaign
  | 'unsupported_channel'  // e.g. whatsapp — owned elsewhere
  | 'live_disabled'        // LIVE_PUBLISH_ENABLED !== 'true'
  | 'over_budget'          // daily budget exceeds the spend cap
  | 'no_token';            // no Meta token resolved for the client

/** One object the publish produced (dry-run synthetic id, or a real Meta id). */
export interface PublishedObject {
  type: CampaignItemType;
  id:   string;
  /** Present on paid objects to make the PAUSED guarantee visible in the result. */
  status?: 'PAUSED';
}

export interface PublishResult {
  campaignId:      string;
  /** True only when the gated live path actually executed. */
  live:            boolean;
  /** True whenever no live Meta write happened (dry-run OR refusal). */
  dryRun:          boolean;
  /** True when a live publish was requested but a safety rule blocked it. */
  refused:         boolean;
  reason?:         PublishRefusalReason;
  message:         string;
  /** The would-be (dry) or actual (live) Meta objects, in creation order. */
  objects:         PublishedObject[];
  metaCampaignId?: string | null;
}

// ── deps (all injectable; sensible prod defaults) ───────────────────────────────

export interface PublishCampaignParams {
  campaignId:  string;
  ownerUserId: string;
  /** Default false → DRY-RUN. true requests the gated live path. */
  live?:       boolean;
}

export interface PublishCampaignDeps {
  /** REQUIRED: resolve the recorded campaign into a concrete plan (or null). */
  resolvePlan: (campaignId: string, ownerUserId: string) => Promise<PublishPlan | null>;

  /** Persistence. Default: supabaseCampaignStore(createAdminClient()). */
  store?: CampaignStore;

  /**
   * Resolve the client's decrypted Meta token for the LIVE path.
   * Default: getDecryptedMetaToken (active meta_connections → decrypt), which is
   * exactly the getActiveConnection + decrypt chain.
   */
  getToken?: (clientId: string, ownerUserId: string) => Promise<string | null>;

  /** Ads client factory (injected in tests). Default: real MetaAdsClient. */
  makeAdsClient?: (opts: {
    accessToken: string;
    adAccountId: string;
    dryRun: boolean;
  }) => MetaAdsClient;

  /** Organic client factory (injected in tests). Default: real MetaPublishClient. */
  makePublishClient?: (opts: { accessToken: string; dryRun: boolean }) => MetaPublishClient;
}

// ── the publish ─────────────────────────────────────────────────────────────────

/**
 * Publish a recorded campaign to Meta.
 *
 * Default (`live` unset/false): DRY-RUN — assemble via dry-run clients, return
 * the would-be objects, persist item statuses. No token, no gate, no spend.
 *
 * `live: true`: the GATED path. Refuses (never silently) unless the
 * LIVE_PUBLISH_ENABLED flag is on AND a token resolves; refuses if a paid daily
 * budget exceeds the spend cap. On success every paid object is created PAUSED.
 */
export async function publishCampaign(
  params: PublishCampaignParams,
  deps: PublishCampaignDeps,
): Promise<PublishResult> {
  const { campaignId, ownerUserId } = params;
  const wantLive = params.live === true;

  // Build the admin client lazily so fully-injected tests never touch env/DB.
  // The default getToken only instantiates it if the LIVE path actually needs a
  // token — dry-run runs with an injected store never construct it.
  let cachedAdmin: SupabaseClient | null = null;
  const admin = () => (cachedAdmin ??= createAdminClient());

  const store = deps.store ?? supabaseCampaignStore(admin());
  const getToken =
    deps.getToken ?? ((clientId: string, uid: string) => getDecryptedMetaToken(admin(), clientId, uid));
  const makeAdsClient =
    deps.makeAdsClient ??
    ((o) => new MetaAdsClient({ ...o, graphVersion: META_GRAPH_VERSION }));
  const makePublishClient =
    deps.makePublishClient ??
    ((o) => new MetaPublishClient({ ...o, graphVersion: META_GRAPH_VERSION }));

  // Resolve what to publish.
  const plan = await deps.resolvePlan(campaignId, ownerUserId);
  if (!plan) {
    return refusal(campaignId, 'not_found', 'No publishable plan found for this campaign.');
  }
  if (plan.channel !== 'meta_paid' && plan.channel !== 'meta_organic') {
    return refusal(
      campaignId,
      'unsupported_channel',
      `Channel "${(plan as { channel: string }).channel}" is not publishable here.`,
    );
  }

  // ── LIVE gates (order: flag → spend cap → token). Any failure = clear refusal. ──
  let live = false;
  let token = 'dry-run'; // placeholder token for the dry-run clients (never sent)

  if (wantLive) {
    if (!isLivePublishEnabled()) {
      return refusal(
        campaignId,
        'live_disabled',
        `Live publish refused: ${LIVE_PUBLISH_FLAG} is not "true". Dry-run only.`,
      );
    }

    if (plan.channel === 'meta_paid') {
      const cap = maxDailyBudget();
      if (plan.dailyBudget > cap) {
        return refusal(
          campaignId,
          'over_budget',
          `Live publish refused: daily budget ${plan.dailyBudget} exceeds the ${MAX_DAILY_BUDGET_FLAG} cap of ${cap}.`,
        );
      }
    }

    const resolved = await getToken(plan.clientId, ownerUserId);
    if (!resolved) {
      return refusal(
        campaignId,
        'no_token',
        'Live publish refused: no Meta access token could be resolved for this client.',
      );
    }
    token = resolved;
    live = true; // all gates cleared
  }

  const dryRun = !live;

  // ── assemble the Meta objects (dry-run OR live — identical calls, PAUSED) ───────
  const objects: PublishedObject[] = [];
  let metaCampaignId: string | null = null;

  if (plan.channel === 'meta_paid') {
    const ads = makeAdsClient({ accessToken: token, adAccountId: plan.adAccountId, dryRun });

    const campaignRes = await ads.createCampaign({
      name: plan.name,
      objective: plan.metaObjective,
      status: 'PAUSED', // RULE 1: never ACTIVE
    });
    metaCampaignId = campaignRes.id;

    const adsetRes = await ads.createAdSet({
      campaignId: campaignRes.id,
      name: `${plan.name} · ad set`,
      dailyBudget: ilsToAgorot(plan.dailyBudget), // MAJOR → MINOR units
      targeting: plan.targeting,
      optimizationGoal: plan.optimizationGoal,
      billingEvent: plan.billingEvent,
      status: 'PAUSED', // RULE 1
    });

    const creativeRes = await ads.createAdCreative({
      pageId: plan.pageId,
      message: plan.message,
      link: plan.link,
      imageUrl: plan.imageUrl,
      name: `${plan.name} · creative`,
    });

    const adRes = await ads.createAd({
      adsetId: adsetRes.id,
      creativeId: creativeRes.id,
      name: `${plan.name} · ad`,
      status: 'PAUSED', // RULE 1
    });

    objects.push(
      { type: 'adset', id: adsetRes.id, status: 'PAUSED' },
      { type: 'creative', id: creativeRes.id },
      { type: 'ad', id: adRes.id, status: 'PAUSED' },
    );
  } else {
    // meta_organic
    const publisher = makePublishClient({ accessToken: token, dryRun });
    const postRes = await publishPagePost(publisher, {
      pageId: plan.pageId,
      message: plan.message,
      link: plan.link,
    });
    objects.push({ type: 'post', id: postRes.id });
  }

  // ── persist statuses (best-effort — never fail the publish on a record error) ───
  await persistStatuses(store, campaignId, ownerUserId, live, metaCampaignId);

  return {
    campaignId,
    live,
    dryRun,
    refused: false,
    message: live
      ? 'Published to Meta — every paid object created PAUSED (zero spend until a human unpauses).'
      : 'Dry-run publish assembled the would-be Meta objects. No live calls, nothing published, nothing unpaused.',
    objects,
    metaCampaignId,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────────

function refusal(campaignId: string, reason: PublishRefusalReason, message: string): PublishResult {
  return { campaignId, live: false, dryRun: true, refused: true, reason, message, objects: [] };
}

/**
 * Reflect the publish outcome on the recorded rows. Items advance to
 * 'published' (live) or 'assembled' (dry-run); on live the campaign flips to
 * dry_run=false, the real meta_campaign_id, and status 'paused' — PUBLISHED to
 * Meta but PAUSED (no spend), awaiting the human MONEY-gate unpause. Optional
 * store methods are called with `?.()` so partial stores degrade gracefully;
 * the whole step is best-effort and never throws.
 */
async function persistStatuses(
  store: CampaignStore,
  campaignId: string,
  ownerUserId: string,
  live: boolean,
  metaCampaignId: string | null,
): Promise<void> {
  try {
    const items = await store.listItems(campaignId, ownerUserId);
    const itemStatus = live ? 'published' : 'assembled';
    for (const it of items) {
      await store.updateItemStatus?.(it.id, itemStatus);
    }
    if (live) {
      await store.updateCampaignPublishState?.(campaignId, {
        status: 'paused',
        dry_run: false,
        meta_campaign_id: metaCampaignId,
      });
    }
  } catch (e: any) {
    console.error('[campaigns.publish] persistStatuses failed:', e?.message ?? e);
  }
}

// ── default plan resolver (reconstruct a plan from the recorded rows) ────────────
//
// Used by the API route's (dormant, gated) live path. Best-effort: it maps the
// recorded campaign + items + the linked creative artifact back into a concrete
// plan. Page / ad-account come from the client's active connection selection
// (env fallbacks). The DRY-RUN unit tests inject their own resolvePlan; this
// exists so the route is complete for the flag-flip.

const PLACEHOLDER_IMAGE = 'https://admaster.local/dry-run-placeholder.jpg';
const PLACEHOLDER_LINK = 'https://admaster.local/lp';

/** DB objective verb → Meta objective + ad-set goals (reverse of targeting-map). */
const DB_OBJECTIVE_TO_META: Record<
  CampaignObjectiveDb,
  { metaObjective: CampaignObjective; optimizationGoal: OptimizationGoal; billingEvent: BillingEvent }
> = {
  awareness:   { metaObjective: 'OUTCOME_AWARENESS',  optimizationGoal: 'REACH',               billingEvent: 'IMPRESSIONS' },
  engagement:  { metaObjective: 'OUTCOME_ENGAGEMENT', optimizationGoal: 'POST_ENGAGEMENT',     billingEvent: 'IMPRESSIONS' },
  traffic:     { metaObjective: 'OUTCOME_TRAFFIC',    optimizationGoal: 'LINK_CLICKS',         billingEvent: 'IMPRESSIONS' },
  leads:       { metaObjective: 'OUTCOME_LEADS',      optimizationGoal: 'LEAD_GENERATION',     billingEvent: 'IMPRESSIONS' },
  conversions: { metaObjective: 'OUTCOME_SALES',      optimizationGoal: 'OFFSITE_CONVERSIONS', billingEvent: 'IMPRESSIONS' },
  messages:    { metaObjective: 'OUTCOME_ENGAGEMENT', optimizationGoal: 'POST_ENGAGEMENT',     billingEvent: 'IMPRESSIONS' },
};

/**
 * Build a resolvePlan backed by the admin Supabase client: reads the campaign,
 * its items, and the linked creative artifact content. Returns null for a
 * missing campaign or a non-meta channel (publishCampaign then refuses cleanly).
 */
export function storedPlanResolver(
  admin: SupabaseClient,
): (campaignId: string, ownerUserId: string) => Promise<PublishPlan | null> {
  const store = supabaseCampaignStore(admin);

  return async (campaignId, ownerUserId) => {
    const campaign = await store.getCampaign(campaignId, ownerUserId);
    if (!campaign) return null;
    if (campaign.channel !== 'meta_paid' && campaign.channel !== 'meta_organic') return null;

    const items = await store.listItems(campaignId, ownerUserId);

    // Creative content lives on the linked content_artifacts row.
    const artifactId =
      items.find((i) => i.artifact_id)?.artifact_id ?? null;
    const content = artifactId ? await loadArtifactContent(admin, artifactId) : {};
    const message =
      pickString(content, 'post') ??
      pickString(content, 'message') ??
      pickString(content, 'body') ??
      '';
    const imageUrl = pickString(content, 'imageUrl') ?? pickString(content, 'image_url') ?? PLACEHOLDER_IMAGE;
    const link = pickString(content, 'link') ?? PLACEHOLDER_LINK;

    // Page / ad-account from the client's active connection selection.
    const selection = await resolveClientSelection(admin, { id: campaign.client_id }, ownerUserId);
    const pageId = selection.selected_page_id || process.env.META_PAGE_ID || '';
    const adAccountId = selection.selected_ad_account_id || process.env.META_AD_ACCOUNT_ID || '';

    if (campaign.channel === 'meta_organic') {
      return { channel: 'meta_organic', clientId: campaign.client_id, pageId, message, link };
    }

    const targeting =
      (items.find((i) => i.item_type === 'adset')?.targeting_spec as TargetingSpec | undefined) ?? {};
    const obj = DB_OBJECTIVE_TO_META[(campaign.objective ?? 'traffic') as CampaignObjectiveDb] ??
      DB_OBJECTIVE_TO_META.traffic;

    return {
      channel: 'meta_paid',
      clientId: campaign.client_id,
      adAccountId,
      pageId,
      name: campaign.name,
      metaObjective: obj.metaObjective,
      optimizationGoal: obj.optimizationGoal,
      billingEvent: obj.billingEvent,
      dailyBudget: campaign.daily_budget ?? 0,
      targeting,
      message,
      link,
      imageUrl,
    };
  };
}

async function loadArtifactContent(
  admin: SupabaseClient,
  artifactId: string,
): Promise<Record<string, unknown>> {
  try {
    const { data } = await admin
      .from('content_artifacts')
      .select('content')
      .eq('id', artifactId)
      .maybeSingle();
    const content = (data as { content?: unknown } | null)?.content;
    return content && typeof content === 'object' ? (content as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
