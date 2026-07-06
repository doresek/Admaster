// Deep tests for the Leads-UI pure helpers: legal-next-stage derivation for
// EVERY stage cross-checked against the canonical LEGAL_TRANSITIONS map in
// lib/measurement/leads (the UI derivation and the server map must never
// drift), stage-group filter mapping, IL date/₪ formatting, payload narrowing
// and the optimistic reducer including rollback.
import { describe, it, expect } from 'vitest';
import type { FunnelLeadRow } from '@/lib/capability-contracts';
import { LEGAL_TRANSITIONS } from '@/lib/measurement/leads';
import {
  ALL_STAGES,
  INITIAL_LEADS_STATE,
  MAX_DEAL_VALUE_ILS,
  PIPELINE_STAGES,
  STAGE_FILTER_TABS,
  STAGE_HE,
  STAGE_TONE,
  SOURCE_HE,
  TERMINAL_STAGES,
  countByFilter,
  formatILDate,
  formatShekel,
  isTerminalStage,
  leadsReducer,
  legalNextStages,
  matchesFilter,
  parseLeadsPayload,
  parseMarkedLead,
  parseShekelInput,
  stageGroupOf,
  toFunnelLeadRow,
  type LeadsState,
} from '../helpers';

const lead = (over: Partial<FunnelLeadRow> = {}): FunnelLeadRow => ({
  id: 'l1', client_id: 'c1', owner_user_id: 'u1',
  source: 'landing', source_ref: {},
  name: 'ישראל ישראלי', phone: '0501234567', email: 'lead@example.com',
  consent_marketing: true, consent_recorded_at: '2026-07-01T10:00:00Z',
  current_stage: 'new', value: null,
  created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T10:00:00Z',
  ...over,
});

// ── legal-next-stages derivation ─────────────────────────────────────────────

describe('legalNextStages', () => {
  it('matches the canonical LEGAL_TRANSITIONS map for EVERY stage', () => {
    for (const stage of ALL_STAGES) {
      expect(legalNextStages(stage), `stage=${stage}`).toEqual(LEGAL_TRANSITIONS[stage]);
    }
  });

  it('covers all 7 stages (pipeline + terminals = the full union)', () => {
    expect(ALL_STAGES).toHaveLength(7);
    expect([...PIPELINE_STAGES, ...TERMINAL_STAGES].sort()).toEqual(
      Object.keys(LEGAL_TRANSITIONS).sort(),
    );
  });

  it('is forward-only with skips: new can reach everything else', () => {
    expect(legalNextStages('new')).toEqual(
      ['contacted', 'qualified', 'meeting', 'closed_won', 'closed_lost', 'irrelevant'],
    );
  });

  it('terminal stages offer NO next stages (no button may 409)', () => {
    for (const stage of TERMINAL_STAGES) {
      expect(legalNextStages(stage)).toEqual([]);
      expect(isTerminalStage(stage)).toBe(true);
    }
  });

  it('pipeline stages are not terminal', () => {
    for (const stage of PIPELINE_STAGES) expect(isTerminalStage(stage)).toBe(false);
  });

  it('never offers the current stage itself (same-stage re-marks are rejected server-side)', () => {
    for (const stage of ALL_STAGES) {
      expect(legalNextStages(stage)).not.toContain(stage);
    }
  });
});

// ── stage-group filter mapping ───────────────────────────────────────────────

