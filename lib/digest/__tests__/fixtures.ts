// A realistic Hebrew fixture set: one week at a dental clinic.
//
//   • 2 campaigns — 'ביטחון רגשי' (live, TOFU, measured) and 'זווית המחיר'
//     (paused, BOFU, no performance rows yet).
//   • Decision rows: two 'angle' decisions (one grounded in a live atom @0.85,
//     one grounded in a MISSING atom id), one 'budget' decision, and one
//     'precedents' row (episodic memory).
//   • 1 diagnosis blaming the funnel, Hebrew rationale (contains a % — proves
//     verbatim pass-through of row numerics).
//   • 1 supported hypothesis (resolved in period) + 1 open hypothesis.
//   • Performance for campaign 1 only (dry-run honesty for campaign 2).
//   • 2 active atoms for grounding citations.
//
// Every id is referenced by the audit-trail tests — keep them stable.

import type { HypothesisRow } from '@/lib/capability-contracts';
import type { Campaign, CampaignDecision } from '@/lib/campaigns/types';
import type { ClientInsight } from '@/lib/intelligence/types';
import type {
  DigestDiagnosisRow,
  DigestInputs,
  DigestItemRef,
  DigestPerformanceRow,
} from '../types';

export const CLIENT_ID = 'client-dental-1';
export const OWNER_ID  = 'owner-1';

export const PERIOD = { kind: 'weekly', start: '2026-06-22', end: '2026-06-28' } as const;

export const ATOM_CONTENT_SAFETY = 'הלקוחות קונים ביטחון, לא טיפול';
export const DIAGNOSIS_RATIONALE =
  'התנגדות המחיר עדיין לא מטופלת בדף הנחיתה — 32% מהגולשים נוטשים בשלב ההצעה';
export const PRECEDENT_RATIONALE =
  'לפני 8 חודשים זווית דחיפות נכשלה אצל קהל דומה — לא חוזרים עליה בלי שינוי הצעה';
export const CLAIM_RESOLVED = 'זווית ביטחון-רגשי תנצח את זווית המחיר אצל קהל ההורים';
export const CLAIM_OPEN     = 'הרחבת הקהל ללוקאלייק 3% תשמור על עלות להמרה נמוכה';
export const VERDICT_REASON = 'זרוע הביטחון עקפה את זרוע המחיר בהמרות בשתי מדידות רצופות';
export const APPROVAL_RATIONALE = 'להפעיל מחדש את קמפיין זווית המחיר אחרי שיפור ההצעה בדף הנחיתה';

function insight(id: string, content: string, confidence: number, kind: string): ClientInsight {
  return {
    id,
    client_id:         CLIENT_ID,
    owner_user_id:     OWNER_ID,
    layer:             'bridge',
    kind,
    content,
    structured:        null,
    source:            'brief',
    source_ref:        null,
    confidence,
    evidence_count:    2,
    status:            'active',
    superseded_by:     null,
    superseded_reason: null,
    first_seen_at:     '2026-05-01T08:00:00Z',
    updated_at:        '2026-06-20T08:00:00Z',
  };
}

function hypothesis(overrides: Partial<HypothesisRow> & Pick<HypothesisRow, 'id' | 'claim' | 'status'>): HypothesisRow {
  return {
    client_id:     CLIENT_ID,
    owner_user_id: OWNER_ID,
    insight_ids:   ['atom-safety'],
    prediction:    { metric: 'cvr', comparator: 'ratio_gte', value: 1.2, arm: 'safety', baseline_arm: 'price', confidence: 0.7 },
    floor_spec:    { metric_grade: 'cvr', per_arm: { conversions: 10 } },
    horizon:       { max_days: 14, max_spend: 500 },
    verdict_map:   { supported: [], refuted: [], inconclusive: [] },
    kill_rules:    {},
    test_refs:     [{ arm_label: 'safety' }],
    domain:        'angle',
    resolution:    null,
    registered_at: '2026-06-23T09:00:00Z',
    resolved_at:   null,
    superseded_by: null,
    created_at:    '2026-06-23T09:00:00Z',
    updated_at:    '2026-06-23T09:00:00Z',
    ...overrides,
  };
}

