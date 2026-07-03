// Minimal in-memory Supabase admin stub for the fleet tests.
//
// Implements exactly the PostgREST chain lib/fleet uses — select / upsert
// (with onConflict), eq / gte, order, maybeSingle, overrideTypes, thenable
// execution — over plain in-memory tables, logging EVERY executed operation
// (reads included) so tests can assert query counts ("two content_performance
// queries only") and upsert idempotency by row count.

import type { SupabaseClient } from '@supabase/supabase-js';

export type MockRow = Record<string, unknown>;

interface MockResult {
  data:  unknown;
  error: { message: string } | null;
}

interface HarnessState {
  tables: Map<string, MockRow[]>;
  log:    string[];
  failOn: Set<string>;   // e.g. 'select:content_performance', 'upsert:fleet_daily_factors'
  seq:    number;
}

type Filter = (row: MockRow) => boolean;

class MockQuery {
  private readonly filters: Filter[] = [];
  private action: 'select' | 'upsert' = 'select';
  private payload: MockRow[] = [];
  private conflictKeys: string[] = [];
  private mode: 'list' | 'maybeSingle' = 'list';
  private ordering: { column: string; ascending: boolean } | null = null;

  constructor(private readonly state: HarnessState, private readonly table: string) {}

  select(_columns?: string): this { return this; }
  overrideTypes(): this { return this; }
  maybeSingle(): this { this.mode = 'maybeSingle'; return this; }

  upsert(rows: MockRow | MockRow[], opts?: { onConflict?: string }): this {
    this.action = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflictKeys = (opts?.onConflict ?? '').split(',').map((k) => k.trim()).filter(Boolean);
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push((r) => String(r[column]) >= String(value));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.ordering = { column, ascending: opts?.ascending ?? true };
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
      this.state.log.push(`${this.action}:${this.table}(FAILED)`);
      return { data: null, error: { message: `forced failure: ${this.action}:${this.table}` } };
    }
    const rows = this.run();
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

    if (this.action === 'upsert') {
      this.state.log.push(`upsert:${this.table}(${this.payload.length})`);
      return this.payload.map((incoming) => {
        const existing =
          this.conflictKeys.length > 0
            ? table.find((r) => this.conflictKeys.every((k) => r[k] === incoming[k]))
            : undefined;
        if (existing) {
          Object.assign(existing, incoming);
          return existing;
        }
        const row: MockRow = {
          id: `${this.table}-${++this.state.seq}`,
          created_at: new Date().toISOString(),
          ...incoming,
        };
        table.push(row);
        return row;
      });
    }

    this.state.log.push(`select:${this.table}`);
    const matched = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.ordering) {
      const { column, ascending } = this.ordering;
      matched.sort((a, b) => {
        const av = String(a[column]);
        const bv = String(b[column]);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return ascending ? cmp : -cmp;
      });
    }
    return matched;
  }
}

export interface AdminMock {
  admin: SupabaseClient;
  /** Replace a table's rows (stored and mutated by reference). */
  seed(table: string, rows: MockRow[]): void;
  /** Live view of a table's rows. */
  rows(table: string): MockRow[];
  /** Every executed operation in order — query-count assertions read this. */
  log: string[];
  /** Force '<action>:<table>' operations to return an error. */
  failOn: Set<string>;
}

export function mockAdmin(): AdminMock {
  const state: HarnessState = { tables: new Map(), log: [], failOn: new Set(), seq: 0 };
  const shape = { from: (table: string) => new MockQuery(state, table) };
  // The real SupabaseClient is a class with protected members, so no structural
  // stub can satisfy its nominal type — this widening at the test boundary is
  // the module's ONE tolerated cast (mirrors lib/hypotheses/__tests__/mock-supabase.ts).
  const admin = shape as unknown as SupabaseClient;
  return {
    admin,
    seed: (table, rows) => { state.tables.set(table, rows); },
    rows: (table) => state.tables.get(table) ?? [],
    log:    state.log,
    failOn: state.failOn,
  };
}