describe('stage filters', () => {
  it('maps every stage to its group', () => {
    expect(stageGroupOf('new')).toBe('new');
    expect(stageGroupOf('contacted')).toBe('in_progress');
    expect(stageGroupOf('qualified')).toBe('in_progress');
    expect(stageGroupOf('meeting')).toBe('in_progress');
    expect(stageGroupOf('closed_won')).toBe('closed');
    expect(stageGroupOf('closed_lost')).toBe('closed');
    expect(stageGroupOf('irrelevant')).toBe('irrelevant');
  });

  it('"all" matches every stage', () => {
    for (const stage of ALL_STAGES) expect(matchesFilter(stage, 'all')).toBe(true);
  });

  it('group filters match only their own stages', () => {
    expect(matchesFilter('qualified', 'in_progress')).toBe(true);
    expect(matchesFilter('qualified', 'closed')).toBe(false);
    expect(matchesFilter('closed_lost', 'closed')).toBe(true);
    expect(matchesFilter('irrelevant', 'closed')).toBe(false);
    expect(matchesFilter('irrelevant', 'irrelevant')).toBe(true);
    expect(matchesFilter('new', 'new')).toBe(true);
    expect(matchesFilter('contacted', 'new')).toBe(false);
  });

  it('counts leads per tab (incl. the "all" total)', () => {
    const leads = [
      lead({ id: 'a', current_stage: 'new' }),
      lead({ id: 'b', current_stage: 'contacted' }),
      lead({ id: 'c', current_stage: 'meeting' }),
      lead({ id: 'd', current_stage: 'closed_won' }),
      lead({ id: 'e', current_stage: 'closed_lost' }),
      lead({ id: 'f', current_stage: 'irrelevant' }),
    ];
    expect(countByFilter(leads)).toEqual({
      all: 6, new: 1, in_progress: 2, closed: 2, irrelevant: 1,
    });
  });

  it('counts an empty list as all-zero', () => {
    expect(countByFilter([])).toEqual({ all: 0, new: 0, in_progress: 0, closed: 0, irrelevant: 0 });
  });

  it('tab definitions cover all filters with Hebrew labels', () => {
    expect(STAGE_FILTER_TABS.map((t) => t.id)).toEqual(
      ['all', 'new', 'in_progress', 'closed', 'irrelevant'],
    );
    expect(STAGE_FILTER_TABS.map((t) => t.label)).toEqual(
      ['הכל', 'חדשים', 'בטיפול', 'נסגרו', 'לא רלוונטיים'],
    );
  });
});

// ── Hebrew vocabulary completeness ───────────────────────────────────────────

describe('Hebrew label maps', () => {
  it('cover every stage (label + tone)', () => {
    for (const stage of ALL_STAGES) {
      expect(STAGE_HE[stage], `label for ${stage}`).toBeTruthy();
      expect(STAGE_TONE[stage], `tone for ${stage}`).toBeTruthy();
    }
  });

  it('cover every source', () => {
    expect(SOURCE_HE).toEqual({
      landing: 'דף נחיתה', site: 'אתר', whatsapp: 'וואטסאפ',
      instant_form: 'טופס', call: 'שיחה', manual: 'ידני',
    });
  });
});

// ── IL formatting ────────────────────────────────────────────────────────────

describe('formatILDate', () => {
  it('formats in DD.MM.YYYY Israel time', () => {
    expect(formatILDate('2026-07-01T10:00:00Z')).toBe('01.07.2026');
  });

  it('rolls to the next IL day across midnight (UTC+3 in summer)', () => {
    expect(formatILDate('2026-06-30T21:30:00Z')).toBe('01.07.2026');
  });

  it('handles winter time (UTC+2)', () => {
    expect(formatILDate('2026-01-15T23:30:00Z')).toBe('16.01.2026');
  });

  it('returns — for garbage', () => {
    expect(formatILDate('not-a-date')).toBe('—');
    expect(formatILDate('')).toBe('—');
  });
});

describe('formatShekel', () => {
  it('formats with he-IL grouping', () => {
    expect(formatShekel(12345)).toBe('₪12,345');
    expect(formatShekel(0)).toBe('₪0');
  });
  it('returns — for null', () => {
    expect(formatShekel(null)).toBe('—');
  });
});

