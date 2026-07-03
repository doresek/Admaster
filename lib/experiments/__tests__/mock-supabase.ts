// Minimal in-memory Supabase stub for the load-path tests. Implements exactly
// the PostgREST chain the reused data layers issue — select / eq / order /
// overrideTypes and thenable execution — over in-memory tables, logging every
// SELECT so tests can assert the one-query-per-table contract.
// (Own copy rather than importing lib/hypotheses' test harness: modules do not
// depend on each other's test internals.)

import type { SupabaseClient } from '@supabase/supabase-js';

export type MockRow = Record<string, unknown>;

interface MockResult {
  data:  unknown;
  error: { message: string } | null;
}

interface HarnessState {
  tables: Map<string, MockRow[]>;
  log:    string[];
  failOn: Set<string>; // e.g. 'select:hypotheses'
}

class MockQuery {
  private readonly filters: Array<(row: MockRow) => boolean> = [];

  constructor(private readonly state: HarnessState, private readonly table: string) {}

  select(_columns?: string): this { return this; }
  order(_column: string, _opts?: { ascending?: boolean }): this { return this; }
  overrideTypes(): this { return this; }

  eq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
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
    if (this.state.failOn.has(`select:${this.table}`)) {
      return { data: null, error: { message: `forced failure: select:${this.table}` } };
    }
    const rows = this.state.tables.get(this.table) ?? [];
    return { data: rows.filter((r) => this.filters.every((f) => f(r))), error: null };
  }
}

export interface SupabaseMock {
  client: SupabaseClient;
  seed(table: string, rows: MockRow[]): void;
  /** Every query performed, in order — the one-query-per-table tests assert on this. */
  log: string[];
  /** Force 'select:<table>' operations to return an error. */
  failOn: Set<string>;
}

export function mockSupabase(): SupabaseMock {
  const state: HarnessState = { tables: new Map(), log: [], failOn: new Set() };
  const shape = { from: (table: string) => new MockQuery(state, table) };
  // The real SupabaseClient is a class with protected members, so no structural
  // stub can satisfy its nominal type — this single documented widening at the
  // test boundary mirrors lib/hypotheses/__tests__/mock-supabase.
  const client = shape as unknown as SupabaseClient;
  return {
    client,
    seed:   (table, rows) => { state.tables.set(table, rows); },
    log:    state.log,
    failOn: state.failOn,
  };
}
