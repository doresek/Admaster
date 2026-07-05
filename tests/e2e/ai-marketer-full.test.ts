// FULL closed-loop E2E (in-process, dry-run) — broadens tests/e2e/ai-marketer-loop.test.ts
// beyond the paid-only path. Everything runs against the REAL modules with NO
// network, NO live Meta, NO real DB (fake-supabase + fixtures). Every assertion
// reinforces the four invariants of the "AI marketer":
//
//   1. DRY-RUN         nothing is ever published live
//   2. PAUSED          every Meta object that CAN carry a status is PAUSED
//   3. ZERO LIVE CALLS  no real HTTP to Meta / InforU (mock/dry-run adapters only)
//   4. LOOP CLOSES     an underperforming ad weakens the SAME living atom that
//                      explained the customer's real objection
//
// Coverage added here:
//   (a) meta_paid   full loop end-to-end (with a printed trace)
//   (b) meta_organic full loop end-to-end (with a printed trace)
//   (c) WhatsApp leg via lib/whatsapp in MOCK mode — a grounded send
//   (d) Command Center API — grounded_in ids resolve to insight content ("the WHY")
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { decide } from '@/lib/decision-engine';
import { sampleInsights } from '@/lib/decision-engine/__tests__/fixtures';
import type { Insight } from '@/lib/decision-engine';
import {
  runCampaign,
  inMemoryCampaignStore,
  type CampaignChannel,
  type GenerateCreative,
} from '@/lib/campaigns';
import { MetaAdsClient } from '@/lib/meta-ads';
import { MetaPublishClient } from '@/lib/meta-publish';
import { ingestPerformance } from '@/lib/performance';
import { diagnoseCampaignItem } from '@/lib/diagnosis';
import { autoImprove, type DiagnosisRecord } from '@/lib/diagnosis/auto-improve';
import { makeFakeSupabase } from '../performance/fake-supabase';

const CLIENT = 'client_1';
const OWNER = 'owner_1';
const AD_ARTIFACT = 'ad_artifact_1';

// ── mocked @/lib/supabase/server ─────────────────────────────────────────────
// Two consumers touch this module: sendWhatsApp() → createAdminClient(), and the
// Command Center route → createClient(). The closed-loop engines all take an
// explicit `admin` (the fake) so they never reach these mocks.
const H = vi.hoisted(() => ({
  // WhatsApp: capture the row that would have been persisted.
  waInserted: null as Record<string, unknown> | null,
  // Command Center: auth + per-table seed. (OWNER literal — hoisted before consts.)
  authUser: { id: 'owner_1' } as { id: string } | null,
  ccTables: {} as Record<string, { rows?: any[]; error?: any }>,
}));

function ccBuilder(table: string) {
  const cfg = H.ccTables[table] ?? { rows: [] };
  const result = { data: cfg.error ? null : (cfg.rows ?? []), error: cfg.error ?? null };
  const single = { data: cfg.error ? null : (cfg.rows?.[0] ?? null), error: cfg.error ?? null };
  const builder: any = {
    select: () => builder,
    order: () => builder,
    in: () => builder,
    eq: () => builder,
    single: async () => single,
    then: (resolve: any) => resolve(result),
  };
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (_table: string) => ({
      insert: (row: Record<string, unknown>) => {
        H.waInserted = row;
        return { select: () => ({ single: async () => ({ data: { id: 'wa-row-1' }, error: null }) }) };
      },
    }),
  }),
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: H.authUser } }) },
    from: (table: string) => ccBuilder(table),
  }),
}));

// Imported AFTER the mock is registered (vi.mock is hoisted, so order is safe).
import { sendWhatsApp } from '@/lib/whatsapp';
import { GET as getCampaigns } from '@/app/api/command-center/campaigns/route';

// ── shared creative stub (grounded copy, deterministic) ──────────────────────
const generate: GenerateCreative = async () => ({
  post: 'פוסט שמבוסס על התובנות החיות של הלקוח',
  imageUrl: 'https://cdn.example/ad.jpg',
  artifactId: AD_ARTIFACT,
});