describe('parseShekelInput', () => {
  it('empty input is legal — value omitted', () => {
    expect(parseShekelInput('')).toEqual({ ok: true, value: null });
    expect(parseShekelInput('   ')).toEqual({ ok: true, value: null });
  });
  it('parses digits, tolerating ₪/commas/spaces', () => {
    expect(parseShekelInput('5000')).toEqual({ ok: true, value: 5000 });
    expect(parseShekelInput(' 12,500 ₪ ')).toEqual({ ok: true, value: 12500 });
    expect(parseShekelInput('99.5')).toEqual({ ok: true, value: 99.5 });
  });
  it('rejects non-numbers, negatives and absurd values', () => {
    expect(parseShekelInput('abc')).toEqual({ ok: false });
    expect(parseShekelInput('-5')).toEqual({ ok: false });
    expect(parseShekelInput('1e9')).toEqual({ ok: false });
    expect(parseShekelInput(String(MAX_DEAL_VALUE_ILS + 1))).toEqual({ ok: false });
  });
  it('accepts the exact cap', () => {
    expect(parseShekelInput(String(MAX_DEAL_VALUE_ILS))).toEqual({ ok: true, value: MAX_DEAL_VALUE_ILS });
  });
});

// ── payload narrowing ────────────────────────────────────────────────────────

describe('payload narrowing', () => {
  const raw = (): unknown => JSON.parse(JSON.stringify(lead()));

  it('narrows a valid row', () => {
    expect(toFunnelLeadRow(raw())).toEqual(lead());
  });

  it('rejects a row with an unknown stage', () => {
    const bad = { ...lead(), current_stage: 'bogus' };
    expect(toFunnelLeadRow(JSON.parse(JSON.stringify(bad)))).toBeNull();
  });

  it('rejects a row with an unknown source', () => {
    const bad = { ...lead(), source: 'carrier_pigeon' };
    expect(toFunnelLeadRow(JSON.parse(JSON.stringify(bad)))).toBeNull();
  });

  it('rejects non-objects and rows missing ids', () => {
    expect(toFunnelLeadRow(null)).toBeNull();
    expect(toFunnelLeadRow('x')).toBeNull();
    expect(toFunnelLeadRow({ ...lead(), id: 7 })).toBeNull();
  });

  it('null-coerces optional contact fields and non-numeric value', () => {
    const row = toFunnelLeadRow({ ...lead(), name: 7, phone: undefined, email: null, value: 'big' });
    expect(row).not.toBeNull();
    expect(row?.name).toBeNull();
    expect(row?.phone).toBeNull();
    expect(row?.email).toBeNull();
    expect(row?.value).toBeNull();
  });

  it('parseLeadsPayload: valid list, empty list, and rejections', () => {
    expect(parseLeadsPayload({ leads: [raw(), raw()] })).toHaveLength(2);
    expect(parseLeadsPayload({ leads: [] })).toEqual([]);
    expect(parseLeadsPayload({ leads: [raw(), { junk: true }] })).toBeNull(); // one corrupt row = distrust all
    expect(parseLeadsPayload({ error: 'boom' })).toBeNull();
    expect(parseLeadsPayload(null)).toBeNull();
  });

  it('parseMarkedLead: unwraps { lead } and rejects everything else', () => {
    expect(parseMarkedLead({ ok: true, lead: raw() })).toEqual(lead());
    expect(parseMarkedLead({ ok: true })).toBeNull();
    expect(parseMarkedLead(undefined)).toBeNull();
  });
});

// ── optimistic reducer ───────────────────────────────────────────────────────

