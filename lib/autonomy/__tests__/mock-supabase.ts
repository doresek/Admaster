// Minimal in-memory Supabase stub for the autonomy store/composition tests,
// modeled on lib/hypotheses/__tests__/mock-supabase.ts (each capability folder
// owns its stub) and extended with the two shapes the autonomy store needs:
// `gte` filters (ISO timestamps compare lexicographically) and head/count
// selects (countTodayActions). Every write is logged so tests can assert
// exact audit behavior — including "no event was written" for the fail-safe.

import type { SupabaseClient } from '@supabase/supabase-js';

export type MockRow = Record<string, unknown>;

interface MockResult {
  data:   unknown;
  error:  { message: string } | null;
  count?: number | null;
}

interface HarnessState {
  tables: Map<string, MockRow[]>;
  log:    string[];
  failOn: Set<string>; // e.g. 'insert:autonomy_events', 'update:client_autonomy'
  seq:    number;
}

type Filter = (row: MockRow) => boolean;

class MockQuery {
  private readonly filters: Filter[] = [];
  private action: 'select' | 'insert' | 'update' = 'select';
  private payload: MockRow = {};
  private mode: 'list' | 'single' | 'maybeSingle' | 'count' = 'list';

  constructor(private readonly state: HarnessState, private readonly table: string) {}

  select(_columns?: string, opts?: { count?: 'exact'; head?: boolean }): this {
    if (opts?.count === 'exact' && opts.head) this.mode = 'count';
    return this;
  }
  insert(row: MockRow): this { this.action = 'insert'; this.payload = row; return this; }
  update(patch: MockRow): this { this.action = 'update'; this.payload = patch; return this; }
  order(_column: string, _opts?: { ascending?: boolean }): this { return this; }
  overrideTypes(): this { return this; }
  single(): this { this.mode = 'single'; return this; }
  maybeSingle(): this { this.mode = 'maybeSingle'; return this; }

  eq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
    return this;
  }

  gte(column: string, value: string): this {
    this.filters.push((r) => typeof r[column] === 'string' && r[column] >= value);
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
      return { data: null, error: { message: `forced failure: ${this.action}:${this.table}` }, count: null };
    }
    const rows = this.run();
    if (this.mode === 'count') {
      return { data: null, error: null, count: rows.length };
    }
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
      const row: MockRow = { id: `${this.table}-${++this.state.seq}`, ...this.payload };
      table.push(row);
      this.state.log.push(`insert:${this.table}`);
      return [row];
    }

    const matched = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.action === 'update') {
      for (const r of matched) Object.assign(r, this.payload);
      this.state.log.push(`update:${this.table}(${matched.length})`);
    }
    return matched;
  }
}

export interface SupabaseMock {
  client: SupabaseClient;
  /** Replace a table's rows (rows are stored and mutated by reference). */
  seed(table: string, rows: MockRow[]): void;
  /** Live view of a table's rows. */
  rows(table: string): MockRow[];
  /** Every write performed, in order — audit-behavior tests assert on this. */
  log: string[];
  /** Force '<action>:<table>' operations to return an error. */
  failOn: Set<string>;
}

export function mockSupabase(): SupabaseMock {
  const state: HarnessState = { tables: new Map(), log: [], failOn: new Set(), seq: 0 };
  const shape = { from: (table: string) => new MockQuery(state, table) };
  // The real SupabaseClient is a class with protected members, so no structural
  // stub can satisfy its nominal type — this ONE widening at the test boundary
  // is the repo's tolerated nominal cast (per lib/hypotheses/__tests__/mock-supabase.ts).
  const client = shape as unknown as SupabaseClient;
  return {
    client,
    seed: (table, rows) => { state.tables.set(table, rows); },
    rows: (table) => state.tables.get(table) ?? [],
    log:    state.log,
    failOn: state.failOn,
  };
}