interface LoopTrace {
  channel: CampaignChannel;
  angle: string;
  grounded_in: string[];
  campaignStatus: string;
  dryRun: boolean;
  liveCalls: number;
  verdict: string;
  failedLink: string;
  failedInsightIds: string[];
  objectionBefore: number;
  objectionAfter: number;
  signalPolarity: string | null;
}

// One full pass of the loop for a given channel. Returns a trace + does the
// invariant assertions inline so both channel tests share the same guarantees.
async function runChannelLoop(channel: 'meta_paid' | 'meta_organic'): Promise<LoopTrace> {
  const insights = sampleInsights();
  const objectionBefore = insights.find((i) => i.id === 'objection_1')!.confidence;
  expect(objectionBefore).toBe(0.8);

  // 1. DECISION — the moat, real, insight-driven.
  const decision = decide({ client: { id: CLIENT, name: 'Acme' }, insights, strategy: null });
  expect(decision.grounded_in.length).toBeGreaterThan(0);
  expect(decision.rationale).toMatch(/\S/);

  // 2. CAMPAIGN — dry-run assembly, zero spend.
  const store = inMemoryCampaignStore();
  const ads = new MetaAdsClient({ accessToken: 't', adAccountId: '123', dryRun: true });
  const publisher = new MetaPublishClient({ accessToken: 't', dryRun: true });
  const camp = await runCampaign(
    { clientId: CLIENT, channel, ownerUserId: OWNER },
    {
      generate,
      store,
      loadInsights: async () => insights,
      loadStrategy: async () => null,
      loadClient: async () => ({ id: CLIENT, name: 'Acme' }),
      metaAds: ads,
      metaPublish: publisher,
      pageId: 'page_42',
    },
  );

  // INVARIANT 1 — dry-run; grounded exactly in the decision.
  expect(camp.campaign.dry_run).toBe(true);
  expect(camp.campaign.channel).toBe(channel);
  expect(camp.campaign.grounded_in).toEqual(decision.grounded_in);

  let liveCalls = 0;
  if (channel === 'meta_paid') {
    // INVARIANT 3 — every Meta Ads call is dry-run.
    expect(ads.calls.length).toBeGreaterThan(0);
    expect(ads.calls.every((c) => c.dryRun === true)).toBe(true);
    liveCalls = ads.calls.filter((c) => c.dryRun !== true).length;
    // INVARIANT 2 — every object that carries a status is PAUSED.
    for (const c of ads.calls) if ('status' in c.params) expect(c.params.status).toBe('PAUSED');
    expect(camp.campaign.status).toBe('assembled');
  } else {
    // organic has no ad objects to pause; the guarantee is that NOTHING was
    // published live — every publish call is dry-run — and no budget was set.
    expect(publisher.calls.length).toBeGreaterThan(0);
    expect(publisher.calls.every((c) => c.dryRun === true)).toBe(true);
    liveCalls = publisher.calls.filter((c) => c.dryRun !== true).length;
    expect(camp.campaign.daily_budget).toBeNull();
    expect(camp.campaign.status).toBe('assembled');
  }
  expect(liveCalls).toBe(0);

  // 3. MEASURE — the ad ran: good CTR, dead conversions (a failing fixture).
  const fake = makeFakeSupabase({
    client_insights: insights,
    campaign_items: [{ id: 'ci1', artifact_id: AD_ARTIFACT, campaign_id: 'camp1' }],
    diagnoses: [],
  });
  const perf = await ingestPerformance(
    [{
      artifact_id: AD_ARTIFACT, campaign_item_id: 'ci1', ad_id: 'ad_1', client_id: CLIENT, owner_user_id: OWNER,
      metrics: { impressions: 5000, clicks: 100, ctr: 0.02, conversions: 1, conversion_rate: 0.002, spend: 400 },
    }],
    { admin: fake.client as any },
  );
  expect(['failed', 'underperformed']).toContain(perf.rows[0].verdict);

  // 4. DIAGNOSE — reasoned THROUGH the living insight: OFFER (not creative).
  const diag = await diagnoseCampaignItem(
    {
      clientId: CLIENT, ownerUserId: OWNER, scopeArtifactId: AD_ARTIFACT, scopeCampaignId: 'camp1',
      performance: { metrics: { impressions: 5000, ctr: 0.02, conversion_rate: 0.002 } },
    },
    { admin: fake.client as any, loadInsights: async () => insights },
  );
  expect(diag.diagnosis.failed_link).toBe('offer');
  expect(diag.diagnosis.target_insight_ids).toContain('objection_1');

  // 5. AUTO-IMPROVE — regenerate the failed link, A/B, fold the loss back.
  const record: DiagnosisRecord = {
    id: diag.row?.id ?? 'd1',
    client_id: CLIENT, owner_user_id: OWNER,
    failed_link: 'offer', target_insight_ids: ['objection_1'],
    recommended_action: diag.diagnosis.recommended_action ?? {},
    scope_artifact_id: AD_ARTIFACT, scope_campaign_id: 'camp1',
  };
  const improve = await autoImprove(record, {
    admin: fake.client as any,
    regenerate: async (input) => ({
      artifactId: 'ad_artifact_2', itemType: 'ad',
      content: { headline: `new ${input.failedLink} framing that handles the price objection` },
      rationale: `regenerated ${input.failedLink}`,
    }),
  });

  // INVARIANT 4 — the loop closed: the SAME atom was weakened + audited.
  expect(improve.signalId).not.toBeNull();
  expect(improve.polarity).toBe('negative');
  expect(improve.appliedToInsights).toBe(1);
  const objectionAfter = fake.tables['client_insights'].find((i: any) => i.id === 'objection_1').confidence;
  expect(objectionAfter).toBeLessThan(objectionBefore);
  expect(fake.tables['insight_events'].some((e: any) => e.insight_id === 'objection_1')).toBe(true);

  return {
    channel,
    angle: decision.angle,
    grounded_in: decision.grounded_in,
    campaignStatus: camp.campaign.status,
    dryRun: camp.campaign.dry_run,
    liveCalls,
    verdict: perf.rows[0].verdict,
    failedLink: diag.diagnosis.failed_link,
    failedInsightIds: diag.diagnosis.target_insight_ids,
    objectionBefore,
    objectionAfter,
    signalPolarity: improve.polarity,
  };
}

