// Minimal in-memory Supabase stub for the voc pipeline tests.
//
// Implements exactly the PostgREST chain lib/voc and the lib/intelligence
// data layer/lifecycle use — select / insert (single row AND batch array) /
// update, eq / order / limit, single / maybeSingle / overrideTypes, thenable
// execution — over plain in-memory tables, logging every write so tests can
// assert "quotes batch-inserted ONCE" / idempotency by op count. Adapted from
// lib/hypotheses/__tests__/mock-supabase.ts (order/limit made real, batch
// insert added) — kept local per the capability-folder collision doctrine.

import type { SupabaseClient } from '@supabase/supabase-js';

export type MockRow = Record<string, unknown>;

interface MockResult {
  data:  unknown;
  error: { message: string; code?: string } | null;
}

interface HarnessState {
  tables: Map<string, MockRow[]>;
  log:    string[];
  failOn: Set<string>; // e.g. 'insert:voc_quotes', 'select:client_insights'
  seq:    number;
}

type Filter = (row: MockRow) => boolean;

class MockQuery {
  private readonly filters: Filter[] = [];
  private action: 'select' | 'insert' | 'update' = 'select';
  private payload: MockRow | MockRow[] = {};
  private mode: 'list' | 'single' | 'maybeSingle' = 'list';
  private ordering: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;

  constructor(private readonly state: HarnessState, private readonly table: string) {}

  select(_columns?: string): this { return this; }
  insert(rows: MockRow | MockRow[]): this { this.action = 'insert'; this.payload = rows; return this; }
  update(patch: MockRow): this { this.action = 'update'; this.payload = patch; return this; }
  overrideTypes(): this { return this; }
  single(): this { this.mode = 'single'; return this; }
  maybeSingle(): this { this.mode = 'maybeSingle'; return this; }
  limit(n: number): this { this.limitN = n; return this; }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.ordering = { column, ascending: opts?.ascending !== false };
    return this;
  }

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
    if (this.state.failOn.has(`${this.action}:${this.table}`)) {
      return { data: null, error: { message: `forced failure: ${this.action}:${this.table}` } };
    }
    const rows = this.run();
    if (this.mode === 'single') {
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { message: `single(): expected 1 row in ${this.table}, got ${rows.length}` } };
    }
    if (this.mode === 'maybeSingle') {
      return rows.length <= 1
        ? { data: rows[0] ?? null, error: null }
        : { data: null, error: { message: `maybeSingle(): multiple rows in ${this.table}` } };
    }
    return { data: rows, error: null };
  }

  private run(): MockRow[] {
    const table = this.state.tables.get(this.table) ?? [];
    if (!this.state.tables.has(this.table)) this.state.tables.set(this.table, table);

    if (this.action === 'insert') {
      const inputs = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = inputs.map((input) => {
        const row: MockRow = { id: `${this.table}-${++this.state.seq}`, ...input };
        table.push(row);
        return row;
      });
      // ONE log entry per insert CALL — batch-vs-N-inserts is asserted on this.
      this.state.log.push(`insert:${this.table}(${inserted.length})`);
      return inserted;
    }

    let matched = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.action === 'update') {
      for (const r of matched) Object.assign(r, this.payload);
      this.state.log.push(`update:${this.table}(${matched.length})`);
      return matched;
    }

    if (this.ordering) {
      const { column, ascending } = this.ordering;
      matched = [...matched].sort((a, b) => {
        const av = a[column]; const bv = b[column];
        const cmp = String(av ?? '') < String(bv ?? '') ? -1 : String(av ?? '') > String(bv ?? '') ? 1 : 0;
        return ascending ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) matched = matched.slice(0, this.limitN);
    return matched;
  }
}

export interface SupabaseMock {
  client: SupabaseClient;
  /** Replace a table's rows (rows are stored and mutated by reference). */
  seed(table: string, rows: MockRow[]): void;
  /** Live view of a table's rows. */
  rows(table: string): MockRow[];
  /** Every write performed, in order. */
  log: string[];
  /** Force '<action>:<table>' operations to return an error. */
  failOn: Set<string>;
}

export function mockSupabase(): SupabaseMock {
  const state: HarnessState = { tables: new Map(), log: [], failOn: new Set(), seq: 0 };
  const shape = { from: (table: string) => new MockQuery(state, table) };
  // The real SupabaseClient is a class with protected members, so no structural
  // stub can satisfy its nominal type — this widening at the test boundary is
  // the repo's ONE tolerated documented cast (mirrors lib/hypotheses'
  // mock-supabase.ts and tests/recommendations-selection.test.ts).
  const client = shape as unknown as SupabaseClient;
  return {
    client,
    seed: (table, rows) => { state.tables.set(table, rows); },
    rows: (table) => state.tables.get(table) ?? [],
    log:    state.log,
    failOn: state.failOn,
  };
}
