// Tests for lib/intelligence/lifecycle.ts — the pure confidence policy
// (reduceSignal, contentMatches) and the reconcile apply path.
import { describe, it, expect } from 'vitest';
import {
  reduceSignal,
  contentMatches,
  reconcileCandidates,
  applyLearningSignal,
} from '@/lib/intelligence/lifecycle';
import { CONFIDENCE, type ClientInsight, type InsightCandidate } from '@/lib/intelligence/types';
import { makeFakeDb } from './fake-admin';

const base = (over: Partial<ClientInsight> = {}): ClientInsight => ({
  id: 'i1', client_id: 'c1', owner_user_id: 'u1',
  layer: 'business', kind: 'real_usp', content: 'x',
  structured: null, source: 'brief', source_ref: null,
  confidence: CONFIDENCE.START, evidence_count: 1, status: 'active',
  superseded_by: null, superseded_reason: null,
  first_seen_at: 't', updated_at: 't', ...over,
});

describe('reduceSignal (pure policy)', () => {
  it('corroborates: +0.12*weight (capped 0.99) and bumps evidence_count', () => {
    const r = reduceSignal({ confidence: 0.5, evidence_count: 1 }, { polarity: 'positive', weight: 1 });
    expect(r.action).toBe('corroborate');
    expect(r.confidence).toBeCloseTo(0.62, 5);
    expect(r.evidence_count).toBe(2);
  });

  it('corroboration caps at 0.99', () => {
    const r = reduceSignal({ confidence: 0.95, evidence_count: 3 }, { polarity: 'positive', weight: 1 });
    expect(r.confidence).toBe(0.99);
  });

  it('weakens (non-decisive): -0.12*weight, evidence_count unchanged, action weaken', () => {
    const r = reduceSignal({ confidence: 0.5, evidence_count: 2 }, { polarity: 'negative', weight: 0.5 });
    expect(r.action).toBe('weaken');
    expect(r.confidence).toBeCloseTo(0.44, 5);
    expect(r.evidence_count).toBe(2);
  });

  it('supersedes on a DECISIVE negative (weight >= 0.70)', () => {
    const r = reduceSignal({ confidence: 0.8, evidence_count: 5 }, { polarity: 'negative', weight: 0.7 });
    expect(r.action).toBe('supersede');
  });

  it('supersedes when confidence would fall below the 0.15 floor', () => {
    const r = reduceSignal({ confidence: 0.2, evidence_count: 1 }, { polarity: 'negative', weight: 0.5 });
    // raw = 0.2 - 0.06 = 0.14 < 0.15 -> decisive
    expect(r.action).toBe('supersede');
    expect(r.confidence).toBeCloseTo(0.14, 5);
  });

  it('confidence never drops below MIN (0.05)', () => {
    const r = reduceSignal({ confidence: 0.06, evidence_count: 1 }, { polarity: 'negative', weight: 1 });
    expect(r.confidence).toBe(CONFIDENCE.MIN);
    expect(r.action).toBe('supersede');
  });
});

describe('contentMatches (pure fuzzy)', () => {
  it('exact and containment match', () => {
    expect(contentMatches('המחיר גבוה מדי', 'המחיר גבוה מדי')).toBe(true);
    expect(contentMatches('הלקוח חושש שהמחיר גבוה מדי בשבילו', 'המחיר גבוה')).toBe(true);
  });
  it('token-overlap above threshold matches; unrelated does not', () => {
    expect(contentMatches('אין לי זמן להתאמן בכלל', 'אין לי זמן להתאמן')).toBe(true);
    expect(contentMatches('המחיר גבוה מדי', 'אין מספיק זמן')).toBe(false);
  });
});

