// lib/voc/reconcile — quotes → atoms through the REAL lifecycle engine
// (contentMatches / claimSignal / applyLearningSignal / createInsight run for
// real against the in-memory supabase), proving:
//   • corroboration moves confidence by the lifecycle's math, not ours
//   • target_hint bridges quote-language → atom-abstraction when direct fuzzy
//     matching (rightly) fails
//   • cross-document recurrence bumps signal weight (0.25 → 0.4)
//   • no-match + atom-worthy creates a verbatim-content atom at 0.35
//   • negative quotes are contradiction EVIDENCE (weakening signal) and
//     high-confidence contradictions surface to the owner
//   • every quote gets its atom_action stamped

import { describe, expect, it } from 'vitest';
import { contentMatches } from '@/lib/intelligence/lifecycle';
import { reconcileQuotes } from '../reconcile';
import type { ReconcileQuoteInput } from '../types';
import { mockSupabase, type MockRow } from './mock-supabase';

const CLIENT = 'client-1';
const OWNER  = 'owner-1';

let atomSeq = 0;
function makeAtom(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: `atom-${++atomSeq}`,
    client_id: CLIENT,
    owner_user_id: OWNER,
    layer: 'customers',
    kind: 'pain',
    content: '',
    structured: null,
    source: 'brief',
    source_ref: null,
    confidence: 0.5,
    evidence_count: 1,
    status: 'active',
    superseded_by: null,
    superseded_reason: null,
    first_seen_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

let quoteSeq = 0;
function makeQuote(overrides: Partial<ReconcileQuoteInput> = {}): ReconcileQuoteInput {
  return {
    id: `q-${++quoteSeq}`,
    document_id: 'doc-1',
    quote: '',
    extractable: 'pain',
    polarity: 'positive',
    segment_tags: {},
    ...overrides,
  };
}

/** Harness with the tables reconcile touches, plus seeded voc_quotes rows. */
function harness(atoms: MockRow[], quotes: ReconcileQuoteInput[], priorQuotes: MockRow[] = []) {
  const sb = mockSupabase();
  sb.seed('client_insights', atoms);
  sb.seed('learning_signals', []);
  sb.seed('insight_events', []);
  sb.seed('voc_quotes', [
    ...quotes.map((q) => ({
      id: q.id, document_id: q.document_id, client_id: CLIENT, owner_user_id: OWNER,
      quote: q.quote, extractable: q.extractable, polarity: q.polarity,
      segment_tags: q.segment_tags, atom_action: null, funnel_fit: null,
      created_at: '2026-07-01T00:00:00Z',
    })),
    ...priorQuotes,
  ]);
  return sb;
}

describe('reconcileQuotes — corroboration', () => {
  it('matched quote emits a claimed voc_evidence signal and moves the atom via the lifecycle', async () => {
    const atom = makeAtom({ content: 'פחדתי שיכאב', kind: 'pain', confidence: 0.5, evidence_count: 1 });
    const quote = makeQuote({ quote: 'פחדתי שיכאב לי', extractable: 'pain' });
    const sb = harness([atom], [quote]);

    const result = await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [quote] });

    expect(result.summary).toEqual({ corroborated: 1, created: 0, contradicted: 0, skipped: 0 });
    expect(result.outcomes[0].action).toMatchObject({ action: 'corroborated', insight_id: atom.id });
    expect(result.outcomes[0].action.signal_id).toBeTruthy();

    // The signal row: voc_evidence, single-quote weight, claimed (processed).
    const signals = sb.rows('learning_signals');
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      insight_id: atom.id, signal_type: 'voc_evidence', polarity: 'positive',
      weight: 0.25, processed: true,
    });
    expect(signals[0].metrics).toEqual({ voc_quote_id: quote.id, document_id: 'doc-1' });

    // Lifecycle math: 0.5 + 0.12*0.25 = 0.53, evidence_count++.
    const updated = sb.rows('client_insights')[0];
    expect(updated.confidence).toBe(0.53);
    expect(updated.evidence_count).toBe(2);

    // Audit + traceability.
    expect(sb.rows('insight_events').some((e) => e.event === 'corroborated')).toBe(true);
    const stamped = sb.rows('voc_quotes').find((r) => r.id === quote.id);
    expect(stamped?.atom_action).toMatchObject({ action: 'corroborated', insight_id: atom.id });
  });

  it('target_hint bridges quote language to the atom when direct matching fails', async () => {
    const atom = makeAtom({ content: 'כואב לי ללכת', kind: 'pain' });
    // Sanity: the raw quote does NOT fuzzy-match the atom — the hint is load-bearing.
    expect(contentMatches('כואב לי ללכת', 'הכאב ברגל שיגע אותי')).toBe(false);

    const quote = makeQuote({ quote: 'הכאב ברגל שיגע אותי', extractable: 'pain', target_hint: 'כואב לי ללכת' });
    const sb = harness([atom], [quote]);

    const result = await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [quote] });
    expect(result.summary.corroborated).toBe(1);
    expect(result.outcomes[0].action).toMatchObject({ action: 'corroborated', insight_id: atom.id });
  });

  it('a quote matching only a DIFFERENT extractable kind does not corroborate it', async () => {
    // An objection atom exists with matching content, but the quote is a pain —
    // pain only targets kind 'pain', so this creates a new pain atom instead.
    const atom = makeAtom({ content: 'פחדתי שיכאב', kind: 'objection' });
    const quote = makeQuote({ quote: 'פחדתי שיכאב', extractable: 'pain' });
    const sb = harness([atom], [quote]);

    const result = await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [quote] });
    expect(result.summary).toEqual({ corroborated: 0, created: 1, contradicted: 0, skipped: 0 });
  });
});

