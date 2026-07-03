// tests/capabilities-composition.test.ts
//
// COMPOSITION PROOF for the marketing capabilities (spec C-01/02/03/06/07/10).
//
// Each capability is deeply tested in its own folder; this suite proves they
// work as ONE SYSTEM: a single hypothesis (with the atoms it rests on) flows
// through attention → resolution → calibration → episodic memory, while the
// same atoms drive the message architecture and the brand lint. The contracts
// module (lib/capability-contracts) is the spine — if any capability drifts
// from the shared row shapes, this suite is where it snaps.
//
// Orchestrator-owned (capability folders never cross-import each other; this
// file may import all of them).
import { describe, expect, it } from 'vitest';

import { resolve as resolveHypothesis } from '@/lib/hypotheses';
import { brier, toSample } from '@/lib/calibration';
import { abstractEpisode, composeFromHypothesis, outcomeOf } from '@/lib/episodic';
import { DEFAULT_WEIGHTS, rankClients, scoreAttention } from '@/lib/attention';
import { synthesizeArchitecture } from '@/lib/strategy-objects';
import { lintArtifact } from '@/lib/brand-lint';
import type { HypothesisRow } from '@/lib/capability-contracts';
import type { ClientAttentionState } from '@/lib/attention';
import type { ClientInsight } from '@/lib/intelligence/types';

// ── Shared fixture: one client, its atoms, one pre-registered hypothesis ─────

const CLIENT_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID  = '00000000-0000-4000-8000-000000000002';

const atom = (id: string, layer: ClientInsight['layer'], kind: string, content: string, confidence: number): ClientInsight => ({
  id, client_id: CLIENT_ID, owner_user_id: OWNER_ID,
  layer, kind, content, structured: null,
  source: 'brief', source_ref: null,
  confidence, evidence_count: 2, status: 'active',
  superseded_by: null, superseded_reason: null,
  first_seen_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-02T00:00:00Z',
});

const ATOMS: ClientInsight[] = [
  atom('a-translation', 'bridge', 'value_translation', 'ביטחון בחיוך הופך לביטחון בחיים', 0.85),
  atom('a-angle',       'bridge', 'angle',             'זווית הביטחון הרגשי — לא עוד טיפול, שקט נפשי', 0.7),
  atom('a-desire',      'customers', 'desire',         'רוצים להרגיש בטוחים לחייך בפגישות', 0.75),
  atom('a-objection',   'customers', 'objection',      'פחד שהטיפול יכאב ויעלה ביוקר', 0.65),
  atom('a-proof',       'business', 'proof',           '137 מטופלים חייכו מחדש בשנה האחרונה', 0.8),
  atom('a-brand',       'business', 'brand_voice',     'טון חם וישיר, פנייה לנשים', 0.9),
];
// The brand atom carries its spec in structured (schema defined by C-07).
ATOMS[5].structured = {
  register: 'dugri',
  address: { gender: 'female' },
  emoji_policy: 'light',
  taboo_words: ['מבצע'],
};

/** A pre-registered angle hypothesis resting on the angle + desire atoms. */
const openHypothesis = (): HypothesisRow => ({
  id: 'h-0000-0000',
  client_id: CLIENT_ID,
  owner_user_id: OWNER_ID,
  insight_ids: ['a-angle', 'a-desire'],
  claim: 'זווית הביטחון הרגשי תנצח את זווית המחיר על CVR אצל קהל הנשים 35-50',
  prediction: { metric: 'cvr', comparator: 'ratio_gte', value: 1.3, arm: 'emotional-safety', baseline_arm: 'price', confidence: 0.7 },
  floor_spec: { metric_grade: 'cvr', per_arm: { clicks: 100 } },
  horizon: { max_days: 21 },
  verdict_map: {
    supported: [
      { insight_id: 'a-angle', polarity: 'positive', weight: 0.6 },
      { insight_id: 'a-desire', polarity: 'positive', weight: 0.5 },
    ],
    refuted: [{ insight_id: 'a-angle', polarity: 'negative', weight: 0.6 }],
    inconclusive: [],
  },
  kill_rules: {},
  test_refs: [{ arm_label: 'emotional-safety' }, { arm_label: 'price' }],
  domain: 'angle',
  status: 'open',
  resolution: null,
  registered_at: '2026-07-01T08:00:00Z',
  resolved_at: null,
  superseded_by: null,
  created_at: '2026-07-01T08:00:00Z',
  updated_at: '2026-07-01T08:00:00Z',
});

const attentionState = (clientId: string, open: HypothesisRow[], progress: number): ClientAttentionState => ({
  clientId,
  ownerUserId: OWNER_ID,
  anomalyFlags: [],
  openHypotheses: open.map((hypothesis) => ({
    hypothesis,
    sampleProgress: progress,
    decisionWeight: hypothesis.insight_ids.length * 1.5,
  })),
  staleness: { daysSinceLastAtomEvent: 1, cadenceDays: 7 },
  calendar: [],
  errorStates: [],
  activeCampaigns: 0,
});

