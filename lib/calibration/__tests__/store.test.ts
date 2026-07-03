// lib/calibration/__tests__/store.test.ts
//
// Store-layer tests with a stubbed DB implementing the CalibrationDb seam
// directly (no casts): filters applied, window math, error propagation, and
// the read-modify-write merge semantics of stampBrier.

import { describe, expect, it } from 'vitest';
import { loadSamples, stampBrier, type CalibrationDb, type DbResponse, type HypothesesFilter } from '../store';
import { HYPOTHESIS_COLUMNS } from '@/lib/capability-contracts';

interface RecordedFilter { chain: 'select' | 'update'; op: 'eq' | 'in' | 'gte'; column: string; value: unknown }

interface StubState {
  selects: string[];
  filters: RecordedFilter[];
  updates: Array<Record<string, unknown>>;
}

interface StubResponses {
  /** Resolves an awaited select chain (loadSamples). */
  rows?:   DbResponse;
  /** Resolves .single() on a select chain (stampBrier read). */
  single?: DbResponse;
  /** Resolves an awaited update chain (stampBrier write). */
  update?: DbResponse;
}

const OK: DbResponse = { data: null, error: null };

/** A minimal hand-rolled stub of the CalibrationDb seam that records calls. */
const makeStub = (responses: StubResponses): { db: CalibrationDb; state: StubState } => {
  const state: StubState = { selects: [], filters: [], updates: [] };

  const makeFilter = (chain: 'select' | 'update'): HypothesesFilter => {
    const result = chain === 'select' ? (responses.rows ?? OK) : (responses.update ?? OK);
    const filter: HypothesesFilter = {
      eq(column, value)  { state.filters.push({ chain, op: 'eq',  column, value }); return filter; },
      in(column, values) { state.filters.push({ chain, op: 'in',  column, value: values }); return filter; },
      gte(column, value) { state.filters.push({ chain, op: 'gte', column, value }); return filter; },
      single() {
        return { then: (onfulfilled) => Promise.resolve(responses.single ?? OK).then(onfulfilled) };
      },
      then(onfulfilled) { return Promise.resolve(result).then(onfulfilled); },
    };
    return filter;
  };

  const db: CalibrationDb = {
    from(_table) {
      return {
        select(columns) { state.selects.push(columns); return makeFilter('select'); },
        update(values)  { state.updates.push(values);  return makeFilter('update'); },
      };
    },
  };
  return { db, state };
};

const filterOf = (state: StubState, chain: RecordedFilter['chain'], op: RecordedFilter['op'], column: string) =>
  state.filters.find((f) => f.chain === chain && f.op === op && f.column === column);

const row = (status: string, domain: string, prediction: Record<string, unknown>): Record<string, unknown> =>
  ({ id: 'h', status, domain, prediction, resolution: {}, resolved_at: '2026-06-01T00:00:00Z' });

