// Realistic Hebrew dental-market fixture for the C-09 tests.
//
// THE MARKET (hand-argued; NOW = 2026-07-01T00:00:00Z):
//   E1 מרפאת שיניים ד"ר כהן (direct)  — two VETERAN price ads + one fresh proof ad
//   E2 סמייל קליניק תל אביב (direct)  — a VETERAN price ad, a VETERAN authority
//                                        ad, and a CHURNED urgency ad (ran 19d, died)
//   E3 אינוויזליין סנטר (category)    — young/standard ads only (speed + price),
//                                        plus a long-lived RETIRED proof ad
//                                        (inactive but 92d lifespan → NOT churn)
//
// EXPECTED COVERAGE MAP (skill §3, argued cell by cell):
//   price_deal        E1 ██ (2 veterans)  E2 ██ (veteran)  E3 █ (37d active)
//                     → 2 heavy ⇒ SATURATED. The client's own price angle
//                     (atom 0.80) sits here ⇒ own.contested + saturated_warning.
//   authority_expert  E2 ██ only ⇒ 1 heavy ⇒ CONTESTED (no flag: not ours, not open).
//   speed_convenience E3 █ only ⇒ THIN.
//   proof_results     E1 █ (6d fresh = light) ⇒ THIN (E3's retired ad carries
//                     no active weight and is NOT churn — 92d lifespan).
//   emotional_safety  nobody runs it ⇒ OPEN + own atom 0.72 ≥ 0.5
//                     ⇒ open_lane {has_supporting_atom: true, churn_evidence:
//                     false} ⇒ open_lane_priority — THE uncontested lane.
//   urgency_scarcity  only E2's churned attempt ⇒ OPEN (no active presence),
//                     churned_entity_ids=[E2] ⇒ open_lane {has_supporting_atom:
//                     false, churn_evidence: true} ⇒ open_lane_hypothesis with
//                     a lowered prior (tried-and-dropped, skill §2.3).

import type { CompetitorAdRow, CompetitorEntityRow } from '@/lib/capability-contracts';
import type { OwnAngle } from '../types';

export const NOW = new Date('2026-07-01T00:00:00Z');
export const CLIENT_ID = 'client-1';
export const OWNER_ID  = 'owner-1';

export function makeEntity(over: Partial<CompetitorEntityRow> & Pick<CompetitorEntityRow, 'id' | 'name'>): CompetitorEntityRow {
  return {
    client_id:     CLIENT_ID,
    owner_user_id: OWNER_ID,
    page_ref:      null,
    ring:          'direct',
    active:        true,
    created_at:    '2026-01-01T00:00:00Z',
    updated_at:    '2026-01-01T00:00:00Z',
    ...over,
  };
}

export function makeAd(over: Partial<CompetitorAdRow> & Pick<CompetitorAdRow, 'id' | 'entity_id' | 'first_seen'>): CompetitorAdRow {
  return {
    client_id:       CLIENT_ID,
    owner_user_id:   OWNER_ID,
    platform_ad_ref: `ref-${over.id}`,
    last_seen:       '2026-07-01',
    active:          true,
    creative:        { text: 'מודעה' },
    decoded:         null,
    created_at:      '2026-01-01T00:00:00Z',
    ...over,
  };
}

export const E1 = makeEntity({ id: 'ent-cohen', name: 'מרפאת שיניים ד"ר כהן' });
export const E2 = makeEntity({ id: 'ent-smile', name: 'סמייל קליניק תל אביב' });
export const E3 = makeEntity({ id: 'ent-invis', name: 'אינוויזליין סנטר', ring: 'category' });

export const DENTAL_ENTITIES: CompetitorEntityRow[] = [E1, E2, E3];

