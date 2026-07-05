// Tests for lib/economics/store.ts against the in-memory Supabase stub.
//
// Proves: owner/client scoping on reads, upsert validation (typed errors, no
// write), owner-seed semantics, refreshComputed merge semantics (below the
// sample floor NOTHING is written and seeded values remain; at/over the floor
// the data-derived fields merge without touching the owner's margin, with the
// right source transition owner→mixed / ∅→computed), and DB error propagation.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECONOMICS_COLUMNS,
  getEconomics,
  refreshComputed,
  upsertEconomics,
} from '@/lib/economics';
import { mockSupabase, type MockRow, type SupabaseMock } from './mock-supabase';

const CLIENT = 'client-1';
const OWNER  = 'owner-1';

const seededRow = (over: MockRow = {}): MockRow => ({
  id:                      'econ-1',
  client_id:               CLIENT,
  owner_user_id:           OWNER,
  contribution_margin_pct: 40,
  avg_deal_value:          2000,
  close_rate_pct:          20,
  payback_target_months:   6,
  currency:                'ILS',
  source:                  'owner',
  updated_at:              '2026-07-01T00:00:00Z',
  created_at:              '2026-07-01T00:00:00Z',
  ...over,
});

const wonLead = (value: number | null): MockRow => ({
  client_id: CLIENT, owner_user_id: OWNER, current_stage: 'closed_won', value,
});
const lostLead = (): MockRow => ({
  client_id: CLIENT, owner_user_id: OWNER, current_stage: 'closed_lost', value: null,
});

let db: SupabaseMock;
beforeEach(() => { db = mockSupabase(); });

describe('getEconomics', () => {
  it('returns the owned row', async () => {
    db.seed('client_economics', [seededRow()]);
    const row = await getEconomics(db.client, CLIENT, OWNER);
    expect(row?.contribution_margin_pct).toBe(40);
    expect(row?.source).toBe('owner');
  });

  it('returns null when no row exists (owner has not answered yet)', async () => {
    expect(await getEconomics(db.client, CLIENT, OWNER)).toBeNull();
  });

  it('is explicitly owner-scoped — another owner\'s row for the same client id is invisible', async () => {
    db.seed('client_economics', [seededRow({ owner_user_id: 'other-owner' })]);
    expect(await getEconomics(db.client, CLIENT, OWNER)).toBeNull();
  });

  it('propagates DB errors with the function name', async () => {
    db.failOn.add('select:client_economics');
    await expect(getEconomics(db.client, CLIENT, OWNER)).rejects.toThrow(/getEconomics:/);
  });

  it('selects the full contract column list', () => {
    // Lock the column list to the ClientEconomicsRow contract fields.
    for (const col of [
      'contribution_margin_pct', 'avg_deal_value', 'close_rate_pct',
      'payback_target_months', 'currency', 'source',
    ]) {
      expect(ECONOMICS_COLUMNS).toContain(col);
    }
  });
});

describe('upsertEconomics', () => {
  const validInput = {
    clientId:              CLIENT,
    ownerUserId:           OWNER,
    contributionMarginPct: 40,
    avgDealValue:          2000,
    closeRatePct:          20,
  };

  it('seeds a fresh row with source=owner and the defaults (payback 6, ILS)', async () => {
    const result = await upsertEconomics(db.client, validInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.contribution_margin_pct).toBe(40);
      expect(result.row.payback_target_months).toBe(6);
      expect(result.row.currency).toBe('ILS');
      expect(result.row.source).toBe('owner');
    }
    expect(db.rows('client_economics')).toHaveLength(1);
  });

  it('re-answering updates the SAME row (keyed on client_id), not a duplicate', async () => {
    db.seed('client_economics', [seededRow()]);
    const result = await upsertEconomics(db.client, { ...validInput, contributionMarginPct: 55 });
    expect(result.ok).toBe(true);
    expect(db.rows('client_economics')).toHaveLength(1);
    expect(db.rows('client_economics')[0].contribution_margin_pct).toBe(55);
    expect(db.log).toContain('upsert:client_economics(update)');
  });

  it('honors explicit payback target + currency', async () => {
    const result = await upsertEconomics(db.client, {
      ...validInput, paybackTargetMonths: 12, currency: 'USD',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.payback_target_months).toBe(12);
      expect(result.row.currency).toBe('USD');
    }
  });

  it('rejects out-of-range answers with typed field errors and writes NOTHING', async () => {
    const result = await upsertEconomics(db.client, {
      ...validInput, contributionMarginPct: 0, closeRatePct: 150,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.field).sort()).toEqual(
        ['closeRatePct', 'contributionMarginPct'],
      );
    }
    expect(db.log).toEqual([]); // validation failure never reaches the DB
  });

  it('propagates DB errors', async () => {
    db.failOn.add('upsert:client_economics');
    await expect(upsertEconomics(db.client, validInput)).rejects.toThrow(/upsertEconomics:/);
  });
});

