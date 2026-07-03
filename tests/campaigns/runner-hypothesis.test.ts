// Wire-in tests: the runner pre-registers every executed decision as a C-01
// hypothesis (frozen criteria, grounded in the decision's atoms) — and the run
// is NEVER hostage to the ledger (registration failure degrades to a note).
import { describe, expect, it } from 'vitest';
import {
  runCampaign,
  inMemoryCampaignStore,
  type GenerateCreative,
} from '@/lib/campaigns';
import { decide } from '@/lib/decision-engine';
import type { RegisterHypothesisInput } from '@/lib/hypotheses';
import { sampleInsights } from '@/lib/decision-engine/__tests__/fixtures';
import { MetaAdsClient } from '@/lib/meta-ads';

const CLIENT_ID = 'client_1';
const OWNER = 'owner_1';
const insights = sampleInsights();
const expectedDecision = decide({ client: { id: CLIENT_ID, name: 'Acme' }, insights, strategy: null });

const generate: GenerateCreative = async () => ({
  post: 'פוסט', hashtags: [], imageUrl: 'https://cdn.example/img.jpg', artifactId: 'artifact_1',
});

function deps(over: Record<string, unknown> = {}) {
  return {
    generate,
    store: inMemoryCampaignStore(),
    loadInsights: async () => insights,
    loadStrategy: async () => null,
    loadClient: async () => ({ id: CLIENT_ID, name: 'Acme' }),
    metaAds: new MetaAdsClient({ accessToken: 't', adAccountId: '123', dryRun: true }),
    ...over,
  };
}

describe('runCampaign — hypothesis pre-registration wire-in', () => {
  it('registers the decision bet: grounded_in atoms, frozen verdict map, ad item linked', async () => {
    const registered: RegisterHypothesisInput[] = [];
    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      deps({ registerHypothesis: async (input: RegisterHypothesisInput) => { registered.push(input); return { id: 'h1' }; } }),
    );

    expect(registered).toHaveLength(1);
    const hyp = registered[0];
    // the bet rests on EXACTLY the atoms the real decide() grounded the run in
    expect(hyp.insightIds).toEqual(expectedDecision.grounded_in);
    expect(hyp.claim).toContain(expectedDecision.angle);
    expect(hyp.domain).toBe('angle');
    // linked to the persisted ad item
    const adItem = res.items.find((i) => i.item_type === 'ad');
    expect(hyp.testRefs[0].campaign_item_id).toBe(adItem?.id);
    // and the run itself is unaffected
    expect(res.campaign.status).toBe('assembled');
  });

  it('registration failure degrades to a note — the run still completes', async () => {
    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      deps({ registerHypothesis: async () => { throw new Error('ledger down'); } }),
    );
    expect(res.campaign.status).toBe('assembled');
    expect(res.notes.some((n) => n.includes('hypothesis registration failed') && n.includes('ledger down'))).toBe(true);
  });

  it('explicit null disables registration entirely (zero side effects)', async () => {
    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      deps({ registerHypothesis: null }),
    );
    expect(res.notes.every((n) => !n.includes('hypothesis'))).toBe(true);
  });

  it('fully-injected context with no registrar stays side-effect free (default off in tests)', async () => {
    // No registerHypothesis key at all: admin is never constructed because all
    // other deps are injected → the default registrar must NOT activate.
    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_organic', ownerUserId: OWNER },
      deps(),
    );
    expect(res.campaign.status).toBe('assembled');
    expect(res.notes.every((n) => !n.includes('hypothesis registration failed'))).toBe(true);
  });
});
