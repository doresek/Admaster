// W2 wire-in tests: the runner recalls episodic precedents for the decision,
// records them as a grounded 'precedents' decision-log row, and hands the
// summaries + loaded insights to the generator — and recall NEVER gates a run.
import { describe, expect, it } from 'vitest';
import {
  runCampaign,
  inMemoryCampaignStore,
  NO_PRECEDENTS,
  type GenerateCreative,
  type GenerateRequest,
  type PrecedentBlock,
} from '@/lib/campaigns';
import { sampleInsights } from '@/lib/decision-engine/__tests__/fixtures';
import { MetaAdsClient } from '@/lib/meta-ads';

const CLIENT_ID = 'client_1';
const OWNER = 'owner_1';
const insights = sampleInsights();

const PRECEDENTS: PrecedentBlock = {
  summaries: ['[loss] hypothesis: זווית דחיפות נכשלה ב-BOFU → refuted', '[win] diagnosis: הוק ביטחון עבד'],
  episodeIds: ['ep-1', 'ep-2'],
};

function deps(over: Record<string, unknown> = {}) {
  return {
    generate: (async () => ({ post: 'פוסט', artifactId: 'artifact_1' })) as GenerateCreative,
    store: inMemoryCampaignStore(),
    loadInsights: async () => insights,
    loadStrategy: async () => null,
    loadClient: async () => ({ id: CLIENT_ID, name: 'Acme' }),
    metaAds: new MetaAdsClient({ accessToken: 't', adAccountId: '123', dryRun: true }),
    registerHypothesis: null,
    ...over,
  };
}

describe('runCampaign — episodic precedents wire-in (W2)', () => {
  it('passes recalled summaries AND the loaded insights to the generator', async () => {
    const seen: GenerateRequest[] = [];
    await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      deps({
        generate: (async (req: GenerateRequest) => {
          seen.push(req);
          return { post: 'פוסט', artifactId: 'artifact_1' };
        }) as GenerateCreative,
        recallPrecedents: async () => PRECEDENTS,
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].precedents).toEqual(PRECEDENTS.summaries);
    expect(seen[0].insights).toBe(insights);
  });

  it('records a grounded precedents decision-log row with the episode ids', async () => {
    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      deps({ recallPrecedents: async () => PRECEDENTS }),
    );
    const row = res.decisions.find((d) => d.decision_type === 'precedents');
    expect(row).toBeDefined();
    expect(row?.decision).toMatchObject({ episode_ids: ['ep-1', 'ep-2'], summaries: PRECEDENTS.summaries });
    expect(row?.grounded_in).toEqual(res.decision.grounded_in);
  });

  it('zero precedents → no decision-log row, run unaffected', async () => {
    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      deps({ recallPrecedents: async () => NO_PRECEDENTS }),
    );
    expect(res.decisions.some((d) => d.decision_type === 'precedents')).toBe(false);
    expect(res.campaign.status).toBe('assembled');
  });

  it('degraded recall surfaces its note in the run notes', async () => {
    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      deps({
        recallPrecedents: async () => ({ ...NO_PRECEDENTS, note: 'precedent recall skipped: no embedder key' }),
      }),
    );
    expect(res.notes.some((n) => n.includes('precedent recall skipped'))).toBe(true);
  });

  it('explicit null disables recall; fully-injected default is also off (no admin)', async () => {
    for (const recallPrecedents of [null, undefined]) {
      const res = await runCampaign(
        { clientId: CLIENT_ID, channel: 'meta_organic', ownerUserId: OWNER },
        deps(recallPrecedents === undefined ? {} : { recallPrecedents }),
      );
      expect(res.decisions.some((d) => d.decision_type === 'precedents')).toBe(false);
      expect(res.campaign.status).toBe('assembled');
    }
  });
});