describe('reconcileQuotes — weight policy (voc-mining §3)', () => {
  it('bumps weight to 0.4 when the same content arrives from two documents in one batch', async () => {
    const atom = makeAtom({ content: 'כמה זה עולה', kind: 'objection' });
    const q1 = makeQuote({ quote: 'כמה זה עולה?', extractable: 'objection', document_id: 'doc-A' });
    const q2 = makeQuote({ quote: 'כמה זה עולה בערך?', extractable: 'objection', document_id: 'doc-B' });
    const sb = harness([atom], [q1, q2]);

    await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [q1, q2] });

    const weights = sb.rows('learning_signals').map((s) => s.weight);
    expect(weights).toEqual([0.4, 0.4]);
  });

  it('bumps weight to 0.4 when a PRIOR document already holds the same content', async () => {
    const atom = makeAtom({ content: 'כמה זה עולה', kind: 'objection' });
    const quote = makeQuote({ quote: 'כמה זה עולה?', extractable: 'objection', document_id: 'doc-B' });
    const prior: MockRow = {
      id: 'q-prior', document_id: 'doc-OLD', client_id: CLIENT, owner_user_id: OWNER,
      quote: 'כמה זה עולה אצלכם?', extractable: 'objection', polarity: 'positive',
      segment_tags: {}, atom_action: null, funnel_fit: null, created_at: '2026-06-01T00:00:00Z',
    };
    const sb = harness([atom], [quote], [prior]);

    await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [quote] });
    expect(sb.rows('learning_signals')[0].weight).toBe(0.4);
  });

  it('keeps the single-quote weight 0.25 for same-document recurrence', async () => {
    const atom = makeAtom({ content: 'אין חניה בסביבה', kind: 'objection' });
    const q1 = makeQuote({ quote: 'אין חניה בסביבה', extractable: 'objection', document_id: 'doc-A' });
    const q2 = makeQuote({ quote: 'אין חניה בסביבה בכלל', extractable: 'objection', document_id: 'doc-A' });
    const sb = harness([atom], [q1, q2]);

    await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [q1, q2] });
    expect(sb.rows('learning_signals').map((s) => s.weight)).toEqual([0.25, 0.25]);
  });
});

describe('reconcileQuotes — new atoms (no match + atom-worthy)', () => {
  it('creates a verbatim-content atom at 0.35 with a voc source_ref', async () => {
    const quote = makeQuote({ quote: 'כמה זה עולה?', extractable: 'objection', segment_tags: { role: 'lead' } });
    const sb = harness([], [quote]);

    const result = await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [quote] });

    expect(result.summary.created).toBe(1);
    const created = sb.rows('client_insights')[0];
    expect(created).toMatchObject({
      layer: 'customers', kind: 'objection',
      content: 'כמה זה עולה?',       // quote first, abstraction second (§3)
      confidence: 0.35,               // seed range per §3
      source: 'user_signal',          // 'voc' is not in the 028 CHECK — see module note
      evidence_count: 1,
      status: 'active',
    });
    expect(created.source_ref).toEqual({ voc: true, voc_quote_id: quote.id, document_id: 'doc-1' });
    expect(result.outcomes[0].action).toMatchObject({ action: 'created', insight_id: created.id });
  });

  it("creates 'alternative' atoms with the free-form kind on the customers layer", async () => {
    const quote = makeQuote({ quote: 'במקום ללכת למרפאה הגדולה בקניון', extractable: 'alternative' });
    const sb = harness([], [quote]);

    await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [quote] });
    expect(sb.rows('client_insights')[0]).toMatchObject({ layer: 'customers', kind: 'alternative' });
  });

  it('a later quote in the same batch corroborates the atom created moments earlier', async () => {
    const q1 = makeQuote({ quote: 'פחדתי שיכאב', extractable: 'pain' });
    const q2 = makeQuote({ quote: 'פחדתי שיכאב לי', extractable: 'pain' });
    const sb = harness([], [q1, q2]);

    const result = await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [q1, q2] });
    expect(result.summary).toEqual({ corroborated: 1, created: 1, contradicted: 0, skipped: 0 });
  });
});

