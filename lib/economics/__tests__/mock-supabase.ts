// Minimal in-memory Supabase stub for the economics store tests, modeled on
// lib/hypotheses/__tests__/mock-supabase.ts (same conventions, extended with
// the `upsert` + `limit` chain the economics store uses).
//
// Implements exactly the PostgREST chain lib/economics/store.ts uses —
// select / upsert, eq / in, single / maybeSingle / overrideTypes, thenable
// list execution — over plain in-memory tables, logging every write so tests
// can assert write-vs-no-write semantics (e.g. refreshComputed below the
// sample floor must write NOTHING).

import type { SupabaseClient } from '@supabase/supabase-js';

export type MockRow = Record<string, unknown>;

interface MockResult {
  data:  unknown;
  error: { message: string } | null;
}

interface HarnessState {
  tables: Map<string, MockRow[]>;
  log:    string[];
  failOn: Set<string>; // e.g. 'select:funnel_leads', 'upsert:client_economics'
  seq:    number;
}

type Filter = (row: MockRow) => boolean;

class MockQuery {
  private readonly filters: Filter[] = [];
  private action: 'select' | 'insert' | 'upsert' = 'select';
  private payload: MockRow = {};
  private conflictKey: string | null = null;
  private mode: 'list' | 'single' | 'maybeSingle' = 'list';

  constructor(private readonly state: HarnessState, private readonly table: string) {}

  select(_columns?: string): this { return this; }
  insert(row: MockRow): this { this.action = 'insert'; this.payload = row; return this; }
  order(_column: string, _opts?: { ascending?: boolean }): this { return this; }
  limit(_n: number): this { return this; }
  overrideTypes(): this { return this; }
  single(): this { this.mode = 'single'; return this; }
  maybeSingle(): this { this.mode = 'maybeSingle'; return this; }

  upsert(row: MockRow, opts?: { onConflict?: string }): this {
    this.action = 'upsert';
    this.payload = row;
    this.conflictKey = opts?.onConflict ?? null;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    this.filters.push((r) => values.includes(r[column]));
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
      const row: MockRow = { id: `${this.table}-${++this.state.seq}`, ...this.payload };
      table.push(row);
      this.state.log.push(`insert:${this.table}`);
      return [row];
    }

    if (this.action === 'upsert') {
      // Real PostgREST merge-duplicates semantics: on conflict, UPDATE only
      // the sent columns (unsent columns keep their existing values).
      const key = this.conflictKey;
      const existing = key !== null ? table.find((r) => r[key] === this.payload[key]) : undefined;
      if (existing) {
        Object.assign(existing, this.payload);
        this.state.log.push(`upsert:${this.table}(update)`);
        return [existing];
      }
      const row: MockRow = { id: `${this.table}-${++this.state.seq}`, ...this.payload };
      table.push(row);
      this.state.log.push(`upsert:${this.table}(insert)`);
      return [row];
    }

    return table.filter((r) => this.filters.every((f) => f(r)));
  }
}

export interface SupabaseMock {
  client: SupabaseClient;
  /** Replace a table's rows (rows are stored and mutated by reference). */
  seed(table: string, rows: MockRow[]): void;
  /** Live view of a table's rows. */
  rows(table: string): MockRow[];
  /** Every write performed, in order — no-write assertions rely on this. */
  log: string[];
  /** Force '<action>:<table>' operations to return an error. */
  failOn: Set<string>;
}

export function mockSupabase(): SupabaseMock {
  const state: HarnessState = { tables: new Map(), log: [], failOn: new Set(), seq: 0 };
  const shape = { from: (table: string) => new MockQuery(state, table) };
  // The real SupabaseClient is a class with protected members, so no structural
  // stub can satisfy its nominal type — this widening at the test boundary is
  // the ONE documented cast, mirroring lib/hypotheses/__tests__/mock-supabase.ts.
  const client = shape as unknown as SupabaseClient;
  return {
    client,
    seed: (table, rows) => { state.tables.set(table, rows); },
    rows: (table) => state.tables.get(table) ?? [],
    log:    state.log,
    failOn: state.failOn,
  };
}