describe('loadSamples', () => {
  it('selects HYPOTHESIS_COLUMNS and applies owner/status/window filters', async () => {
    const { db, state } = makeStub({ rows: { data: [], error: null } });
    const before = Date.now();
    await loadSamples(db, { ownerUserId: 'user-1' });
    const after = Date.now();

    expect(state.selects).toEqual([HYPOTHESIS_COLUMNS]);
    expect(filterOf(state, 'select', 'eq', 'owner_user_id')?.value).toBe('user-1');
    expect(filterOf(state, 'select', 'in', 'status')?.value).toEqual(['supported', 'refuted']);

    // Default window: resolved_at >= now − 90d (checked to a few seconds).
    const gte = filterOf(state, 'select', 'gte', 'resolved_at');
    if (typeof gte?.value !== 'string') throw new Error('expected gte filter on resolved_at');
    const since = new Date(gte.value).getTime();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    expect(since).toBeGreaterThanOrEqual(before - ninetyDays - 5000);
    expect(since).toBeLessThanOrEqual(after - ninetyDays + 5000);

    // No client filter unless a clientId is given.
    expect(filterOf(state, 'select', 'eq', 'client_id')).toBeUndefined();
  });

  it('applies the client filter and a custom window when given', async () => {
    const { db, state } = makeStub({ rows: { data: [], error: null } });
    const before = Date.now();
    await loadSamples(db, { ownerUserId: 'user-1', clientId: 'client-9', windowDays: 7 });

    expect(filterOf(state, 'select', 'eq', 'client_id')?.value).toBe('client-9');
    const gte = filterOf(state, 'select', 'gte', 'resolved_at');
    if (typeof gte?.value !== 'string') throw new Error('expected gte filter on resolved_at');
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(new Date(gte.value).getTime() - (before - sevenDays))).toBeLessThan(5000);
  });

  it('maps rows through toSample and drops rows without a usable sample', async () => {
    const { db } = makeStub({
      rows: {
        data: [
          row('supported', 'angle', { confidence: 0.8 }),
          row('refuted', 'offer', { confidence: 0.6 }),
          row('supported', 'offer', {}),                    // missing confidence → dropped
          row('supported', 'audience', { confidence: 'x' }), // junk jsonb → dropped
          'not-an-object',                                    // integrity backstop → dropped
        ],
        error: null,
      },
    });
    const samples = await loadSamples(db, { ownerUserId: 'user-1' });
    expect(samples).toEqual([
      { domain: 'angle', predicted: 0.8, outcome: 1 },
      { domain: 'offer', predicted: 0.6, outcome: 0 },
    ]);
  });

  it('propagates query errors', async () => {
    const { db } = makeStub({ rows: { data: null, error: { message: 'connection reset' } } });
    await expect(loadSamples(db, { ownerUserId: 'user-1' })).rejects.toThrow(/loadSamples: connection reset/);
  });

  it('rejects a nonsensical window before touching the DB', async () => {
    const { db, state } = makeStub({});
    for (const windowDays of [0, -3, Number.NaN]) {
      await expect(loadSamples(db, { ownerUserId: 'user-1', windowDays })).rejects.toThrow(/windowDays/);
    }
    expect(state.selects).toEqual([]);
  });
});

describe('stampBrier', () => {
  const existingResolution = {
    observed:       { arm_a: { cvr: 0.031 } },
    verdict_reason: 'floor met, effect above minimum',
    resolved_by:    'floor_met',
  };

  it('merges brier into the current resolution without clobbering other fields', async () => {
    const { db, state } = makeStub({
      single: { data: { id: 'hyp-1', resolution: existingResolution }, error: null },
    });
    await stampBrier(db, 'hyp-1', 0.04);

    expect(state.updates).toHaveLength(1);
    const patch = state.updates[0];
    expect(patch.resolution).toEqual({ ...existingResolution, brier: 0.04 });
    expect(typeof patch.updated_at).toBe('string');
    // Both the read and the write are keyed to the hypothesis id.
    expect(filterOf(state, 'select', 'eq', 'id')?.value).toBe('hyp-1');
    expect(filterOf(state, 'update', 'eq', 'id')?.value).toBe('hyp-1');
  });

  it('overwrites a previously stamped brier (idempotent re-stamp)', async () => {
    const { db, state } = makeStub({
      single: { data: { id: 'hyp-1', resolution: { ...existingResolution, brier: 0.5 } }, error: null },
    });
    await stampBrier(db, 'hyp-1', 0.25);
    expect(state.updates[0].resolution).toEqual({ ...existingResolution, brier: 0.25 });
  });

  it('refuses to stamp a hypothesis with no resolution', async () => {
    const { db, state } = makeStub({ single: { data: { id: 'hyp-1', resolution: null }, error: null } });
    await expect(stampBrier(db, 'hyp-1', 0.1)).rejects.toThrow(/no resolution/);
    expect(state.updates).toEqual([]);
  });

  it('propagates read and write errors', async () => {
    const readFail = makeStub({ single: { data: null, error: { message: 'row not found' } } });
    await expect(stampBrier(readFail.db, 'hyp-1', 0.1)).rejects.toThrow(/read failed: row not found/);

    const writeFail = makeStub({
      single: { data: { id: 'hyp-1', resolution: existingResolution }, error: null },
      update: { data: null, error: { message: 'permission denied' } },
    });
    await expect(stampBrier(writeFail.db, 'hyp-1', 0.1)).rejects.toThrow(/update failed: permission denied/);
  });

  it('rejects an invalid brier value before touching the DB', async () => {
    const { db, state } = makeStub({});
    for (const bad of [Number.NaN, -0.1, 1.2, Number.POSITIVE_INFINITY]) {
      await expect(stampBrier(db, 'hyp-1', bad)).rejects.toThrow(/brier must be/);
    }
    expect(state.selects).toEqual([]);
    expect(state.updates).toEqual([]);
  });
});