describe('capabilities compose as one system', () => {
  it('C-06 → C-01 → C-03 → C-02: one hypothesis flows attention → verdict → calibration → episodic memory', () => {
    const hypothesis = openHypothesis();

    // 1) C-06: while OPEN near its floor, the hypothesis makes its (tiny quiet)
    //    client outrank a bigger quiet client — information value, not size.
    const testingClient = attentionState(CLIENT_ID, [hypothesis], 0.85);
    const quietClient   = { ...attentionState('00000000-0000-4000-8000-00000000000q', [], 0), activeCampaigns: 5 };
    const ranked = rankClients([quietClient, testingClient]);
    expect(ranked[0].clientId).toBe(CLIENT_ID);
    expect(scoreAttention(testingClient, DEFAULT_WEIGHTS).components.hypothesisValue.value).toBeGreaterThan(0);

    // 2) C-01: observations land past the floor with the predicted ratio met →
    //    'supported', and the atom moves are EXACTLY the frozen verdict_map.
    const outcome = resolveHypothesis(
      hypothesis,
      [
        { arm: 'emotional-safety', clicks: 140, metrics: { cvr: 0.052 } },
        { arm: 'price',            clicks: 130, metrics: { cvr: 0.030 } },
      ],
      new Date('2026-07-10T09:00:00Z'),
    );
    expect(outcome.status).toBe('supported');
    expect(outcome.atomMoves).toEqual(hypothesis.verdict_map.supported);

    const resolvedRow: HypothesisRow = {
      ...hypothesis,
      status: outcome.status,
      resolution: outcome.resolution,
      resolved_at: '2026-07-10T09:00:00Z',
    };

    // 3) C-03: the resolved row becomes a calibration sample scored against the
    //    REGISTERED confidence (0.7 belief, supported → outcome 1, brier 0.09).
    const sampleResult = toSample(resolvedRow);
    expect(sampleResult.sample).not.toBeNull();
    if (sampleResult.sample === null) throw new Error('sample expected');
    expect(sampleResult.sample.predicted).toBe(0.7);
    expect(sampleResult.sample.outcome).toBe(1);
    expect(sampleResult.sample.domain).toBe('angle');
    const score = brier(sampleResult.sample.predicted, sampleResult.sample.outcome);
    if (!score.ok) throw new Error('brier expected to compute');
    expect(score.value).toBeCloseTo(0.09, 10);

    // 4) C-02: the same row composes into an episode (win) whose text carries
    //    the claim + verdict, and abstracts fleet-safe (client name stripped).
    expect(outcomeOf({ kind: 'hypothesis', row: resolvedRow })).toBe('win');
    const episode = composeFromHypothesis(resolvedRow);
    expect(episode.episode_text).toContain('זווית הביטחון הרגשי');
    expect(episode.episode_text.toLowerCase()).toContain('supported');
    const abstracted = abstractEpisode(episode.episode_text, { clientName: 'מרפאת ד"ר כהן' });
    expect(abstracted === null || !abstracted.includes('ד"ר כהן')).toBe(true);

    // 5) The learning loop's WHY-trail: the moves point at the SAME atoms the
    //    architecture below builds pillars from — one atom graph end to end.
    expect(outcome.atomMoves.map((m) => m.insight_id)).toContain('a-angle');
  });

  it('C-10 + C-07: the same atoms project into a message architecture, and copy is linted against the same brand atom', async () => {
    // C-10: pillars grounded in the shared atom fixture.
    const synthesis = synthesizeArchitecture({ insights: ATOMS });
    const arch = synthesis.architecture;
    expect(arch.core_promise.insight_id).toBe('a-translation');
    const allPillarAtoms = arch.pillars.flatMap((p) => p.insight_ids);
    expect(allPillarAtoms).toContain('a-desire');
    expect(allPillarAtoms).toContain('a-objection');
    expect(arch.grounded_in.length).toBeGreaterThan(0);

    // C-07: ad copy that violates the brand atom (taboo word + masculine
    // address vs female spec + personal-attribute callout) gets caught.
    const badCopy = 'סובל מכאבי שיניים? מבצע ענק! תרגיש בטוח לחייך 😀😀😀';
    const bad = await lintArtifact(badCopy, ATOMS);
    expect(bad.passed).toBe(false);
    expect(bad.violations.length).toBeGreaterThanOrEqual(2);

    // Copy consistent with the same atoms passes: feminine address, no taboo,
    // objection pre-empted (the C-10 objection pillar's job), light emoji.
    const goodCopy = 'רוצה לחייך בביטחון בכל פגישה? בלי כאב, ובתשלומים נוחים. בואי לבדיקה ראשונה 🙂';
    const good = await lintArtifact(goodCopy, ATOMS);
    expect(good.passed).toBe(true);
  });
});
