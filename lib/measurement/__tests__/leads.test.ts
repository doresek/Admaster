// funnel_leads registry + stage marking + the sales-outcome learning bridge.
// Proves: the 30d dedupe policy (touchpoint appended, never a duplicate lead),
// consent recording per חוק הספאם, the legal-transition map (append + sync),
// and that terminal stages move the atoms behind the source campaign_item
// through the REAL lifecycle engine (claim → apply) with typed failure modes.

import { describe, it, expect, beforeEach } from 'vitest';
import { CONFIDENCE } from '@/lib/intelligence/types';
import { parseClickIds } from '../capture';
import {
  DEDUPE_WINDOW_DAYS,
  LEGAL_TRANSITIONS,
  createLeadFromLanding,
  isLegalTransition,
  listLeads,
  markStage,
  normalizeEmail,
  normalizePhone,
} from '../leads';
import { mockSupabase, type MockRow, type SupabaseMock } from './mock-supabase';

const CLIENT = 'c-1';
const OWNER  = 'u-1';
const ITEM   = '0f4a2f7e-1111-4222-8333-444455556666';
const ATOM_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ATOM_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const daysAgo = (n: number): string => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const leadRow = (over: MockRow = {}): MockRow => ({
  id: 'lead-existing', client_id: CLIENT, owner_user_id: OWNER,
  source: 'landing', source_ref: {}, name: 'דנה', phone: '0501234567', email: 'dana@x.co',
  consent_marketing: false, consent_recorded_at: null,
  current_stage: 'new', value: null,
  created_at: daysAgo(5), updated_at: daysAgo(5),
  ...over,
});

const atomRow = (id: string, over: MockRow = {}): MockRow => ({
  id, client_id: CLIENT, owner_user_id: OWNER,
  layer: 'customers', kind: 'pain', content: `atom ${id}`, structured: null,
  source: 'brief', source_ref: null,
  confidence: 0.5, evidence_count: 1, status: 'active',
  superseded_by: null, superseded_reason: null,
  first_seen_at: daysAgo(10), updated_at: daysAgo(10),
  ...over,
});

const touchpointRow = (leadId: string, over: MockRow = {}): MockRow => ({
  id: `tp-${leadId}`, lead_id: leadId, client_id: CLIENT, owner_user_id: OWNER,
  fbclid: 'fb1', gclid: null, ctwa_clid: null, meta_lead_id: null,
  utm: { source: 'facebook', medium: 'cpc', content: ITEM },
  landing_path: '/lp/a', referrer: null, user_agent: null, captured_at: daysAgo(5),
  ...over,
});

let db: SupabaseMock;
beforeEach(() => { db = mockSupabase(); });

const baseInput = (over: Record<string, unknown> = {}) => ({
  clientId: CLIENT, ownerUserId: OWNER,
  fields: { name: 'דנה', phone: '050-123-4567', email: 'Dana@X.co' },
  touchpoint: parseClickIds({ fbclid: 'fb1', utm: { source: 'facebook', medium: 'cpc', content: ITEM }, landing_path: '/lp/a' }),
  consentMarketing: false,
  ...over,
});

describe('normalizers', () => {
  it('phone: digits only, 972-prefix → local 0, junk rejected', () => {
    expect(normalizePhone('050-123-4567')).toBe('0501234567');
    expect(normalizePhone('+972 50 123 4567')).toBe('0501234567');
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
  });
  it('email: lowercased + shape-checked', () => {
    expect(normalizeEmail(' Dana@X.co ')).toBe('dana@x.co');
    expect(normalizeEmail('not-an-email')).toBeNull();
  });
});