describe('reconcileQuotes — contradictions (the feature, not a skip)', () => {
  it('negative quote against a HIGH-confidence atom weakens it AND surfaces to the owner', async () => {
    const atom = makeAtom({ content: 'הלקוחות מרגישים שאין לחץ מכירתי', kind: 'desire', confidence: 0.75 });
    const quote = makeQuote({
      quote: 'הרגשתי לחץ מכירתי מהרגע הראשון', extractable: 'desire',
      polarity: 'negative', target_hint: 'הלקוחות מרגישים שאין לחץ מכירתי',
    });
    const sb = harness([atom], [quote]);

    const result = await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [quote] });

    expect(result.summary.contradicted).toBe(1);
    expect(sb.rows('learning_signals')[0]).toMatchObject({ polarity: 'negative', weight: 0.25 });
    // Weakened via the lifecycle: 0.75 - 0.12*0.25 = 0.72.
    expect(sb.rows('client_insights')[0].confidence).toBe(0.72);
    expect(result.owner_surfacings).toEqual([
      expect.objectContaining({
        kind: 'contradiction', insight_id: atom.id, quote_id: quote.id, prior_confidence: 0.75,
      }),
    ]);
    const stamped = sb.rows('voc_quotes').find((r) => r.id === quote.id);
    expect(stamped?.atom_action).toMatchObject({ action: 'contradicted', insight_id: atom.id });
  });

  it('negative quote against a LOW-confidence atom weakens silently (no surfacing)', async () => {
    const atom = makeAtom({ content: 'אין לחץ מכירתי', kind: 'desire', confidence: 0.4 });
    const quote = makeQuote({
      quote: 'היה לחץ מכירתי', extractable: 'desire', polarity: 'negative',
      target_hint: 'אין לחץ מכירתי',
    });
    const sb = harness([atom], [quote]);

    const result = await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [quote] });
    expect(result.summary.contradicted).toBe(1);
    expect(result.owner_surfacings).toHaveLength(0);
  });
});

describe('reconcileQuotes — enrichment and skips', () => {
  it('a matched trigger corroborates AND appends to structured.triggers (deduped)', async () => {
    const atom = makeAtom({ content: 'הורים מגיעים כשהילד מתלונן על כאב', kind: 'persona', structured: { rationale: 'x' } });
    const quote = makeQuote({
      quote: 'אחרי שהילד אמר לי שכואב לו', extractable: 'trigger',
      target_hint: 'הורים מגיעים כשהילד מתלונן על כאב',
    });
    const sb = harness([atom], [quote]);

    const result = await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [quote] });
    expect(result.summary.corroborated).toBe(1);
    const updated = sb.rows('client_insights')[0];
    expect(updated.structured).toMatchObject({ triggers: ['אחרי שהילד אמר לי שכואב לו'] });
  });

  it('a matched identity phrase enriches persona structured.identity_phrases', async () => {
    const atom = makeAtom({ content: 'אמהות באזור ראשון לציון', kind: 'persona' });
    const quote = makeQuote({
      quote: 'אמא של שלושה', extractable: 'identity',
      target_hint: 'אמהות באזור ראשון לציון',
    });
    const sb = harness([atom], [quote]);

    await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [quote] });
    expect(sb.rows('client_insights')[0].structured).toMatchObject({ identity_phrases: ['אמא של שלושה'] });
  });

  it('unmatched proof is SKIPPED (permission-pending), not auto-created', async () => {
    const quote = makeQuote({ quote: 'ענו לי תוך דקה', extractable: 'proof' });
    const sb = harness([], [quote]);

    const result = await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [quote] });
    expect(result.summary.skipped).toBe(1);
    expect(sb.rows('client_insights')).toHaveLength(0);
    expect(result.outcomes[0].action.reason).toContain('permission');
  });

  it('unmatched trigger/identity are skipped with a reason', async () => {
    const quotes = [
      makeQuote({ quote: 'אחרי החתונה של אחותי', extractable: 'trigger' }),
      makeQuote({ quote: 'בן אדם של בוקר', extractable: 'identity' }),
    ];
    const sb = harness([], quotes);

    const result = await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes });
    expect(result.summary.skipped).toBe(2);
    for (const o of result.outcomes) expect(o.action.action).toBe('skipped');
  });
});

describe('reconcileQuotes — failure containment', () => {
  it('a failed signal insert yields a typed skip and leaves the atom untouched', async () => {
    const atom = makeAtom({ content: 'פחדתי שיכאב', kind: 'pain', confidence: 0.5 });
    const quote = makeQuote({ quote: 'פחדתי שיכאב', extractable: 'pain' });
    const sb = harness([atom], [quote]);
    sb.failOn.add('insert:learning_signals');

    const result = await reconcileQuotes(sb.client, { clientId: CLIENT, ownerUserId: OWNER, quotes: [quote] });
    expect(result.summary.skipped).toBe(1);
    expect(result.outcomes[0].action.reason).toContain('signal_insert_failed');
    expect(sb.rows('client_insights')[0].confidence).toBe(0.5);
  });
});
