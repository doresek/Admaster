// lib/campaigns/runner.ts
//
// THE RUNNER — the unit the AI marketer "runs" on behalf of the user. It turns
// the LIVING client understanding into a full campaign, assembled and recorded,
// and NEVER spends real money:
//
//   1. load active insights + strategy + client context (IMPORTED, never edited)
//   2. decide(...)            ← the real decision-engine moat (insight-driven)
//   3. generate creative      ← injectable dep (wraps lib/master-studio in prod)
//   4. assemble objects       ← meta_paid → lib/meta-ads (dryRun); meta_organic →
//                               lib/meta-publish (dryRun). Everything created PAUSED.
//   5. record campaigns + campaign_items + campaign_decisions — EVERY row stamped
//      with `grounded_in` (the decision's insight ids) + a plain-language rationale.
//
// `dry_run` defaults TRUE. The runner walks the state machine draft→planned→
// generating→assembled and STOPS — it never schedules, publishes, unpauses, or
// spends. All side-effecting collaborators (DB store, creative generation, the
// Meta clients) are INJECTABLE so tests run with the REAL decide() over fixture
// insights, a mock store, a stub generator, and dry-run Meta clients.

import { decide as realDecide } from '@/lib/decision-engine';
import type {
  DecideInput,
  DecisionClientContext,
  Insight,
  MarketingDecision,
  StrategyAnalysis,
} from '@/lib/decision-engine';
import { listActiveInsights } from '@/lib/intelligence/insights';
import { getClient, getClientStrategy } from '@/lib/clients';
import { createAdminClient } from '@/lib/supabase/server';
import { MetaAdsClient } from '@/lib/meta-ads';
import { MetaPublishClient, publishPagePost } from '@/lib/meta-publish';
import { META_GRAPH_VERSION } from '@/lib/meta-config';

import {
  ilsToAgorot,
  mapObjective,
  mapPublisherPlatforms,
  mapTargeting,
} from './targeting-map';
import { parseStrategyAnalysis } from '@/lib/validation';
import { assertTransition } from './state';
import { supabaseCampaignStore, type CampaignStore } from './store';
import type {
  Campaign,
  CampaignChannel,
  CampaignDecision,
  CampaignDecisionInsert,
  CampaignItem,
  CampaignItemInsert,
} from './types';

// ── creative generation seam ────────────────────────────────────────────────

/** What the runner asks the generator to produce a creative for. */
export interface GenerateRequest {
  clientId:    string;
  ownerUserId: string;
  channel:     CampaignChannel;
  decision:    MarketingDecision;
}

/**
 * The creative a generator returns. `artifactId` links to a recorded
 * content_artifacts row when the generator persisted one (the prod generator,
 * wrapping lib/master-studio, does); the runner stamps it onto the items.
 */
export interface GeneratedCreative {
  post:       string;
  hashtags?:  string[];
  imageUrl?:  string;
  link?:      string;
  whatsapp?:  string;
  artifactId?: string | null;
  raw?:       unknown;
}

/** Injectable creative generator. In prod this wraps lib/master-studio. */
export type GenerateCreative = (req: GenerateRequest) => Promise<GeneratedCreative>;

// ── runner deps + params ──────────────────────────────────────────────────────

export interface RunCampaignParams {
  clientId:    string;
  channel:     CampaignChannel;
  ownerUserId: string;
  /** Optional explicit campaign name; otherwise derived from the angle. */
  name?:       string;
}

export interface RunCampaignDeps {
  /** REQUIRED: produce the creative (stub in tests; master-studio in prod). */
  generate: GenerateCreative;

  /** Load active insight atoms for the client. Default: listActiveInsights(admin). */
  loadInsights?: (clientId: string, ownerUserId: string) => Promise<Insight[]>;
  /** Load the synthesized strategy snapshot. Default: getClientStrategy → business_analysis. */
  loadStrategy?: (clientId: string) => Promise<StrategyAnalysis | null>;
  /** Load minimal client context (geo / budget). Default: getClient(admin). */
  loadClient?:   (clientId: string, ownerUserId: string) => Promise<DecisionClientContext | null>;

  /** The decision function. Default: the real decision-engine decide(). */
  decide?: (input: DecideInput) => MarketingDecision;

  /** Persistence. Default: supabaseCampaignStore(createAdminClient()). */
  store?: CampaignStore;

  /** Dry-run Meta Ads client (meta_paid). Default: a dryRun MetaAdsClient. */
  metaAds?: MetaAdsClient;
  /** Dry-run Meta organic client (meta_organic). Default: a dryRun MetaPublishClient. */
  metaPublish?: MetaPublishClient;