describe('leadsReducer', () => {
  const two = (): LeadsState => leadsReducer(INITIAL_LEADS_STATE, {
    type: 'loaded',
    leads: [lead({ id: 'a', current_stage: 'new' }), lead({ id: 'b', current_stage: 'meeting' })],
  });

  it('loaded replaces the list and clears pending', () => {
    const s = two();
    expect(s.leads).toHaveLength(2);
    expect(s.pending).toEqual({});
  });

  it('mark_start applies the stage optimistically and snapshots the original', () => {
    const s = leadsReducer(two(), { type: 'mark_start', leadId: 'a', stage: 'contacted', value: null });
    expect(s.leads.find((l) => l.id === 'a')?.current_stage).toBe('contacted');
    expect(s.pending.a?.current_stage).toBe('new'); // the rollback snapshot
    expect(s.leads.find((l) => l.id === 'b')?.current_stage).toBe('meeting'); // untouched
  });

  it('mark_start on closed_won carries the deal value onto the lead', () => {
    const s = leadsReducer(two(), { type: 'mark_start', leadId: 'b', stage: 'closed_won', value: 12000 });
    const b = s.leads.find((l) => l.id === 'b');
    expect(b?.current_stage).toBe('closed_won');
    expect(b?.value).toBe(12000);
  });

  it('mark_start on a non-won stage ignores value', () => {
    const s = leadsReducer(two(), { type: 'mark_start', leadId: 'a', stage: 'qualified', value: 999 });
    expect(s.leads.find((l) => l.id === 'a')?.value).toBeNull();
  });

  it('mark_start refuses an ILLEGAL transition (state identity)', () => {
    const s0 = two();
    // meeting → contacted is backwards; terminal leads have no moves at all.
    expect(leadsReducer(s0, { type: 'mark_start', leadId: 'b', stage: 'contacted', value: null })).toBe(s0);
    const closed = leadsReducer(INITIAL_LEADS_STATE, {
      type: 'loaded', leads: [lead({ id: 'w', current_stage: 'closed_won' })],
    });
    for (const stage of ALL_STAGES) {
      expect(leadsReducer(closed, { type: 'mark_start', leadId: 'w', stage, value: null })).toBe(closed);
    }
  });

  it('mark_start on an unknown lead or an already-pending lead is a no-op', () => {
    const s0 = two();
    expect(leadsReducer(s0, { type: 'mark_start', leadId: 'zzz', stage: 'contacted', value: null })).toBe(s0);
    const s1 = leadsReducer(s0, { type: 'mark_start', leadId: 'a', stage: 'contacted', value: null });
    expect(leadsReducer(s1, { type: 'mark_start', leadId: 'a', stage: 'qualified', value: null })).toBe(s1);
  });

  it('mark_success replaces the optimistic row with the SERVER row and clears pending', () => {
    const s1 = leadsReducer(two(), { type: 'mark_start', leadId: 'a', stage: 'closed_won', value: 500 });
    const server = lead({ id: 'a', current_stage: 'closed_won', value: 500, updated_at: '2026-07-06T12:00:00Z' });
    const s2 = leadsReducer(s1, { type: 'mark_success', leadId: 'a', lead: server });
    expect(s2.leads.find((l) => l.id === 'a')).toEqual(server);
    expect(s2.pending).toEqual({});
  });

  it('mark_fail rolls back to the snapshot and clears pending', () => {
    const s1 = leadsReducer(two(), { type: 'mark_start', leadId: 'a', stage: 'irrelevant', value: null });
    expect(s1.leads.find((l) => l.id === 'a')?.current_stage).toBe('irrelevant');
    const s2 = leadsReducer(s1, { type: 'mark_fail', leadId: 'a' });
    expect(s2.leads.find((l) => l.id === 'a')?.current_stage).toBe('new'); // rolled back
    expect(s2.pending).toEqual({});
  });

  it('mark_success / mark_fail without a pending snapshot are no-ops', () => {
    const s0 = two();
    expect(leadsReducer(s0, { type: 'mark_fail', leadId: 'a' })).toBe(s0);
    expect(leadsReducer(s0, { type: 'mark_success', leadId: 'a', lead: lead({ id: 'a' }) })).toBe(s0);
  });

  it('two in-flight marks on different leads roll back independently', () => {
    const s1 = leadsReducer(two(), { type: 'mark_start', leadId: 'a', stage: 'contacted', value: null });
    const s2 = leadsReducer(s1, { type: 'mark_start', leadId: 'b', stage: 'closed_lost', value: null });
    const s3 = leadsReducer(s2, { type: 'mark_fail', leadId: 'a' });
    expect(s3.leads.find((l) => l.id === 'a')?.current_stage).toBe('new');       // rolled back
    expect(s3.leads.find((l) => l.id === 'b')?.current_stage).toBe('closed_lost'); // still optimistic
    expect(Object.keys(s3.pending)).toEqual(['b']);
  });
});
