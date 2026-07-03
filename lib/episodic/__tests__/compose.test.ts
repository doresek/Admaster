// Behavior tests for episode composition (compose.ts): the rendered text must
// carry the causal narrative (failed link + rationale / claim + verdict), the
// outcome mapping must follow the documented per-kind rules, and malformed
// rows must be rejected with typed errors — never rendered as garbage text.
import { describe, expect, it } from 'vitest';
import type { HypothesisResolution } from '@/lib/capability-contracts';
import {
  EpisodeCompositionError,
  composeFromDiagnosis,
  composeFromHypothesis,
  outcomeOf,
} from '../compose';
import type { DiagnosisSourceRow, HypothesisEpisodeSource } from '../types';

const diagnosisRow = (patch: Partial<DiagnosisSourceRow> = {}): DiagnosisSourceRow => ({
  id:                 'd1000000-0000-0000-0000-000000000001',
  client_id:          'c1000000-0000-0000-0000-000000000001',
  owner_user_id:      'u1000000-0000-0000-0000-000000000001',
  scope_artifact_id:  null,
  scope_campaign_id:  null,
  scope_item_id:      'i1000000-0000-0000-0000-000000000001',
  failed_link:        'funnel',
  rationale:          'הדף הנחיתה עבר לזווית מחיר בעוד המודעה מכרה ביטחון רגשי — שבירת ריח בין המודעה לדף',
  evidence:           { funnel_stage: 'MOFU', angle: 'ביטחון רגשי', metrics: { ctr: 0.021, cvr: 0.0095 } },
  target_insight_ids: ['a1000000-0000-0000-0000-000000000012'],
  recommended_action: { action: 'swap_landing_headline', detail: 'emotional-safety headline above the fold' },
  applied:            false,
  applied_item_id:    null,
  created_at:         '2026-06-01T00:00:00Z',
  ...patch,
});

const resolution: HypothesisResolution = {
  observed:       { 'arm-emotional': { ctr: 0.024 }, 'arm-price': { ctr: 0.013 } },
  verdict_reason: 'floor met, ratio 1.85 >= 1.3',
  resolved_by:    'floor_met',
};

const hypothesisRow = (patch: Partial<HypothesisEpisodeSource> = {}): HypothesisEpisodeSource => ({
  id:            'h1000000-0000-0000-0000-000000000001',
  client_id:     'c1000000-0000-0000-0000-000000000001',
  owner_user_id: 'u1000000-0000-0000-0000-000000000001',
  claim:         'emotional-safety angle beats price-led for parents 35-50',
  prediction: {
    metric: 'ctr', comparator: 'ratio_gte', value: 1.3,
    arm: 'arm-emotional', baseline_arm: 'arm-price', confidence: 0.7,
  },
  domain:      'angle',
  status:      'supported',
  resolution,
  insight_ids: ['a1000000-0000-0000-0000-000000000012'],
  resolved_at: '2026-06-10T00:00:00Z',
  ...patch,
});

describe('composeFromDiagnosis', () => {
  it('renders the four-part causal narrative with failed link + rationale essence', () => {
    const episode = composeFromDiagnosis(diagnosisRow());

    expect(episode.source_kind).toBe('diagnosis');
    expect(episode.episode_text).toMatch(/^Situation: /m);
    expect(episode.episode_text).toMatch(/^Action: /m);
    expect(episode.episode_text).toMatch(/^Outcome: failed link = funnel\./m);
    expect(episode.episode_text).toMatch(/^Lesson: funnel link broke — /m);
    expect(episode.episode_text).toContain('שבירת ריח בין המודעה לדף');
  });

  it('pulls funnel stage, angle and metrics into the situation from evidence jsonb', () => {
    const text = composeFromDiagnosis(diagnosisRow()).episode_text;
    expect(text).toContain('funnel stage MOFU');
    expect(text).toContain('angle "ביטחון רגשי"');
    expect(text).toContain('ctr=0.021');
    expect(text).toContain('cvr=0.0095');
  });

  it('falls back to caller-supplied context when evidence lacks it', () => {
    const row = diagnosisRow({ evidence: null });
    const text = composeFromDiagnosis(row, { funnelStage: 'BOFU', vertical: 'dental' }).episode_text;
    expect(text).toContain('funnel stage BOFU');
    expect(text).toContain('vertical: dental');
  });

  it('carries the recommended action essence and the source insight ids', () => {
    const episode = composeFromDiagnosis(diagnosisRow());
    expect(episode.episode_text).toContain('recommended: swap_landing_headline');
    expect(episode.insight_ids).toEqual(['a1000000-0000-0000-0000-000000000012']);
    expect(episode.metadata).toMatchObject({ failed_link: 'funnel', funnel_stage: 'MOFU' });
  });

  it('is deterministic — the same row always renders the same text', () => {
    expect(composeFromDiagnosis(diagnosisRow()).episode_text)
      .toBe(composeFromDiagnosis(diagnosisRow()).episode_text);
  });

  it('rejects an empty rationale with a typed error, never garbage text', () => {
    expect(() => composeFromDiagnosis(diagnosisRow({ rationale: '   ' })))
      .toThrow(EpisodeCompositionError);
  });

  it('rejects a row with no id', () => {
    expect(() => composeFromDiagnosis(diagnosisRow({ id: '' })))
      .toThrow(EpisodeCompositionError);
  });
});