function printTrace(t: LoopTrace): void {
  const lines = [
    ``,
    `── AI-MARKETER CLOSED LOOP · channel=${t.channel} ─────────────────────────`,
    `  1. decide     angle="${t.angle}"  grounded_in=[${t.grounded_in.join(', ')}]`,
    `  2. campaign   status=${t.campaignStatus}  dry_run=${t.dryRun}  live_calls=${t.liveCalls}`,
    `  3. measure    verdict=${t.verdict}`,
    `  4. diagnose   failed_link=${t.failedLink}  target_insights=[${t.failedInsightIds.join(', ')}]`,
    `  5. improve    signal=${t.signalPolarity}  atom(objection_1) confidence ${t.objectionBefore} → ${t.objectionAfter.toFixed(3)}`,
    `  ✓ dry-run · ${t.channel === 'meta_paid' ? 'PAUSED' : 'nothing published live'} · zero live calls · loop closed`,
    ``,
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

beforeEach(() => {
  H.waInserted = null;
  H.authUser = { id: OWNER };
  H.ccTables = {};
});

describe('AI-marketer full closed loop (dry-run, real modules)', () => {
  it('(a) meta_paid: understanding → decision → PAUSED campaign → measure → diagnose → auto-improve → atom update', async () => {
    const trace = await runChannelLoop('meta_paid');
    printTrace(trace);
    expect(trace.liveCalls).toBe(0);
    expect(trace.objectionAfter).toBeLessThan(trace.objectionBefore);
  });

  it('(b) meta_organic: full loop end-to-end, nothing published live, loop still closes', async () => {
    const trace = await runChannelLoop('meta_organic');
    printTrace(trace);
    expect(trace.channel).toBe('meta_organic');
    expect(trace.liveCalls).toBe(0);
    expect(trace.objectionAfter).toBeLessThan(trace.objectionBefore);
  });
});

describe('WhatsApp leg (lib/whatsapp, MOCK mode — grounded send)', () => {
  it('(c) sends a grounded BOFU message with zero live provider calls', async () => {
    const insights = sampleInsights();
    const decision = decide({ client: { id: CLIENT, name: 'Acme' }, insights, strategy: null });

    const res = await sendWhatsApp(
      {
        clientId: CLIENT,
        ownerUserId: OWNER,
        toPhone: '0501234567',
        body: 'הצעה אישית בשבילך שמבוססת על מה שחשוב לך',
        templateName: 'bofu_offer',
        artifactId: AD_ARTIFACT,
        groundedIn: decision.grounded_in,
      },
      { mode: 'mock' }, // ZERO live calls — no HTTP to InforU.
    );

    expect(res.mode).toBe('mock');
    expect(res.ok).toBe(true);
    expect(res.status).toBe('sent');
    expect(res.providerMsgId).toMatch(/^mock-/); // synthetic id, no real send
    // The send is grounded in the SAME living atoms the decision used.
    expect(H.waInserted).toMatchObject({
      client_id: CLIENT,
      provider: 'inforu',
      status: 'sent',
      grounded_in: decision.grounded_in,
    });
    expect((H.waInserted!.grounded_in as string[]).length).toBeGreaterThan(0);
  });
});

describe('Command Center API — grounded_in resolves to the WHY', () => {
  it('(d) resolves campaign grounded_in ids → insight content + confidence', async () => {
    const insights = sampleInsights();
    const decision = decide({ client: { id: CLIENT, name: 'Acme' }, insights, strategy: null });
    const groundedId = decision.grounded_in[0];
    const groundedInsight = insights.find((i) => i.id === groundedId)!;

    H.ccTables = {
      campaigns: {
        rows: [{
          id: 'camp-1', status: 'assembled', channel: 'meta_paid', daily_budget: decision.daily_budget,
          funnel_stage: decision.funnel_stage, grounded_in: decision.grounded_in, rationale: decision.rationale,
          meta_campaign_id: 'dryrun_campaign_1', dry_run: true,
        }],
      },
      campaign_items: {
        rows: [{
          id: 'item-1', campaign_id: 'camp-1', item_type: 'ad', status: 'assembled',
          grounded_in: decision.grounded_in, rationale: 'why', targeting_spec: {},
        }],
      },
      campaign_decisions: { rows: [] },
      client_insights: {
        rows: (insights as Insight[]).map((i) => ({
          id: i.id, content: i.content, confidence: i.confidence, layer: i.layer,
        })),
      },
    };

    const httpRes = await getCampaigns(new Request('http://test/api/command-center/campaigns'));
    expect(httpRes.status).toBe(200);
    const { campaigns } = await httpRes.json();
    expect(campaigns).toHaveLength(1);

    const c = campaigns[0];
    expect(c.dry_run).toBe(true); // Command Center surfaces the dry-run guarantee
    expect(c.grounded_in).toEqual(decision.grounded_in);
    // The WHY: each grounded_in id resolved to real insight content + confidence.
    expect(c.grounded.length).toBe(decision.grounded_in.length);
    const resolved = c.grounded.find((g: any) => g.id === groundedId);
    expect(resolved).toBeTruthy();
    expect(resolved.content).toBe(groundedInsight.content);
    expect(resolved.confidence).toBe(groundedInsight.confidence);
    // Items carry their own resolved grounding too.
    expect(c.items[0].grounded[0].content).toBeTruthy();
  });
});
