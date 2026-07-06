// tests/articles/topics.test.ts — P3-2 topic engine (deterministic core).
// Built to docs/ORGANIC-DEEP-RESEARCH.md §1.1: atom→query mapping, Hebrew
// morphological expansion, commercial-intent-first priority rule.

import { describe, expect, it } from 'vitest';
import type { ClientInsight, InsightLayer } from '@/lib/intelligence/types';
import {
  ATOM_QUERY_MAP,
  buildTopicBacklog,
  depersonalizeHe,
  deriveVocQuestions,
  expandHebrewTerm,
} from '@/lib/articles';

let seq = 0;
function atom(over: Partial<ClientInsight> & { kind: string; content: string }): ClientInsight {
  seq += 1;
  return {
    id:                `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    client_id:         'c0000000-0000-0000-0000-000000000001',
    owner_user_id:     'u0000000-0000-0000-0000-000000000001',
    layer:             (over.layer ?? 'customers') as InsightLayer,
    structured:        null,
    source:            'brief',
    source_ref:        null,
    confidence:        0.8,
    evidence_count:    1,
    status:            'active',
    superseded_by:     null,
    superseded_reason: null,
    first_seen_at:     '2026-01-01T00:00:00Z',
    updated_at:        '2026-01-01T00:00:00Z',
    ...over,
  } as ClientInsight;
}

const OFFER = atom({ layer: 'business', kind: 'core_offer', content: 'טיפול שורש', confidence: 0.9 });

describe('§1.1 atom→query mapping', () => {
  it('pain atom → depersonalized symptom/problem queries, informational TOFU', () => {
    const pain = atom({ kind: 'pain', content: 'כואב לי ללכת בבוקר' });
    const [topic] = buildTopicBacklog({ atoms: [pain] });

    expect(topic.intent).toBe('informational');
    expect(topic.content_type).toBe('tofu_article_faq');
    // first-person stripped: "כואב לי ללכת בבוקר" → "כואב ללכת בבוקר"
    expect(topic.query_patterns[0]).toBe('כואב ללכת בבוקר');
    expect(topic.atomIds).toEqual([pain.id]);
    expect(topic.title_he).toContain('כואב ללכת בבוקר');
    expect(topic.rationale_he).toContain('pain');
  });

  it('objection atom → "כמה עולה X ב[עיר]" / "X מחיר" / "האם כדאי X" commercial trio', () => {
    const objection = atom({ kind: 'objection', content: 'יקר לי' });
    const [topic] = buildTopicBacklog({
      atoms: [objection, OFFER],
      config: { city: 'חיפה' },
    });

    expect(topic.intent).toBe('commercial');
    expect(topic.content_type).toBe('mofu_pricing_comparison');
    expect(topic.query_patterns).toContain('כמה עולה טיפול שורש');
    expect(topic.query_patterns).toContain('כמה עולה טיפול שורש בחיפה');
    expect(topic.query_patterns).toContain('טיפול שורש מחיר');
    expect(topic.query_patterns).toContain('האם כדאי טיפול שורש');
    expect(topic.atomIds).toEqual([objection.id]);
    // business atoms are the information-gain injections, not topic sources
    expect(topic.injectionAtomIds).toEqual([OFFER.id]);
  });

  it('desire atom → outcome queries, transactional service-page angle', () => {
    const desire = atom({ kind: 'desire', content: 'חיוך בטוח לפני חתונה' });
    const [topic] = buildTopicBacklog({ atoms: [desire, OFFER] });

    expect(topic.intent).toBe('transactional');
    expect(topic.content_type).toBe('service_page_angle');
    expect(topic.query_patterns).toContain('חיוך בטוח לפני חתונה');
    expect(topic.query_patterns).toContain('טיפול שורש חיוך בטוח לפני חתונה');
    expect(topic.atomIds).toEqual([desire.id]);
  });

  it('alternative atom → "X או Y" + "ההבדל בין" comparison lane', () => {
    const alt = atom({ kind: 'alternative', content: 'עקירה' });
    const [topic] = buildTopicBacklog({ atoms: [alt, OFFER] });

    expect(topic.intent).toBe('comparison');
    expect(topic.query_patterns).toContain('טיפול שורש או עקירה');
    expect(topic.query_patterns).toContain('ההבדל בין טיפול שורש לעקירה');
  });

  it('proof atom → לפני אחרי / המלצות / ביקורות (E-E-A-T assets)', () => {
    const proof = atom({ kind: 'proof', content: 'תוצאות מדהימות' });
    const [topic] = buildTopicBacklog({ atoms: [proof, OFFER] });

    expect(topic.content_type).toBe('eeat_asset');
    expect(topic.query_patterns).toContain('טיפול שורש לפני אחרי');
    expect(topic.query_patterns).toContain('טיפול שורש המלצות');
    expect(topic.query_patterns).toContain('טיפול שורש ביקורות');
  });

  it('unspoken_want → question-form answer-first patterns (GEO material)', () => {
    const want = atom({ kind: 'unspoken_want', content: 'אפשר לעשות את זה בלי שאף אחד ידע' });
    const [topic] = buildTopicBacklog({ atoms: [want] });

    expect(topic.content_type).toBe('geo_faq_article');
    expect(topic.query_patterns.some((p) => p.startsWith('האם '))).toBe(true);
    expect(topic.query_patterns.some((p) => p.startsWith('איך '))).toBe(true);
  });

  it('business atoms and awareness/persona atoms generate no topics', () => {
    const topics = buildTopicBacklog({
      atoms: [
        OFFER,
        atom({ layer: 'business', kind: 'constraint', content: 'סגור בשבת' }),
        atom({ kind: 'awareness', content: 'מודעות לבעיה' }),
        atom({ kind: 'persona', content: 'אמהות עסוקות' }),
      ],
    });
    expect(topics).toEqual([]);
  });

  it('superseded atoms are ignored', () => {
    const dead = atom({ kind: 'pain', content: 'כאב ישן', status: 'superseded' });
    expect(buildTopicBacklog({ atoms: [dead] })).toEqual([]);
  });
});

describe('Hebrew morphological expansion (§1.1)', () => {
  it('applies ה/ב/ל/מ prefixes + masculine plural to a sample term', () => {
    const variants = expandHebrewTerm('טיפול');
    expect(variants).toContain('טיפול');
    expect(variants).toContain('הטיפול');
    expect(variants).toContain('בטיפול');
    expect(variants).toContain('לטיפול');
    expect(variants).toContain('מטיפול');
    expect(variants).toContain('טיפולים');
    expect(variants).toContain('הטיפולים');
  });

  it('produces feminine plural + construct forms for ה-final terms', () => {
    const variants = expandHebrewTerm('עוגה');
    expect(variants).toContain('עוגות');
    expect(variants).toContain('עוגת');
  });

  it('expands only the head word of a multi-word term, carrying the tail', () => {
    const variants = expandHebrewTerm('טיפול שורש');
    expect(variants).toContain('הטיפול שורש');
    expect(variants).toContain('טיפולים שורש');
    expect(variants.every((v) => v.endsWith(' שורש') || v === 'טיפול שורש' || v.includes('שורש'))).toBe(true);
  });

  it('one atom → dozens of query forms via the primary template', () => {
    const objection = atom({ kind: 'objection', content: 'יקר' });
    const [topic] = buildTopicBacklog({ atoms: [objection, OFFER], config: { city: 'חיפה' } });
    // trio + expansions of "כמה עולה {offer-variant}"
    expect(topic.query_patterns).toContain('כמה עולה הטיפול שורש');
    expect(topic.query_patterns.length).toBeGreaterThanOrEqual(10);
  });

  it('respects maxPatternsPerTopic', () => {
    const objection = atom({ kind: 'objection', content: 'יקר' });
    const [topic] = buildTopicBacklog({
      atoms: [objection, OFFER],
      config: { maxPatternsPerTopic: 5 },
    });
    expect(topic.query_patterns.length).toBeLessThanOrEqual(5);
  });
});

describe('commercial-intent-first priority rule (§1.1)', () => {
  it('a LOW-confidence commercial topic outranks a HIGH-confidence informational one', () => {
    const weakObjection = atom({ kind: 'objection', content: 'יקר', confidence: 0.1 });
    const strongPain    = atom({ kind: 'pain', content: 'כאב חזק בשן', confidence: 0.99 });
    const topics = buildTopicBacklog({ atoms: [strongPain, weakObjection, OFFER] });

    expect(topics[0].intent).toBe('commercial');
    expect(topics[1].intent).toBe('informational');
    expect(topics[0].score).toBeGreaterThan(topics[1].score);
  });

  it('full ordering: commercial > transactional > comparison > informational at equal confidence', () => {
    const topics = buildTopicBacklog({
      atoms: [
        atom({ kind: 'pain', content: 'כאב בשן', confidence: 0.7 }),
        atom({ kind: 'alternative', content: 'עקירה', confidence: 0.7 }),
        atom({ kind: 'desire', content: 'חיוך יפה', confidence: 0.7 }),
        atom({ kind: 'objection', content: 'יקר', confidence: 0.7 }),
        OFFER,
      ],
    });
    expect(topics.map((t) => t.intent)).toEqual([
      'commercial', 'transactional', 'comparison', 'informational',
    ]);
  });

  it('the intent-weight bands cannot cross (informational max < commercial-group min)', () => {
    const informationalMax = ATOM_QUERY_MAP.unspoken_want.weight * 1.0 + 0.05; // conf 1 + VoC boost
    const commercialGroupMin = Math.min(
      ATOM_QUERY_MAP.objection.weight,
      ATOM_QUERY_MAP.desire.weight,
      ATOM_QUERY_MAP.alternative.weight,
      ATOM_QUERY_MAP.proof.weight,
    ) * 0.5; // conf 0
    expect(informationalMax).toBeLessThan(commercialGroupMin);
  });
});

describe('confidence weighting', () => {
  it('within the same intent, higher-confidence atoms outrank', () => {
    const weak   = atom({ kind: 'pain', content: 'כאב קל בבוקר', confidence: 0.3 });
    const strong = atom({ kind: 'pain', content: 'כאב חד בלילה', confidence: 0.95 });
    const topics = buildTopicBacklog({ atoms: [weak, strong] });

    expect(topics[0].atomIds).toEqual([strong.id]);
    expect(topics[1].atomIds).toEqual([weak.id]);
    expect(topics[0].score).toBeGreaterThan(topics[1].score);
  });
});

describe('VoC questions (real customer language)', () => {
  it('deriveVocQuestions keeps only question-shaped quotes', () => {
    const qs = deriveVocQuestions([
      { id: 'q1', quote: 'כמה עולה טיפול שורש?' },
      { id: 'q2', quote: 'האם זה כואב' },
      { id: 'q3', quote: 'שירות מעולה, ממליץ בחום' },
    ]);
    expect(qs.map((q) => q.quoteId)).toEqual(['q1', 'q2']);
  });

  it('a question matching an existing topic boosts it and injects the verbatim pattern', () => {
    const objection = atom({ kind: 'objection', content: 'יקר', confidence: 0.6 });
    const base    = buildTopicBacklog({ atoms: [objection, OFFER] });
    const boosted = buildTopicBacklog({
      atoms: [objection, OFFER],
      vocQuestions: [{ text: 'כמה עולה טיפול שורש?', quoteId: 'q1' }],
    });

    expect(boosted[0].voc_backed).toBe(true);
    expect(boosted[0].query_patterns[0]).toBe('כמה עולה טיפול שורש?');
    expect(boosted[0].score).toBeGreaterThan(base[0].score);
    expect(boosted).toHaveLength(1); // corroborated, not duplicated
  });

  it('an unmatched commercial question becomes its own commercial VoC topic', () => {
    const [topic] = buildTopicBacklog({
      atoms: [],
      vocQuestions: [{ text: 'כמה עולה הלבנת שיניים?', quoteId: 'q9' }],
    });
    expect(topic.intent).toBe('commercial');
    expect(topic.voc_backed).toBe(true);
    expect(topic.confidence).toBe(0.5);
    expect(topic.atomIds).toEqual([]);
    expect(topic.query_patterns).toContain('כמה עולה הלבנת שיניים?');
  });

  it('an unmatched non-commercial question becomes an informational GEO topic', () => {
    const [topic] = buildTopicBacklog({
      atoms: [],
      vocQuestions: [{ text: 'איך מתכוננים לטיפול ראשון?' }],
    });
    expect(topic.intent).toBe('informational');
    expect(topic.content_type).toBe('geo_faq_article');
  });
});

describe('determinism + helpers', () => {
  it('same inputs → same backlog (pure function)', () => {
    const atoms = [
      atom({ kind: 'objection', content: 'יקר' }),
      atom({ kind: 'pain', content: 'כאב בשן' }),
      OFFER,
    ];
    const a = buildTopicBacklog({ atoms });
    const b = buildTopicBacklog({ atoms });
    expect(a).toEqual(b);
  });

  it('depersonalizeHe strips first-person tokens and punctuation', () => {
    expect(depersonalizeHe('כואב לי ללכת')).toBe('כואב ללכת');
    expect(depersonalizeHe('אני מפחדת שזה יכאב לי!')).toBe('מפחדת שזה יכאב');
  });
});