export const DENTAL_ADS: CompetitorAdRow[] = [
  // E1 — price veterans (122d, 91d) + a fresh proof ad (6d)
  makeAd({
    id: 'ad-1', entity_id: E1.id, first_seen: '2026-03-01',
    creative: { text: 'השתלת שיניים ב-12 תשלומים ללא ריבית — הצעת מחיר תוך 24 שעות' },
    decoded:  { angle: 'price_deal', awareness: 'product_aware', offer: '12 תשלומים ללא ריבית', confidence: 0.9 },
  }),
  makeAd({
    id: 'ad-2', entity_id: E1.id, first_seen: '2026-04-01',
    creative: { text: 'יישור שיניים שקוף החל מ-390 ש"ח לחודש — בדיקה ראשונה חינם' },
    decoded:  { angle: 'price_deal', awareness: 'solution_aware', offer: 'מ-390 ש"ח לחודש + בדיקה חינם', confidence: 0.85 },
  }),
  makeAd({
    id: 'ad-3', entity_id: E1.id, first_seen: '2026-06-25',
    creative: { text: 'לפני ואחרי: 743 חיוכים שיצאו מהמרפאה שלנו השנה' },
    decoded:  { angle: 'proof_results', awareness: 'solution_aware', offer: 'גלריית לפני/אחרי', confidence: 0.8 },
  }),
  // E2 — price veteran (77d), authority veteran (103d), churned urgency (19d, dead)
  makeAd({
    id: 'ad-4', entity_id: E2.id, first_seen: '2026-04-15',
    creative: { text: 'ציפוי חרסינה במחיר השקה — מתחייבים למחיר הזול בעיר' },
    decoded:  { angle: 'price_deal', awareness: 'product_aware', offer: 'התחייבות למחיר הזול בעיר', confidence: 0.9 },
  }),
  makeAd({
    id: 'ad-5', entity_id: E2.id, first_seen: '2026-03-20',
    creative: { text: 'ד"ר לוי, 25 שנות ניסיון ומרצה באוניברסיטה — הבית שלך לרפואת שיניים' },
    decoded:  { angle: 'authority_expert', awareness: 'solution_aware', offer: 'ייעוץ עם מומחה בכיר', confidence: 0.9 },
  }),
  makeAd({
    id: 'ad-6', entity_id: E2.id, first_seen: '2026-05-01', last_seen: '2026-05-20', active: false,
    creative: { text: 'נותרו 3 מקומות אחרונים להלבנה במבצע — רק עד יום חמישי!' },
    decoded:  { angle: 'urgency_scarcity', awareness: 'product_aware', offer: 'הלבנה במבצע מוגבל', confidence: 0.85 },
  }),
  // E3 — standard-age speed + price ads (light), retired long-lived proof ad
  makeAd({
    id: 'ad-7', entity_id: E3.id, first_seen: '2026-06-10',
    creative: { text: 'יישור שיניים בלי להגיע למרפאה — סריקה מהבית ותוכנית תוך 48 שעות' },
    decoded:  { angle: 'speed_convenience', awareness: 'solution_aware', offer: 'סריקה מהבית תוך 48 שעות', confidence: 0.8 },
  }),
  makeAd({
    id: 'ad-8', entity_id: E3.id, first_seen: '2026-05-25',
    creative: { text: 'קשתיות שקופות ב-40% פחות ממחיר מרפאה' },
    decoded:  { angle: 'price_deal', awareness: 'product_aware', offer: '40% פחות ממחיר מרפאה', confidence: 0.8 },
  }),
  makeAd({
    id: 'ad-9', entity_id: E3.id, first_seen: '2026-03-01', last_seen: '2026-06-01', active: false,
    creative: { text: 'אלפי לקוחות מרוצים כבר יישרו איתנו — קראו את הביקורות' },
    decoded:  { angle: 'proof_results', awareness: 'product_aware', offer: 'ביקורות לקוחות', confidence: 0.75 },
  }),
];

/** The client's own angle atoms: a strong price angle (walks into the
 *  saturated lane) and an emotional-safety angle (the open lane's atom). */
export const OWN_ANGLES: OwnAngle[] = [
  { angle: 'price_deal',       atomConfidence: 0.8,  insightId: 'atom-price' },
  { angle: 'emotional_safety', atomConfidence: 0.72, insightId: 'atom-emsafe' },
];