describe('refreshComputed', () => {
  it('below the 5-closed-won floor: no write, seeded values remain (statistical humility)', async () => {
    db.seed('client_economics', [seededRow()]);
    db.seed('funnel_leads', [wonLead(1000), wonLead(2000), wonLead(3000), wonLead(4000), lostLead()]);

    const result = await refreshComputed(db.client, CLIENT, OWNER);
    expect(result).toEqual({ updated: false, reason: 'insufficient_sample', sampleN: 4 });
    // NOTHING was written — the owner's seeded guesses are still in force.
    expect(db.log).toEqual([]);
    expect(db.rows('client_economics')[0].close_rate_pct).toBe(20);
    expect(db.rows('client_economics')[0].source).toBe('owner');
  });

  it('≥5 valued wins over an owner-seeded row: merges close+deal, keeps margin, source→mixed', async () => {
    db.seed('client_economics', [seededRow()]);
    // 5 wins (avg 2000) + 5 lost → close 50.00%.
    db.seed('funnel_leads', [
      wonLead(1000), wonLead(2000), wonLead(3000), wonLead(1500), wonLead(2500),
      lostLead(), lostLead(), lostLead(), lostLead(), lostLead(),
    ]);

    const result = await refreshComputed(db.client, CLIENT, OWNER);
    expect(result.updated).toBe(true);
    if (result.updated) {
      expect(result.row.close_rate_pct).toBe(50);       // data replaced the 20% guess
      expect(result.row.avg_deal_value).toBe(2000);
      expect(result.row.contribution_margin_pct).toBe(40); // owner's margin untouched
      expect(result.row.payback_target_months).toBe(6);    // untouched
      expect(result.row.source).toBe('mixed');
    }
    expect(db.rows('client_economics')).toHaveLength(1);
  });

  it('≥5 valued wins with NO existing row: inserts a data-only row, source=computed', async () => {
    db.seed('funnel_leads', [
      wonLead(500), wonLead(500), wonLead(500), wonLead(500), wonLead(500),
    ]);
    const result = await refreshComputed(db.client, CLIENT, OWNER);
    expect(result.updated).toBe(true);
    if (result.updated) {
      expect(result.row.close_rate_pct).toBe(100);
      expect(result.row.avg_deal_value).toBe(500);
      expect(result.row.source).toBe('computed');
    }
    expect(db.log).toContain('upsert:client_economics(insert)');
  });

  it('existing row WITHOUT an owner margin (previous computed run) stays source=computed', async () => {
    db.seed('client_economics', [seededRow({ contribution_margin_pct: null, source: 'computed' })]);
    db.seed('funnel_leads', [
      wonLead(100), wonLead(100), wonLead(100), wonLead(100), wonLead(100),
    ]);
    const result = await refreshComputed(db.client, CLIENT, OWNER);
    expect(result.updated).toBe(true);
    if (result.updated) expect(result.row.source).toBe('computed');
  });

  it('only counts THIS client+owner\'s leads (explicit scoping under a service-role client)', async () => {
    // 5 valued wins, but 3 belong to another client / owner → sample is 2.
    db.seed('funnel_leads', [
      wonLead(1000), wonLead(1000),
      { ...wonLead(1000), client_id: 'other-client' },
      { ...wonLead(1000), owner_user_id: 'other-owner' },
      { ...wonLead(1000), client_id: 'other-client', owner_user_id: 'other-owner' },
    ]);
    const result = await refreshComputed(db.client, CLIENT, OWNER);
    expect(result).toEqual({ updated: false, reason: 'insufficient_sample', sampleN: 2 });
  });

  it('propagates read errors (funnel_leads) and write errors (client_economics)', async () => {
    db.failOn.add('select:funnel_leads');
    await expect(refreshComputed(db.client, CLIENT, OWNER))
      .rejects.toThrow(/refreshComputed: reading funnel_leads/);

    db.failOn.clear();
    db.seed('funnel_leads', [
      wonLead(100), wonLead(100), wonLead(100), wonLead(100), wonLead(100),
    ]);
    db.failOn.add('upsert:client_economics');
    await expect(refreshComputed(db.client, CLIENT, OWNER))
      .rejects.toThrow(/refreshComputed: writing client_economics/);
  });
});