  /** Page id ads/posts are published from (env META fallback). */
  pageId?: string;
  /** Destination link for paid creatives / page posts. */
  link?: string;
  /** Fallback image url for a paid creative when the generator returns none. */
  fallbackImageUrl?: string;
}

/** The full result of a (dry-run) campaign run. */
export interface RunCampaignResult {
  decision:  MarketingDecision;
  campaign:  Campaign;
  items:     CampaignItem[];
  decisions: CampaignDecision[];
  /** Unresolved-id / mapping gaps surfaced by the targeting mapper. */
  notes:     string[];
  dryRun:    boolean;
}

// ── helpers ────────────────────────────────────────────────────────────────────

const PLACEHOLDER_IMAGE = 'https://admaster.local/dry-run-placeholder.jpg';
const PLACEHOLDER_LINK = 'https://admaster.local/lp';

function deriveName(decision: MarketingDecision, channel: CampaignChannel): string {
  const angle = (decision.angle || 'Campaign').replace(/\s+/g, ' ').trim().slice(0, 60);
  const tag = channel === 'meta_organic' ? 'Organic' : channel === 'whatsapp' ? 'WhatsApp' : 'Paid';
  return `${tag} · ${decision.funnel_stage} · ${angle}`;
}

/** Default insight loader: active atoms via the intelligence data layer. */
function defaultLoadInsights(admin: ReturnType<typeof createAdminClient>) {
  return (clientId: string, _ownerUserId: string) => listActiveInsights(admin, clientId);
}

/** Default strategy loader: the persisted business_analysis (a StrategyAnalysis). */
function defaultLoadStrategy(admin: ReturnType<typeof createAdminClient>) {
  return async (clientId: string): Promise<StrategyAnalysis | null> => {
    const row = await getClientStrategy(admin, clientId);
    // H1 boundary: business_analysis is LLM-produced JSONB. VALIDATE its shape
    // before trusting it as a StrategyAnalysis — never feed the decision engine
    // a blindly-cast object. On mismatch, degrade to null so decide() takes its
    // built-in strategyFallback path (a coherent no-op) instead of propagating
    // a malformed/partially-null strategy as a "valid" decision input.
    const raw = row?.business_analysis;
    const strategy = parseStrategyAnalysis(raw);
    if (raw != null && strategy === null) {
      console.warn(
        `[runner] client_strategy.business_analysis for client ${clientId} failed StrategyAnalysis validation; degrading to strategy=null (decision engine uses its fallback path).`,
      );
    }
    return strategy;
  };
}

/** Default client loader: map a clients row to the engine's minimal context. */
function defaultLoadClient(admin: ReturnType<typeof createAdminClient>) {
  return async (clientId: string, ownerUserId: string): Promise<DecisionClientContext | null> => {
    const c = await getClient(admin, clientId, ownerUserId);
    if (!c) return null;
    return { id: c.id, name: c.name };
  };
}

// ── the runner ──────────────────────────────────────────────────────────────────