/** Fresh objects on every call so tests can mutate/shuffle freely. */
export function dentalWeekInputs(): DigestInputs {
  const campaigns: Campaign[] = [
    {
      id:               'camp-safety',
      client_id:        CLIENT_ID,
      owner_user_id:    OWNER_ID,
      name:             'קמפיין ביטחון רגשי',
      objective:        'leads',
      channel:          'meta_paid',
      status:           'live',
      daily_budget:     40,
      funnel_stage:     'TOFU',
      meta_campaign_id: 'dryrun_1',
      dry_run:          true,
      grounded_in:      ['atom-safety'],
      rationale:        'קהל ההורים בשלב מודעות לבעיה — מתחילים מלמעלה במשפך',
      created_at:       '2026-06-22T08:00:00Z',
      updated_at:       '2026-06-26T08:00:00Z',
    },
    {
      id:               'camp-price',
      client_id:        CLIENT_ID,
      owner_user_id:    OWNER_ID,
      name:             'קמפיין זווית המחיר',
      objective:        'conversions',
      channel:          'meta_paid',
      status:           'paused',
      daily_budget:     30,
      funnel_stage:     'BOFU',
      meta_campaign_id: 'dryrun_2',
      dry_run:          true,
      grounded_in:      ['atom-objection'],
      rationale:        null,
      created_at:       '2026-06-23T08:00:00Z',
      updated_at:       '2026-06-27T08:00:00Z',
    },
  ];

  const decisions: CampaignDecision[] = [
    {
      id:            'dec-angle-safety',
      campaign_id:   'camp-safety',
      client_id:     CLIENT_ID,
      owner_user_id: OWNER_ID,
      decision_type: 'angle',
      decision:      { angle: 'ביטחון רגשי' },
      grounded_in:   ['atom-safety'],
      rationale:     'נבחרה זווית ביטחון רגשי — התובנה החזקה ביותר בשכבת הגשר',
      created_at:    '2026-06-22T08:05:00Z',
    },
    {
      id:            'dec-angle-price',
      campaign_id:   'camp-price',
      client_id:     CLIENT_ID,
      owner_user_id: OWNER_ID,
      decision_type: 'angle',
      decision:      { angle: 'זווית המחיר' },
      grounded_in:   ['atom-gone'],   // MISSING atom — cited without confidence
      rationale:     'זווית מחיר לקהל שכבר משווה מחירים',
      created_at:    '2026-06-23T08:05:00Z',
    },
    {
      id:            'dec-budget-safety',
      campaign_id:   'camp-safety',
      client_id:     CLIENT_ID,
      owner_user_id: OWNER_ID,
      decision_type: 'budget',
      decision:      { daily_budget: 40 },
      grounded_in:   ['atom-safety'],
      rationale:     'תקציב פתיחה שמרני עד שהזרוע מוכיחה את עצמה',
      created_at:    '2026-06-22T08:06:00Z',
    },
    {
      id:            'dec-precedents',
      campaign_id:   'camp-safety',
      client_id:     CLIENT_ID,
      owner_user_id: OWNER_ID,
      decision_type: 'precedents',
      decision:      { episodes: ['ep-1'] },
      grounded_in:   [],
      rationale:     PRECEDENT_RATIONALE,
      created_at:    '2026-06-22T08:07:00Z',
    },
  ];

  const items: DigestItemRef[] = [
    { id: 'item-safety-1', campaign_id: 'camp-safety' },
    { id: 'item-price-1',  campaign_id: 'camp-price' },
  ];

  const diagnoses: DigestDiagnosisRow[] = [
    {
      id:                'diag-funnel',
      client_id:         CLIENT_ID,
      owner_user_id:     OWNER_ID,
      scope_campaign_id: 'camp-price',
      scope_item_id:     'item-price-1',
      failed_link:       'funnel',
      rationale:         DIAGNOSIS_RATIONALE,
      created_at:        '2026-06-26T10:00:00Z',
    },
  ];

  const performance: DigestPerformanceRow[] = [
    {
      id:               'perf-safety-1',
      client_id:        CLIENT_ID,
      owner_user_id:    OWNER_ID,
      campaign_item_id: 'item-safety-1',
      artifact_id:      null,
      metrics:          { impressions: 12500, clicks: 240, conversions: 14, spend: 378, cpa: 27 },
      verdict:          'worked',
      period_start:     '2026-06-22',
      period_end:       '2026-06-28',
      created_at:       '2026-06-28T20:00:00Z',
    },
  ];

  const hypotheses = {
    resolved: [
      hypothesis({
        id:          'hyp-supported',
        claim:       CLAIM_RESOLVED,
        status:      'supported',
        resolution:  {
          observed:       { safety: { cvr: 0.05 }, price: { cvr: 0.02 } },
          verdict_reason: VERDICT_REASON,
          resolved_by:    'floor_met',
        },
        registered_at: '2026-06-10T09:00:00Z',
        resolved_at:   '2026-06-27T09:00:00Z',
      }),
    ],
    open: [
      hypothesis({
        id:     'hyp-lookalike',
        claim:  CLAIM_OPEN,
        status: 'open',
      }),
    ],
  };

  const insights: ClientInsight[] = [
    insight('atom-safety',    ATOM_CONTENT_SAFETY,        0.85, 'angle'),
    insight('atom-objection', 'המחיר מרתיע לפני שיחה ראשונה', 0.6,  'objection'),
  ];

  return {
    period:      { ...PERIOD },
    campaigns,
    decisions,
    items,
    diagnoses,
    hypotheses,
    performance,
    insights,
    approvalsNeeded: [
      { kind: 'unpause', rationale: APPROVAL_RATIONALE, ref: 'camp-price' },
    ],
  };
}

/** Empty period — nothing ran, nothing recorded. */
export function emptyWeekInputs(): DigestInputs {
  return {
    period:      { ...PERIOD },
    campaigns:   [],
    decisions:   [],
    items:       [],
    diagnoses:   [],
    hypotheses:  { resolved: [], open: [] },
    performance: [],
    insights:    [],
    approvalsNeeded: [],
  };
}
