// Minimal in-memory Supabase stub for the strategy-objects store tests.
//
// Implements exactly the PostgREST chain this module uses — select / insert /
// update, eq / gte, order (REAL sorting — the version-max read depends on it),
// limit, single / maybeSingle / overrideTypes, thenable execution — plus two
// harness features the version-race tests need:
//   • uniqueOn(table, cols)  — emulates a unique constraint: a duplicate
//     insert returns SQLSTATE 23505, like the real (client_id, version) index.
//   • beforeInsert(table, fn) — a hook that runs just before an insert lands,
//     so a test can interleave a "competing writer" between the store's
//     read-max and its insert (the exact race saveArchitecture documents).

import type { SupabaseClient } from '@supabase/supabase-js';

export type MockRow = Record<string, unknown>;

interface MockResult {
  data:  unknown;
  error: { code?: string; message: string } | null;
}

interface HarnessState {
  tables:       Map<string, MockRow[]>;
  log:          string[];
  uniqueIndex:  Map<string, string[]>;
  beforeInsert: Map<string, (payload: MockRow) => void>;
  seq:          number;
}

type Filter = (row: MockRow) => boolean;

class MockQuery {
  private readonly filters: Filter[] = [];
  private action: 'select' | 'insert' | 'update' = 'select';
  private payload: MockRow = {};
  private mode: 'list' | 'single' | 'maybeSingle' = 'list';
  private sort: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;

  constructor(private readonly state: HarnessState, private readonly table: string) {}

  select(_columns?: string): this { return this; }
  insert(row: MockRow): this { this.action = 'insert'; this.payload = row; return this; }
  update(patch: MockRow): this { this.action = 'update'; this.payload = patch; return this; }
  overrideTypes(): this { return this; }
  single(): this { this.mode = 'single'; return this; }
  maybeSingle(): this { this.mode = 'maybeSingle'; return this; }
  limit(n: number): this { this.max = n; return this; }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.sort = { column, ascending: opts?.ascending !== false };
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] === value);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push((r) => {
      const v = r[column];
      return (typeof v === 'string' || typeof v === 'number') &&
             (typeof value === 'string' || typeof value === 'number') &&
             v >= value;
    });
    return this;
  }

  then<TResult1 = MockResult, TResult2 = never>(
    onfulfilled?: ((value: MockResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?:  ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): MockResult {
    const rows = this.run();
    if ('error' in rows) return { data: null, error: rows.error };
    if (this.mode === 'single') {
      return rows.list.length === 1
        ? { data: rows.list[0], error: null }
        : { data: null, error: { message: `single(): expected 1 row in ${this.table}, got ${rows.list.length}` } };
    }
    if (this.mode === 'maybeSingle') {
      return rows.list.length <= 1
        ? { data: rows.list[0] ?? null, error: null }
        : { data: null, error: { message: `maybeSingle(): multiple rows in ${this.table}` } };
    }
    return { data: rows.list, error: null };
  }

  private run(): { list: MockRow[] } | { error: { code?: string; message: string } } {
    const table = this.state.tables.get(this.table) ?? [];
    if (!this.state.tables.has(this.table)) this.state.tables.set(this.table, table);

    if (this.action === 'insert') {
      this.state.beforeInsert.get(this.table)?.(this.payload);
      const unique = this.state.uniqueIndex.get(this.table);
      if (unique && table.some((r) => unique.every((c) => r[c] === this.payload[c]))) {
        this.state.log.push(`conflict:${this.table}`);
        return {
          error: {
            code: '23505',
            message: `duplicate key value violates unique constraint "${this.table}_uniq"`,
          },
        };
      }
      const row: MockRow = {
        id: `${this.table}-${++this.state.seq}`,
        created_at: new Date(Date.UTC(2026, 5, 1, 0, 0, this.state.seq)).toISOString(),
        ...this.payload,
      };
      table.push(row);
      this.state.log.push(`insert:${this.table}`);
      return { list: [row] };
    }

    let matched = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.action === 'update') {
      for (const r of matched) Object.assign(r, this.payload);
      this.state.log.push(`update:${this.table}(${matched.length})`);
      return { list: matched };
    }

    this.state.log.push(`select:${this.table}`);
    if (this.sort) {
      const { column, ascending } = this.sort;
      matched = [...matched].sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        const cmp =
          (typeof av === 'number' && typeof bv === 'number') ? av - bv :
          String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
        return ascending ? cmp : -cmp;
      });
    }
    if (this.max !== null) matched = matched.slice(0, this.max);
    return { list: matched };
  }
}

export interface SupabaseMock {
  client: SupabaseClient;
  seed(table: string, rows: MockRow[]): void;
  rows(table: string): MockRow[];
  /** Every operation, in order — 'select:t' / 'insert:t' / 'update:t(n)' / 'conflict:t'. */
  log: string[];
  /** Enforce a unique index on `columns` for `table` (insert → 23505 on duplicate). */
  uniqueOn(table: string, columns: string[]): void;
  /** Run `fn(payload)` right before every insert into `table` (race injection). */
  beforeInsert(table: string, fn: (payload: MockRow) => void): void;
}

export function mockSupabase(): SupabaseMock {
  const state: HarnessState = {
    tables: new Map(), log: [], uniqueIndex: new Map(), beforeInsert: new Map(), seq: 0,
  };
  const shape = { from: (table: string) => new MockQuery(state, table) };
  // The real SupabaseClient is a class with protected members, so no structural
  // stub can satisfy its nominal type — this single documented widening at the
  // test boundary mirrors lib/hypotheses/__tests__/mock-supabase.ts.
  const client = shape as unknown as SupabaseClient;
  return {
    client,
    seed: (table, rows) => { state.tables.set(table, rows); },
    rows: (table) => state.tables.get(table) ?? [],
    log: state.log,
    uniqueOn: (table, columns) => { state.uniqueIndex.set(table, columns); },
    beforeInsert: (table, fn) => { state.beforeInsert.set(table, fn); },
  };
}