describe('composeFromHypothesis', () => {
  it('renders claim, prediction, observed and verdict; lesson = verdict: claim', () => {
    const episode = composeFromHypothesis(hypothesisRow());

    expect(episode.source_kind).toBe('hypothesis');
    expect(episode.episode_text).toContain('claim: "emotional-safety angle beats price-led for parents 35-50"');
    expect(episode.episode_text).toContain('ctr ratio_gte 1.3 on arm "arm-emotional" (vs "arm-price") @confidence 0.7');
    expect(episode.episode_text).toContain('resolved by floor_met');
    expect(episode.episode_text).toMatch(/^Outcome: supported — observed /m);
    expect(episode.episode_text).toMatch(/^Lesson: supported: emotional-safety angle/m);
  });

  it('labels a killed hypothesis with its kill mode', () => {
    const episode = composeFromHypothesis(hypothesisRow({
      status:     'killed',
      resolution: { ...resolution, resolved_by: 'killed_mercy', verdict_reason: 'mercy rule' },
    }));
    expect(episode.episode_text).toMatch(/^Lesson: killed \(killed_mercy\): /m);
  });

  it('rejects unresolved statuses (open bets are not experience)', () => {
    expect(() => composeFromHypothesis(hypothesisRow({ status: 'open' })))
      .toThrow(EpisodeCompositionError);
    expect(() => composeFromHypothesis(hypothesisRow({ status: 'superseded' })))
      .toThrow(EpisodeCompositionError);
  });

  it('rejects an empty claim', () => {
    expect(() => composeFromHypothesis(hypothesisRow({ claim: '' })))
      .toThrow(EpisodeCompositionError);
  });
});

describe('outcomeOf — explicit per-kind rules', () => {
  it('maps hypothesis verdicts: supported→win, refuted/killed→loss, inconclusive→inconclusive', () => {
    expect(outcomeOf({ kind: 'hypothesis', row: hypothesisRow({ status: 'supported' }) })).toBe('win');
    expect(outcomeOf({ kind: 'hypothesis', row: hypothesisRow({ status: 'refuted' }) })).toBe('loss');
    expect(outcomeOf({ kind: 'hypothesis', row: hypothesisRow({ status: 'killed' }) })).toBe('loss');
    expect(outcomeOf({ kind: 'hypothesis', row: hypothesisRow({ status: 'inconclusive' }) })).toBe('inconclusive');
  });

  it('maps unresolved hypothesis statuses to unknown', () => {
    expect(outcomeOf({ kind: 'hypothesis', row: hypothesisRow({ status: 'open' }) })).toBe('unknown');
  });

  it('maps diagnoses: a concrete failed link is a loss; "none" is inconclusive', () => {
    expect(outcomeOf({ kind: 'diagnosis', row: diagnosisRow({ failed_link: 'funnel' }) })).toBe('loss');
    expect(outcomeOf({ kind: 'diagnosis', row: diagnosisRow({ failed_link: 'hook' }) })).toBe('loss');
    expect(outcomeOf({ kind: 'diagnosis', row: diagnosisRow({ failed_link: 'none' }) })).toBe('inconclusive');
  });

  it('keeps composed outcome consistent with outcomeOf', () => {
    expect(composeFromDiagnosis(diagnosisRow()).outcome).toBe('loss');
    expect(composeFromDiagnosis(diagnosisRow({ failed_link: 'none' })).outcome).toBe('inconclusive');
    expect(composeFromHypothesis(hypothesisRow()).outcome).toBe('win');
  });
});