describe('createLeadFromLanding — new lead', () => {
  it('inserts funnel_leads (normalized contact) + a touchpoint row', async () => {
    const res = await createLeadFromLanding(db.client, baseInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.deduped).toBe(false);
    expect(res.notes).toEqual([]);

    const leads = db.rows('funnel_leads');
    expect(leads).toHaveLength(1);
    expect(leads[0].phone).toBe('0501234567');
    expect(leads[0].email).toBe('dana@x.co');
    expect(leads[0].name).toBe('דנה');
    expect(leads[0].current_stage).toBe('new');
    expect(leads[0].source).toBe('landing');

    const tps = db.rows('lead_touchpoints');
    expect(tps).toHaveLength(1);
    expect(tps[0].lead_id).toBe(leads[0].id);
    expect(tps[0].fbclid).toBe('fb1');
    expect(tps[0].utm).toEqual({ source: 'facebook', medium: 'cpc', content: ITEM });
    expect(res.touchpointId).toBe(tps[0].id);
  });

  it('consent=true → consent_marketing true + consent_recorded_at stamped', async () => {
    const res = await createLeadFromLanding(db.client, baseInput({ consentMarketing: true }));
    expect(res.ok).toBe(true);
    const lead = db.rows('funnel_leads')[0];
    expect(lead.consent_marketing).toBe(true);
    expect(typeof lead.consent_recorded_at).toBe('string');
  });

  it('consent absent/false → false and NO timestamp (unchecked-by-default)', async () => {
    await createLeadFromLanding(db.client, baseInput({ consentMarketing: false }));
    const lead = db.rows('funnel_leads')[0];
    expect(lead.consent_marketing).toBe(false);
    expect(lead.consent_recorded_at).toBeNull();
  });

  it('lead insert failure → typed ok:false (never a throw)', async () => {
    db.failOn.add('insert:funnel_leads');
    const res = await createLeadFromLanding(db.client, baseInput());
    expect(res).toMatchObject({ ok: false, reason: 'lead_insert_failed' });
    expect(db.rows('lead_touchpoints')).toHaveLength(0);
  });

  it('touchpoint insert failure degrades to a note — the lead is still created', async () => {
    db.failOn.add('insert:lead_touchpoints');
    const res = await createLeadFromLanding(db.client, baseInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.touchpointId).toBeNull();
    expect(res.notes.some((n) => n.startsWith('touchpoint_insert_failed'))).toBe(true);
    expect(db.rows('funnel_leads')).toHaveLength(1);
  });
});

describe('createLeadFromLanding — 30d dedupe policy', () => {
  it('same normalized phone within 30d → touchpoint appended, NO duplicate lead, re-inquiry audited', async () => {
    db.seed('funnel_leads', [leadRow({ created_at: daysAgo(10) })]);
    // Submitted in international format — normalization makes them equal.
    const res = await createLeadFromLanding(db.client, baseInput({
      fields: { name: 'דנה', phone: '+972501234567' },
    }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.deduped).toBe(true);
    expect(db.rows('funnel_leads')).toHaveLength(1);

    const tps = db.rows('lead_touchpoints');
    expect(tps).toHaveLength(1);
    expect(tps[0].lead_id).toBe('lead-existing');

    const events = db.rows('lead_stage_events');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      lead_id: 'lead-existing', stage: 'new', marked_via: 'system',
      note: `re-inquiry within ${DEDUPE_WINDOW_DAYS}d — new touchpoint appended`,
    });
  });

  it('dedupe matches by email when no phone matches', async () => {
    db.seed('funnel_leads', [leadRow({ phone: '0599999999', created_at: daysAgo(3) })]);
    const res = await createLeadFromLanding(db.client, baseInput({
      fields: { email: 'DANA@x.co' }, // different case, no phone
    }));
    expect(res.ok && res.deduped).toBe(true);
    expect(db.rows('funnel_leads')).toHaveLength(1);
  });

  it('re-inquiry with consent=true UPGRADES consent (never downgrades)', async () => {
    db.seed('funnel_leads', [leadRow({ consent_marketing: false })]);
    await createLeadFromLanding(db.client, baseInput({ consentMarketing: true }));
    const lead = db.rows('funnel_leads')[0];
    expect(lead.consent_marketing).toBe(true);
    expect(typeof lead.consent_recorded_at).toBe('string');

    // and the reverse: an unchecked re-inquiry does NOT revoke prior consent
    db.seed('funnel_leads', [leadRow({ consent_marketing: true, consent_recorded_at: daysAgo(2) })]);
    await createLeadFromLanding(db.client, baseInput({ consentMarketing: false }));
    expect(db.rows('funnel_leads')[0].consent_marketing).toBe(true);
  });

  it('same phone OUTSIDE the 30d window → a NEW lead (stale re-inquiry is new demand)', async () => {
    db.seed('funnel_leads', [leadRow({ created_at: daysAgo(40) })]);
    const res = await createLeadFromLanding(db.client, baseInput());
    expect(res.ok && !res.deduped).toBe(true);
    expect(db.rows('funnel_leads')).toHaveLength(2);
  });

  it('different phone + email → a new lead', async () => {
    db.seed('funnel_leads', [leadRow()]);
    const res = await createLeadFromLanding(db.client, baseInput({
      fields: { phone: '0521111111', email: 'other@x.co' },
    }));
    expect(res.ok && !res.deduped).toBe(true);
    expect(db.rows('funnel_leads')).toHaveLength(2);
  });

  it('dedupe lookup failure fails OPEN: the lead is created and the reason recorded', async () => {
    db.failOn.add('select:funnel_leads');
    const res = await createLeadFromLanding(db.client, baseInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.deduped).toBe(false);
    expect(res.notes.some((n) => n.startsWith('dedupe_lookup_failed_open'))).toBe(true);
    expect(db.rows('funnel_leads')).toHaveLength(1);
  });
});