describe('reconcileCandidates (apply path)', () => {
  it('creates a brand-new atom (+ created event) when there is no match', async () => {
    const db = makeFakeDb({ insights: [] });
    const candidates: InsightCandidate[] = [
      { layer: 'customers', kind: 'pain', content: 'אין לי זמן', confidence: 0.7, rationale: 'מהבריף' },
    ];
    const res = await reconcileCandidates(db.admin, 'c1', 'u1', candidates);
    expect(res).toEqual({ created: 1, corroborated: 0, superseded: 0 });
    expect(db.client_insights).toHaveLength(1);
    expect(db.client_insights[0].kind).toBe('pain');
    expect(db.client_insights[0].structured).toEqual({ rationale: 'מהבריף' });
    const created = db.insight_events.filter((e) => e.event === 'created');
    expect(created).toHaveLength(1);
  });

  it('corroborates a matching active atom (+ corroborated event, +confidence)', async () => {
    const db = makeFakeDb({
      insights: [base({ id: 'p1', layer: 'customers', kind: 'pain', content: 'אין לי זמן להתאמן', confidence: 0.5, evidence_count: 1 })],
    });
    const candidates: InsightCandidate[] = [
      { layer: 'customers', kind: 'pain', content: 'אין לי זמן להתאמן בכלל', confidence: 1, rationale: 'חוזר בבריף' },
    ];
    const res = await reconcileCandidates(db.admin, 'c1', 'u1', candidates);
    expect(res).toEqual({ created: 0, corroborated: 1, superseded: 0 });
    expect(db.client_insights).toHaveLength(1);
    expect(db.client_insights[0].confidence).toBeCloseTo(0.62, 5);
    expect(db.client_insights[0].evidence_count).toBe(2);
    expect(db.insight_events.some((e) => e.event === 'corroborated')).toBe(true);
  });

  it('decisive contradiction in a singleton slot: creates corrected + supersedes old (+events)', async () => {
    const db = makeFakeDb({
      insights: [base({ id: 'usp1', layer: 'business', kind: 'real_usp', content: 'המהירות שלנו', confidence: 0.6 })],
    });
    const candidates: InsightCandidate[] = [
      { layer: 'business', kind: 'real_usp', content: 'הליווי האישי הצמוד הוא הבידול', confidence: 0.9, rationale: 'הבריף מדגיש ליווי' },
    ];
    const res = await reconcileCandidates(db.admin, 'c1', 'u1', candidates);
    expect(res).toEqual({ created: 1, corroborated: 0, superseded: 1 });

    const old = db.client_insights.find((i) => i.id === 'usp1');
    expect(old.status).toBe('superseded');
    expect(old.superseded_by).toBeTruthy();
    expect(old.superseded_reason).toContain('real_usp');

    const corrected = db.client_insights.find((i) => i.id !== 'usp1');
    expect(corrected.content).toContain('הליווי האישי');
    expect(corrected.status).toBe('active');

    expect(db.insight_events.some((e) => e.event === 'created')).toBe(true);
    expect(db.insight_events.some((e) => e.event === 'superseded')).toBe(true);
  });

  it('list-like kind with different content just creates a second atom (no supersede)', async () => {
    const db = makeFakeDb({
      insights: [base({ id: 'pa', layer: 'customers', kind: 'pain', content: 'המחיר גבוה', confidence: 0.6 })],
    });
    const candidates: InsightCandidate[] = [
      { layer: 'customers', kind: 'pain', content: 'אין לי זמן בכלל', confidence: 0.9, rationale: 'כאב נוסף' },
    ];
    const res = await reconcileCandidates(db.admin, 'c1', 'u1', candidates);
    expect(res).toEqual({ created: 1, corroborated: 0, superseded: 0 });
    expect(db.client_insights.filter((i) => i.status === 'active')).toHaveLength(2);
  });
});

describe('applyLearningSignal (Part-2 entry point)', () => {
  it('refutes the atom on a decisive negative signal', async () => {
    const db = makeFakeDb({ insights: [base({ id: 'x1', confidence: 0.8 })] });
    const insight = db.client_insights[0] as ClientInsight;
    const out = await applyLearningSignal(db.admin, insight, { polarity: 'negative', weight: 0.8, reason: 'ads tanked' });
    expect(out).toBeNull();
    expect(db.client_insights[0].status).toBe('refuted');
    expect(db.insight_events.some((e) => e.event === 'refuted')).toBe(true);
  });

  it('corroborates and returns the updated atom on a positive signal', async () => {
    const db = makeFakeDb({ insights: [base({ id: 'x2', confidence: 0.5, evidence_count: 1 })] });
    const insight = db.client_insights[0] as ClientInsight;
    const out = await applyLearningSignal(db.admin, insight, { polarity: 'positive', weight: 1, signalId: 'sig-9' });
    expect(out?.confidence).toBeCloseTo(0.62, 5);
    expect(db.client_insights[0].evidence_count).toBe(2);
    expect(db.insight_events.some((e) => e.event === 'corroborated' && e.signal_id === 'sig-9')).toBe(true);
  });
});