export async function runCampaign(
  params: RunCampaignParams,
  deps: RunCampaignDeps,
): Promise<RunCampaignResult> {
  const { clientId, channel, ownerUserId } = params;
  const dryRun = true; // T2 is dry-run only; the live path is gated (T9).

  // Build defaults lazily so tests that inject everything never touch env/DB.
  const needsAdmin =
    !deps.loadInsights || !deps.loadStrategy || !deps.loadClient || !deps.store;
  const admin = needsAdmin ? createAdminClient() : null;

  const loadInsights = deps.loadInsights ?? defaultLoadInsights(admin!);
  const loadStrategy = deps.loadStrategy ?? defaultLoadStrategy(admin!);
  const loadClient = deps.loadClient ?? defaultLoadClient(admin!);
  const store = deps.store ?? supabaseCampaignStore(admin!);
  const decideFn = deps.decide ?? realDecide;

  // 1) load the living understanding ──────────────────────────────────────────
  const [insights, strategy, client] = await Promise.all([
    loadInsights(clientId, ownerUserId),
    loadStrategy(clientId),
    loadClient(clientId, ownerUserId),
  ]);

  // state: the campaign exists conceptually as draft → planned once decided.
  let status = assertTransition('draft', 'planned');

  // 2) the moat: insight-driven decision ────────────────────────────────────────
  const decision = decideFn({ client, insights, strategy });
  const obj = mapObjective(decision.objective);

  // 3) generate the creative (injected; wraps master-studio in prod) ────────────
  status = assertTransition(status, 'generating');
  const creative = await deps.generate({ clientId, ownerUserId, channel, decision });

  // 4) assemble the channel objects (dry-run — zero spend) ───────────────────────
  const pageId = deps.pageId || process.env.META_PAGE_ID || 'dryrun_page';
  const link = creative.link || deps.link || process.env.META_DEFAULT_LINK || PLACEHOLDER_LINK;
  const name = params.name?.trim() || deriveName(decision, channel);
  const { targeting, notes } = mapTargeting(decision.targeting_spec);
  const pubPlats = mapPublisherPlatforms(decision.platform);
  if (pubPlats) targeting.publisher_platforms = pubPlats;

  let metaCampaignId: string | null = null;
  // item drafts (campaign_id filled in after the campaign row is created)
  const itemDrafts: Omit<CampaignItemInsert, 'campaign_id'>[] = [];

  if (channel === 'meta_paid') {
    const ads =
      deps.metaAds ??
      new MetaAdsClient({
        accessToken: process.env.META_SYSTEM_TOKEN || 'dry-run',
        adAccountId: process.env.META_AD_ACCOUNT_ID || 'dryrun',
        graphVersion: META_GRAPH_VERSION,
        dryRun: true,
      });

    const campaignRes = await ads.createCampaign({
      name,
      objective: obj.metaObjective,
      status: 'PAUSED', // never auto-active
    });
    metaCampaignId = campaignRes.id;

    const adsetRes = await ads.createAdSet({
      campaignId: campaignRes.id,
      name: `${name} · ad set`,
      dailyBudget: ilsToAgorot(decision.daily_budget), // MINOR units
      targeting,
      optimizationGoal: obj.optimizationGoal,
      billingEvent: obj.billingEvent,
      status: 'PAUSED',
    });

    const creativeRes = await ads.createAdCreative({
      pageId,
      message: creative.post,
      link,
      imageUrl: creative.imageUrl || deps.fallbackImageUrl || PLACEHOLDER_IMAGE,
      name: `${name} · creative`,
    });

    const adRes = await ads.createAd({
      adsetId: adsetRes.id,
      creativeId: creativeRes.id,
      name: `${name} · ad`,
      status: 'PAUSED',
    });

    itemDrafts.push(
      {
        client_id: clientId,
        owner_user_id: ownerUserId,
        artifact_id: creative.artifactId ?? null,
        item_type: 'adset',
        status: 'assembled',
        meta_object_id: adsetRes.id,
        targeting_spec: targeting as Record<string, unknown>,
        grounded_in: decision.grounded_in,
        rationale: `Ad set targets "${decision.sub_audience}" (${decision.funnel_stage}, obj ${decision.objective}) at ${decision.daily_budget}/day — audience derived from ${decision.grounded_in.length} insight atom(s).`,
      },
      {
        client_id: clientId,
        owner_user_id: ownerUserId,
        artifact_id: creative.artifactId ?? null,
        item_type: 'creative',
        status: 'assembled',
        meta_object_id: creativeRes.id,
        targeting_spec: {},
        grounded_in: decision.grounded_in,
        rationale: `Creative carries the "${decision.angle}" angle. ${decision.rationale}`,
      },
      {
        client_id: clientId,
        owner_user_id: ownerUserId,
        artifact_id: creative.artifactId ?? null,
        item_type: 'ad',
        status: 'assembled',
        meta_object_id: adRes.id,
        targeting_spec: targeting as Record<string, unknown>,
        grounded_in: decision.grounded_in,
        rationale: `Ad links the angle creative to the insight-derived ad set (created PAUSED, dry-run).`,
      },
    );
  } else if (channel === 'meta_organic') {
    const publisher =
      deps.metaPublish ??
      new MetaPublishClient({
        accessToken: process.env.META_SYSTEM_TOKEN || 'dry-run',
        graphVersion: META_GRAPH_VERSION,
        dryRun: true,
      });

    const postRes = await publishPagePost(publisher, {
      pageId,
      message: creative.post,
      link,
    });

    itemDrafts.push({
      client_id: clientId,
      owner_user_id: ownerUserId,
      artifact_id: creative.artifactId ?? null,
      item_type: 'post',
      status: 'assembled',
      meta_object_id: postRes.id,
      targeting_spec: {},
      grounded_in: decision.grounded_in,
      rationale: `Organic post on the "${decision.angle}" angle for "${decision.sub_audience}". ${decision.rationale}`,
    });
  } else {
    // 'whatsapp' is owned by T6; the campaign is recorded but no object assembled here.
    notes.push('channel "whatsapp" is owned by T6; no object assembled in the T2 runner.');
  }

  // state: generating → assembled (objects built, nothing published)
  status = assertTransition(status, 'assembled');

  // 5) record everything, every row grounded ────────────────────────────────────
  const persistedCampaign = await store.insertCampaign({
    client_id: clientId,
    owner_user_id: ownerUserId,
    name,
    objective: obj.dbObjective,
    channel,
    status,
    daily_budget: channel === 'meta_organic' ? null : decision.daily_budget,
    funnel_stage: decision.funnel_stage,
    meta_campaign_id: metaCampaignId,
    dry_run: dryRun,
    grounded_in: decision.grounded_in,
    rationale: decision.rationale,
  });

  // Graceful: if persistence is unavailable, synthesize a coherent local row so
  // the caller still gets a full result (dry-run assembly must not fail on this).
  const campaign: Campaign =
    persistedCampaign ?? {
      id: `unsaved_${Date.now()}`,
      client_id: clientId,
      owner_user_id: ownerUserId,
      name,
      objective: obj.dbObjective,
      channel,
      status,
      daily_budget: channel === 'meta_organic' ? null : decision.daily_budget,
      funnel_stage: decision.funnel_stage,
      meta_campaign_id: metaCampaignId,
      dry_run: dryRun,
      grounded_in: decision.grounded_in,
      rationale: decision.rationale,
    };

  const items: CampaignItem[] = [];
  for (const draft of itemDrafts) {
    const saved = await store.insertItem({ ...draft, campaign_id: campaign.id });
    items.push(
      saved ?? {
        id: `unsaved_item_${items.length + 1}`,
        ab_parent_id: null,
        campaign_id: campaign.id,
        ...draft,
      },
    );
  }

  const decisionInserts = buildDecisionLog(campaign.id, clientId, ownerUserId, decision, obj, channel, targeting as Record<string, unknown>);
  const decisions: CampaignDecision[] = [];
  for (const di of decisionInserts) {
    const saved = await store.insertDecision(di);
    decisions.push(saved ?? { id: `unsaved_decision_${decisions.length + 1}`, ...di });
  }

  return { decision, campaign, items, decisions, notes, dryRun };
}