describe('markStage — legal-transition map', () => {
  it('the map itself: forward-only, skips allowed, outcome stages terminal', () => {
    expect(isLegalTransition('new', 'closed_won')).toBe(true);      // one-tap skip
    expect(isLegalTransition('qualified', 'contacted')).toBe(false); // backwards
    expect(isLegalTransition('closed_won', 'new')).toBe(false);      // the corruption case
    expect(isLegalTransition('new', 'new')).toBe(false);             // same-stage no-op
    expect(LEGAL_TRANSITIONS.closed_won).toEqual([]);
    expect(LEGAL_TRANSITIONS.closed_lost).toEqual([]);
    expect(LEGAL_TRANSITIONS.irrelevant).toEqual([]);
  });

  it('legal mark: appends the event AND syncs current_stage', async () => {
    db.seed('funnel_leads', [leadRow()]);
    const res = await markStage(db.client, {
      leadId: 'lead-existing', clientId: CLIENT, ownerUserId: OWNER,
      stage: 'qualified', markedVia: 'ui', note: 'טלפון טוב',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.event).toMatchObject({ stage: 'qualified', marked_via: 'ui', note: 'טלפון טוב' });
    expect(res.lead.current_stage).toBe('qualified');
    expect(db.rows('funnel_leads')[0].current_stage).toBe('qualified');
    expect(db.rows('lead_stage_events')).toHaveLength(1);
    expect(res.learning).toEqual({ emitted: false, skipped: 'not_an_outcome_stage', moves: [] });
  });

  it('illegal transition → typed rejection, NOTHING written', async () => {
    db.seed('funnel_leads', [leadRow({ current_stage: 'closed_won' })]);
    const res = await markStage(db.client, {
      leadId: 'lead-existing', clientId: CLIENT, ownerUserId: OWNER,
      stage: 'new', markedVia: 'ui',
    });
    expect(res).toMatchObject({ ok: false, reason: 'invalid_transition' });
    expect(db.rows('lead_stage_events')).toHaveLength(0);
    expect(db.rows('funnel_leads')[0].current_stage).toBe('closed_won');
  });

  it('unknown lead → typed lead_not_found', async () => {
    const res = await markStage(db.client, {
      leadId: 'nope', clientId: CLIENT, ownerUserId: OWNER, stage: 'qualified', markedVia: 'ui',
    });
    expect(res).toMatchObject({ ok: false, reason: 'lead_not_found' });
  });

  it('closed_won with value → value on the event AND the lead row', async () => {
    db.seed('funnel_leads', [leadRow({ current_stage: 'meeting' })]);
    const res = await markStage(db.client, {
      leadId: 'lead-existing', clientId: CLIENT, ownerUserId: OWNER,
      stage: 'closed_won', value: 12500, markedVia: 'digest',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.event.value).toBe(12500);
    expect(db.rows('funnel_leads')[0].value).toBe(12500);
  });
});

describe('markStage — sales-outcome emission (the loop reaches money)', () => {
  const seedFullChain = () => {
    db.seed('funnel_leads', [leadRow({ current_stage: 'meeting' })]);
    db.seed('lead_touchpoints', [touchpointRow('lead-existing')]);
    db.seed('campaign_items', [{ id: ITEM, client_id: CLIENT, owner_user_id: OWNER, grounded_in: [ATOM_1, ATOM_2] }]);
    db.seed('client_insights', [atomRow(ATOM_1), atomRow(ATOM_2)]);
  };

  it('closed_won → positive 0.6 signals on the item\'s grounded_in atoms, confidence moves via the lifecycle', async () => {
    seedFullChain();
    const res = await markStage(db.client, {
      leadId: 'lead-existing', clientId: CLIENT, ownerUserId: OWNER,
      stage: 'closed_won', value: 8000, markedVia: 'ui',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.learning.emitted).toBe(true);
    expect(res.learning.campaignItemId).toBe(ITEM);
    expect(res.learning.moves.map((m) => m.outcome)).toEqual(['applied', 'applied']);

    const signals = db.rows('learning_signals');
    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({
      signal_type: 'sales_outcome', polarity: 'positive', weight: 0.6, processed: true,
    });
    expect(new Set(signals.map((s) => s.insight_id))).toEqual(new Set([ATOM_1, ATOM_2]));

    // confidence math belongs to the lifecycle engine: 0.5 + STEP*0.6
    const expected = Math.round((0.5 + CONFIDENCE.STEP * 0.6) * 1e4) / 1e4;
    for (const atom of db.rows('client_insights')) {
      expect(atom.confidence).toBe(expected);
      expect(atom.evidence_count).toBe(2);
    }
    // audit trail written by the engine
    expect(db.rows('insight_events').filter((e) => e.event === 'corroborated')).toHaveLength(2);
  });

  it('irrelevant → negative 0.4 signals (below decisive: weakened, never refuted)', async () => {
    seedFullChain();
    const res = await markStage(db.client, {
      leadId: 'lead-existing', clientId: CLIENT, ownerUserId: OWNER,
      stage: 'irrelevant', markedVia: 'whatsapp',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.learning.moves.map((m) => m.outcome)).toEqual(['applied', 'applied']);

    const expected = Math.round((0.5 - CONFIDENCE.STEP * 0.4) * 1e4) / 1e4;
    for (const atom of db.rows('client_insights')) {
      expect(atom.confidence).toBe(expected);
      expect(atom.status).toBe('active'); // weakened, NOT refuted
    }
    expect(db.rows('learning_signals')[0]).toMatchObject({ polarity: 'negative', weight: 0.4 });
  });

  it('no touchpoint carries a campaign_item UUID → typed skip, stage still persisted', async () => {
    db.seed('funnel_leads', [leadRow({ current_stage: 'meeting' })]);
    db.seed('lead_touchpoints', [touchpointRow('lead-existing', { utm: { source: 'facebook' } })]);
    const res = await markStage(db.client, {
      leadId: 'lead-existing', clientId: CLIENT, ownerUserId: OWNER,
      stage: 'closed_lost', markedVia: 'ui',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.learning).toEqual({ emitted: false, skipped: 'no_campaign_item_in_touchpoints', moves: [] });
    expect(db.rows('funnel_leads')[0].current_stage).toBe('closed_lost');
    expect(db.rows('learning_signals')).toHaveLength(0);
  });

  it('campaign item missing / not owned → typed skip', async () => {
    db.seed('funnel_leads', [leadRow({ current_stage: 'meeting' })]);
    db.seed('lead_touchpoints', [touchpointRow('lead-existing')]); // utm.content=ITEM, but no item row
    const res = await markStage(db.client, {
      leadId: 'lead-existing', clientId: CLIENT, ownerUserId: OWNER,
      stage: 'closed_won', markedVia: 'ui',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.learning.skipped).toBe('campaign_item_not_found');
  });

  it('grounded_in empty → typed skip item_has_no_grounded_atoms', async () => {
    db.seed('funnel_leads', [leadRow({ current_stage: 'meeting' })]);
    db.seed('lead_touchpoints', [touchpointRow('lead-existing')]);
    db.seed('campaign_items', [{ id: ITEM, client_id: CLIENT, owner_user_id: OWNER, grounded_in: [] }]);
    const res = await markStage(db.client, {
      leadId: 'lead-existing', clientId: CLIENT, ownerUserId: OWNER,
      stage: 'closed_won', markedVia: 'ui',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.learning.skipped).toBe('item_has_no_grounded_atoms');
  });

  it('signal insert failure → typed per-move outcome; the stage mark survives', async () => {
    seedFullChain();
    db.failOn.add('insert:learning_signals');
    const res = await markStage(db.client, {
      leadId: 'lead-existing', clientId: CLIENT, ownerUserId: OWNER,
      stage: 'closed_won', markedVia: 'ui',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.learning.emitted).toBe(true);
    expect(res.learning.moves.map((m) => m.outcome)).toEqual(['signal_insert_failed', 'signal_insert_failed']);
    expect(db.rows('funnel_leads')[0].current_stage).toBe('closed_won');
    // atoms untouched — no half-applied confidence
    for (const atom of db.rows('client_insights')) expect(atom.confidence).toBe(0.5);
  });

  it('a grounded atom that no longer exists → atom_missing move, others still apply', async () => {
    seedFullChain();
    db.seed('client_insights', [atomRow(ATOM_2)]); // ATOM_1 gone
    const res = await markStage(db.client, {
      leadId: 'lead-existing', clientId: CLIENT, ownerUserId: OWNER,
      stage: 'closed_won', markedVia: 'ui',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byId = new Map(res.learning.moves.map((m) => [m.insight_id, m.outcome]));
    expect(byId.get(ATOM_1)).toBe('atom_missing');
    expect(byId.get(ATOM_2)).toBe('applied');
  });

  it('uses the MOST RECENT touchpoint with a campaign item (last-click)', async () => {
    db.seed('funnel_leads', [leadRow({ current_stage: 'meeting' })]);
    const OTHER_ITEM = '99999999-9999-4999-8999-999999999999';
    db.seed('lead_touchpoints', [
      touchpointRow('lead-existing', { id: 'tp-old', utm: { content: OTHER_ITEM }, captured_at: daysAgo(20) }),
      touchpointRow('lead-existing', { id: 'tp-new', utm: { content: ITEM }, captured_at: daysAgo(1) }),
    ]);
    db.seed('campaign_items', [
      { id: ITEM, client_id: CLIENT, owner_user_id: OWNER, grounded_in: [ATOM_1] },
      { id: OTHER_ITEM, client_id: CLIENT, owner_user_id: OWNER, grounded_in: [ATOM_2] },
    ]);
    db.seed('client_insights', [atomRow(ATOM_1), atomRow(ATOM_2)]);
    const res = await markStage(db.client, {
      leadId: 'lead-existing', clientId: CLIENT, ownerUserId: OWNER,
      stage: 'closed_won', markedVia: 'ui',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.learning.campaignItemId).toBe(ITEM);
    expect(res.learning.moves).toHaveLength(1);
    expect(res.learning.moves[0].insight_id).toBe(ATOM_1);
  });
});

describe('listLeads', () => {
  it('client-scoped, newest first, stage filter + limit', async () => {
    db.seed('funnel_leads', [
      leadRow({ id: 'l1', current_stage: 'new', created_at: daysAgo(3) }),
      leadRow({ id: 'l2', current_stage: 'qualified', created_at: daysAgo(2) }),
      leadRow({ id: 'l3', current_stage: 'new', created_at: daysAgo(1) }),
      leadRow({ id: 'other', client_id: 'c-2', created_at: daysAgo(0) }),
    ]);
    const all = await listLeads(db.client, CLIENT, OWNER);
    expect(all.map((l) => l.id)).toEqual(['l3', 'l2', 'l1']);

    const news = await listLeads(db.client, CLIENT, OWNER, { stage: 'new' });
    expect(news.map((l) => l.id)).toEqual(['l3', 'l1']);

    const one = await listLeads(db.client, CLIENT, OWNER, { limit: 1 });
    expect(one.map((l) => l.id)).toEqual(['l3']);
  });

  it('throws on a DB read error (authed read path — no silent empty list)', async () => {
    db.failOn.add('select:funnel_leads');
    await expect(listLeads(db.client, CLIENT, OWNER)).rejects.toThrow('listLeads');
  });
});
