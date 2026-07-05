// In-memory Supabase stub for the measurement-core tests.
//
// Extends the lib/hypotheses/__tests__/mock-supabase.ts pattern with the
// additional PostgREST surface this layer uses: gte / lt / lte, a REAL
// order-by (dedupe picks newest-first), limit, and upsert-with-onConflict
// (channel_reconciliation). Every write is logged so tests can assert exact
// write sequences ("no duplicate lead row") by op count.

import type { SupabaseClient } from '@supabase/supabase-js';

export type MockRow = Record<string, unknown>;

interface MockResult {
  data:  unknown;
  error: { message: string } | null;
}

interface HarnessState {
  tables: Map<string, MockRow[]>;
  log:    string[];
  failOn: Set<string>; // e.g. 'insert:funnel_leads', 'select:lead_touchpoints'
  seq:    number;
}

type Filter = (row: MockRow) => boolean;

const cmp = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

class MockQuery {
  private readonly filters: Filter[] = [];
  private action: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private payload: MockRow = {};
  private conflictKeys: string[] = [];
  private mode: 'list' | 'single' | 'maybeSingle' = 'list';
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;

  constructor(private readonly state: HarnessState, private readonly table: string) {}

  select(_columns?: string): this { return this; }
  insert(row: MockRow): this { this.action = 'insert'; this.payload = row; return this; }
  update(patch: MockRow): this { this.action = 'update'; this.payload = patch; return this; }
  upsert(row: MockRow, opts?: { onConflict?: string }): this {
    this.action = 'upsert';
    this.payload = row;
    this.conflictKeys = (opts?.onConflict ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return this;
  }
  overrideTypes(): this { return this; }
  single(): this { this.mode = 'single'; return this; }
  maybeSingle(): this { this.mode = 'maybeSingle'; return this; }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n: number): this { this.limitN = n; return this; }

  eq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  in(column: string, values: readonly unknown[]): this {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  gte(column: string, value: unknown): this {
    this.filters.push((r) => cmp(r[column], value) >= 0);
    return this;
  }
  lte(column: string, value: unknown): this {
    this.filters.push((r) => cmp(r[column], value) <= 0);
    return this;
  }
  lt(column: string, value: unknown): this {
    this.filters.push((r) => cmp(r[column], value) < 0);
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
      const row: MockRow = {
        id:         `${this.table}-${++this.state.seq}`,
        created_at: new Date().toISOString(),
        ...this.payload,
      };
      table.push(row);
      this.state.log.push(`insert:${this.table}`);
      return [row];
    }

    if (this.action === 'upsert') {
      const conflictMatch = this.conflictKeys.length > 0
        ? table.find((r) => this.conflictKeys.every((k) => r[k] === this.payload[k]))
        : undefined;
      if (conflictMatch) {
        Object.assign(conflictMatch, this.payload);
        this.state.log.push(`upsert:${this.table}(update)`);
        return [conflictMatch];
      }
      const row: MockRow = {
        id:         `${this.table}-${++this.state.seq}`,
        created_at: new Date().toISOString(),
        ...this.payload,
      };
      table.push(row);
      this.state.log.push(`upsert:${this.table}(insert)`);
      return [row];
    }

    let matched = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.action === 'update') {
      for (const r of matched) Object.assign(r, this.payload);
      this.state.log.push(`update:${this.table}(${matched.length})`);
      return matched;
    }

    if (this.orderBy !== null) {
      const { column, ascending } = this.orderBy;
      matched = [...matched].sort((a, b) => (ascending ? 1 : -1) * cmp(a[column], b[column]));
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
  // the repo's documented stub cast (see lib/hypotheses/__tests__/mock-supabase.ts).
  const client = shape as unknown as SupabaseClient;
  return {
    client,
    seed: (table, rows) => { state.tables.set(table, rows); },
    rows: (table) => state.tables.get(table) ?? [],
    log:    state.log,
    failOn: state.failOn,
  };
}
