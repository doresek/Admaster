// Realistic Hebrew atom fixtures for a DENTAL CLINIC client — the fixture
// brain the synthesis/funnel tests project from. Contents are crafted so the
// deterministic clustering/assignment decisions are hand-checkable:
// contentMatches (word-token Jaccard ≥ 0.5, or containment) drives clustering,
// and the looser 0.25 pass drives proof→pillar assignment — the per-fixture
// comments below spell out the expected token overlaps.

import type { ClientInsight } from '@/lib/intelligence/types';

export const CLIENT_ID = 'client-dental-1';
export const OWNER_ID = 'owner-1';

let seq = 0;
export function atom(overrides: Partial<ClientInsight>): ClientInsight {
  seq += 1;
  return {
    id:                `atom-${String(seq).padStart(2, '0')}`,
    client_id:         CLIENT_ID,
    owner_user_id:     OWNER_ID,
    layer:             'customers',
    kind:              'desire',
    content:           '',
    structured:        null,
    source:            'brief',
    source_ref:        null,
    confidence:        0.5,
    evidence_count:    1,
    status:            'active',
    superseded_by:     null,
    superseded_reason: null,
    first_seen_at:     '2026-06-01T00:00:00Z',
    updated_at:        '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

export function resetAtomSeq(): void {
  seq = 0;
}

/** Named atoms so tests can assert exact anchor/assignment decisions. */
export interface DentalFixtures {
  translation:  ClientInsight; // the top translation atom → core promise
  angle:        ClientInsight; // fallback #1 for the promise
  usp:          ClientInsight; // fallback #2 for the promise
  desire1:      ClientInsight; // desire cluster anchor
  desire2:      ClientInsight; // clusters WITH desire1 (Jaccard 4/6 ≈ 0.67)
  desire3:      ClientInsight; // a DISTINCT desire (no token overlap with desire1)
  objPrice:     ClientInsight; // top objection (price)
  objPain:      ClientInsight; // second objection (pain-fear) — distinct cluster
  mechanism:    ClientInsight; // real_solution → mechanism pillar anchor
  painSolved:   ClientInsight; // pain_solved → mechanism pillar member
  proofSmiles:  ClientInsight; // proof → desire pillar (shares בביטחון/בלי/להתבייש with desire1)
  proofPayment: ClientInsight; // proof → objection pillar (shares השתלת/שיניים/יקר with objPrice)
  proofAward:   ClientInsight; // proof matching NOTHING → unassigned (unused ammunition)
  persona:      ClientInsight; // identity pillar member
  unspokenWant: ClientInsight; // identity pillar member
  awareness:    ClientInsight; // problem-aware — drives funnel length
  pain:         ClientInsight; // funnel content-node belief
}

export function dentalFixtures(): DentalFixtures {
  resetAtomSeq();
  return {
    translation: atom({
      layer: 'bridge', kind: 'value_translation', confidence: 0.9,
      content: 'ביטחון בחיוך → ביטחון בחיים',
    }),
    angle: atom({
      layer: 'bridge', kind: 'angle', confidence: 0.8,
      content: 'החיוך החדש שלך מחכה לך — בלי בושה ובלי כאב',
    }),
    usp: atom({
      layer: 'business', kind: 'real_usp', confidence: 0.85,
      content: 'המרפאה היחידה באזור עם שיקום מלא ביום אחד',
    }),
    // desire cluster: desire1 tokens {לחייך,בביטחון,בלי,להתבייש};
    // desire2 tokens {לחייך,בביטחון,בלי,להתבייש,מול,המצלמה} → inter 4 / union 6 = 0.67 ≥ 0.5 → SAME cluster.
    desire1: atom({
      kind: 'desire', confidence: 0.85,
      content: 'לחייך בביטחון בלי להתבייש',
    }),
    desire2: atom({
      kind: 'aspiration', confidence: 0.7,
      content: 'לחייך בביטחון בלי להתבייש מול המצלמה',
    }),
    // desire3 shares ZERO tokens with desire1 → its own (lower-sum) cluster.
    desire3: atom({
      kind: 'dream', confidence: 0.6,
      content: 'שיניים לבנות ויפות כמו של סלבס',
    }),
    objPrice: atom({
      kind: 'objection', confidence: 0.8,
      content: 'יקר לי — כמה עולה השתלת שיניים',
    }),
    // objPain vs objPrice share only {שיניים} → 1/11 ≈ 0.09 → distinct clusters.
    objPain: atom({
      kind: 'objection', confidence: 0.75,
      content: 'פחד ממכות חשמל וכאב בטיפול שיניים',
    }),
    mechanism: atom({
      layer: 'business', kind: 'real_solution', confidence: 0.8,
      content: 'השתלות ביום אחד בטכנולוגיה דיגיטלית ללא כאב',
    }),
    painSolved: atom({
      layer: 'business', kind: 'pain_solved', confidence: 0.65,
      content: 'פחד ממרפאות שיניים נפתר בהרדמה מלאה',
    }),
    // proofSmiles vs desire1: inter {בביטחון,בלי,להתבייש} 3 / union 10 = 0.30 —
    // fails strict (0.5) but passes loose (0.25) on BOTH desire members →
    // desire pillar wins the loose count 2:0. Hand-checked: a testimonial about
    // customers smiling confidently argues the DESIRE, not the mechanism.
    proofSmiles: atom({
      layer: 'business', kind: 'proof', confidence: 0.7,
      content: 'המלצות של 400 לקוחות מרוצים שחייכו בביטחון בלי להתבייש',
    }),
    // proofPayment vs objPrice: inter {השתלת,שיניים,יקר} 3 / union 12 = 0.25 —
    // loose match on the price objection only. Hand-checked: a payment-split
    // receipt is ammunition for the PRICE objection pillar.
    proofPayment: atom({
      layer: 'business', kind: 'proof', confidence: 0.65,
      content: 'השתלת שיניים אצלנו לא יקר — פריסה עד 12 תשלומים',
    }),
    // proofAward shares no meaningful tokens with any pillar member →
    // UNASSIGNED (the skill's "unused ammunition" flag must fire).
    proofAward: atom({
      layer: 'business', kind: 'proof', confidence: 0.6,
      content: 'זכינו בפרס איכות מטעם לשכת המסחר 2024',
    }),
    persona: atom({
      kind: 'persona', confidence: 0.75,
      content: 'הורים עסוקים בגיל 35-50 שדוחים טיפולי שיניים',
    }),
    unspokenWant: atom({
      kind: 'unspoken_want', confidence: 0.55,
      content: 'להרגיש שייכים לאנשים המצליחים שנראים טוב',
    }),
    awareness: atom({
      kind: 'awareness', confidence: 0.7,
      content: 'מודע לבעיה — דוחה את הטיפול כבר שנים',
    }),
    pain: atom({
      kind: 'pain', confidence: 0.78,
      content: 'בושה לחייך בפגישות עבודה ובצילומים',
    }),
  };
}

/** The full fixture set as an array (insertion order ≠ confidence order on purpose). */
export function allAtoms(f: DentalFixtures = dentalFixtures()): ClientInsight[] {
  return [
    f.translation, f.angle, f.usp,
    f.desire1, f.desire2, f.desire3,
    f.objPrice, f.objPain,
    f.mechanism, f.painSolved,
    f.proofSmiles, f.proofPayment, f.proofAward,
    f.persona, f.unspokenWant,
    f.awareness, f.pain,
  ];
}