/**
 * Turn ONE MarketingDecision into the per-`decision_type` grounded log rows.
 * Every row records the atom ids it drew from + a plain-language rationale.
 */
function buildDecisionLog(
  campaignId: string,
  clientId: string,
  ownerUserId: string,
  decision: MarketingDecision,
  obj: ReturnType<typeof mapObjective>,
  channel: CampaignChannel,
  targeting: Record<string, unknown>,
): CampaignDecisionInsert[] {
  const base = { campaign_id: campaignId, client_id: clientId, owner_user_id: ownerUserId };
  const g = decision.grounded_in;
  return [
    {
      ...base,
      decision_type: 'channel',
      decision: { channel },
      grounded_in: g,
      rationale: `Channel = ${channel}.`,
    },
    {
      ...base,
      decision_type: 'angle',
      decision: { angle: decision.angle },
      grounded_in: g,
      rationale: `Angle = "${decision.angle}" — grounded in ${g.length} insight atom(s).`,
    },
    {
      ...base,
      decision_type: 'audience',
      decision: { sub_audience: decision.sub_audience, targeting_spec: targeting },
      grounded_in: g,
      rationale: `Audience = "${decision.sub_audience}", targeting derived from customers-layer atoms.`,
    },
    {
      ...base,
      decision_type: 'platform',
      decision: { platform: decision.platform, placement: decision.placement },
      grounded_in: g,
      rationale: `Platform = ${decision.platform} (${decision.placement.join(', ')}).`,
    },
    {
      ...base,
      decision_type: 'objective',
      decision: { objective: decision.objective, meta_objective: obj.metaObjective },
      grounded_in: g,
      rationale: `Objective = ${decision.objective} ⇒ Meta ${obj.metaObjective}.`,
    },
    {
      ...base,
      decision_type: 'funnel',
      decision: { funnel_stage: decision.funnel_stage },
      grounded_in: g,
      rationale: `Funnel stage = ${decision.funnel_stage} (from the customer's awareness level).`,
    },
    {
      ...base,
      decision_type: 'budget',
      decision: { daily_budget: decision.daily_budget, daily_budget_minor: ilsToAgorot(decision.daily_budget) },
      grounded_in: g,
      rationale: `Daily budget = ${decision.daily_budget} (${ilsToAgorot(decision.daily_budget)} minor units).`,
    },
  ];
}
