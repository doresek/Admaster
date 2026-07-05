// Minimal in-memory Supabase stub for the metrics-layer loader tests —
// implements exactly the PostgREST chain load.ts uses (select / eq / gte / lt
// / lte / maybeSingle / overrideTypes, thenable execution) over plain
// in-memory tables, logging every executed select so tests can assert "one
// query per table" (no N+1) by op count. Supports per-table error injection
// for the error-propagation tests.

import type { SupabaseClient } from '@supabase/supabase-js';

export type MockRow = Record<string, unknown>;

interface MockResult {
  data:  unknown;
  error: { message: string } | null;
}

interface HarnessState {
  tables:     Map<string, MockRow[]>;
  log:        string[];
  failTables: Set<string>;
}

type Filter = (row: MockRow) => boolean;

function compare(rowValue: unknown, op: 'eq' | 'gte' | 'lte' | 'lt', value: string): boolean {
  if (rowValue === null || rowValue === undefined) return false;
  const s = String(rowValue);
  switch (op) {
    case 'eq':  return s === value;
    case 'gte': return s >= value;
    case 'lte': return s <= value;
    case 'lt':  return s < value;
  }
}

class MockQuery {
  private readonly filters: Filter[] = [];
  private mode: 'list' | 'maybeSingle' = 'list';

  constructor(private readonly state: HarnessState, private readonly table: string) {}

  select(_columns?: string): this { return this; }
  overrideTypes(): this { return this; }
  maybeSingle(): this { this.mode = 'maybeSingle'; return this; }

  eq(column: string, value: unknown): this {
    this.filters.push((r) => compare(r[column], 'eq', String(value)));
    return this;
  }
  gte(column: string, value: unknown): this {
    this.filters.push((r) => compare(r[column], 'gte', String(value)));
    return this;
  }
  lte(column: string, value: unknown): this {
    this.filters.push((r) => compare(r[column], 'lte', String(value)));
    return this;
  }
  lt(column: string, value: unknown): this {
    this.filters.push((r) => compare(r[column], 'lt', String(value)));
    return this;
  }

  then<TResult1 = MockResult, TResult2 = never>(
    onfulfilled?: ((value: MockResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?:  ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): MockResult {
    this.state.log.push(`select:${this.table}`);
    if (this.state.failTables.has(this.table)) {
      return { data: null, error: { message: `injected failure on ${this.table}` } };
    }
    const rows = (this.state.tables.get(this.table) ?? []).filter(
      (r) => this.filters.every((f) => f(r)),
    );
    if (this.mode === 'maybeSingle') {
      return rows.length <= 1
        ? { data: rows[0] ?? null, error: null }
        : { data: null, error: { message: `maybeSingle(): multiple rows in ${this.table}` } };
    }
    return { data: rows, error: null };
  }
}

export interface SupabaseMock {
  client: SupabaseClient;
  /** Seed a table with (typed) fixture rows — copied into plain records. */
  seed(table: string, rows: readonly object[]): void;
  /** Make every query against `table` return an error. */
  fail(table: string): void;
  /** Every executed op in order — query-count tests assert on this. */
  log: string[];
}

/** Interface rows aren't assignable to Record<string, unknown> — copy fields. */
const toRow = (v: object): MockRow => Object.fromEntries(Object.entries(v));

export function mockSupabase(): SupabaseMock {
  const state: HarnessState = { tables: new Map(), log: [], failTables: new Set() };
  const shape = { from: (table: string) => new MockQuery(state, table) };
  // The real SupabaseClient is a class with protected members, so no structural
  // stub can satisfy its nominal type — this single documented widening at the
  // test boundary mirrors the repo's existing stubs (lib/digest/__tests__).
  const client = shape as unknown as SupabaseClient;
  return {
    client,
    seed: (table, rows) => { state.tables.set(table, rows.map(toRow)); },
    fail: (table) => { state.failTables.add(table); },
    log:  state.log,
  };
}
