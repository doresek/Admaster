// Minimal in-memory Supabase stub for the digest store/load tests.
//
// Implements exactly the PostgREST chain lib/digest uses — select / insert /
// update, eq / gte / lt / lte / in / or (flat disjunction incl. `col.in.(…)`),
// order / limit, single / maybeSingle / overrideTypes, thenable execution —
// over plain in-memory tables, logging every executed operation so tests can
// assert "one query per table" (no N+1) by op count.

import type { SupabaseClient } from '@supabase/supabase-js';

export type MockRow = Record<string, unknown>;

interface MockResult {
  data:  unknown;
  error: { message: string } | null;
}

interface HarnessState {
  tables: Map<string, MockRow[]>;
  log:    string[];
  seq:    number;
}

type Filter = (row: MockRow) => boolean;

/** value comparison used by eq/gte/lt/lte — null/undefined never match. */
function compare(rowValue: unknown, op: 'eq' | 'gte' | 'lte' | 'lt' | 'gt', value: string): boolean {
  if (rowValue === null || rowValue === undefined) return false;
  const s = String(rowValue);
  switch (op) {
    case 'eq':  return s === value;
    case 'gte': return s >= value;
    case 'lte': return s <= value;
    case 'lt':  return s < value;
    case 'gt':  return s > value;
  }
}

/** Split a PostgREST or() expression on top-level commas (paren-aware). */
function splitTopLevel(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of expr) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** Parse one `col.op.value` condition (op ∈ eq,gte,lte,lt,gt,in). */
function parseCondition(cond: string): Filter {
  const m = /^([a-zA-Z_]+)\.(eq|gte|lte|lt|gt|in)\.([\s\S]*)$/.exec(cond);
  if (!m) throw new Error(`mock or(): unsupported condition '${cond}'`);
  const [, col, op, rest] = m;
  if (op === 'in') {
    const values = rest.replace(/^\(/, '').replace(/\)$/, '').split(',');
    return (r) => r[col] !== null && r[col] !== undefined && values.includes(String(r[col]));
  }
  return (r) => compare(r[col], op === 'eq' ? 'eq' : op === 'gte' ? 'gte' : op === 'lte' ? 'lte' : op === 'lt' ? 'lt' : 'gt', rest);
}

class MockQuery {
  private readonly filters: Filter[] = [];
  private action: 'select' | 'insert' | 'update' = 'select';
  private payload: MockRow = {};
  private mode: 'list' | 'single' | 'maybeSingle' = 'list';
  private ordering: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;

  constructor(private readonly state: HarnessState, private readonly table: string) {}

  select(_columns?: string): this { return this; }
  insert(row: MockRow): this { this.action = 'insert'; this.payload = row; return this; }
  update(patch: MockRow): this { this.action = 'update'; this.payload = patch; return this; }
  overrideTypes(): this { return this; }
  single(): this { this.mode = 'single'; return this; }
  maybeSingle(): this { this.mode = 'maybeSingle'; return this; }
  limit(n: number): this { this.limitN = n; return this; }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.ordering = { column, ascending: opts?.ascending ?? true };
    return this;
  }

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
  in(column: string, values: readonly unknown[]): this {
    this.filters.push((r) => values.some((v) => compare(r[column], 'eq', String(v))));
    return this;
  }
  or(expr: string): this {
    const predicates = splitTopLevel(expr).map(parseCondition);
    this.filters.push((r) => predicates.some((p) => p(r)));
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
      const seq = ++this.state.seq;
      const row: MockRow = {
        id:         `${this.table}-${seq}`,
        created_at: `2026-01-01T00:00:00.${String(seq).padStart(3, '0')}Z`,
        ...this.payload,
      };
      table.push(row);
      this.state.log.push(`insert:${this.table}`);
      return [row];
    }

    let matched = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.action === 'update') {
      for (const r of matched) Object.assign(r, this.payload);
      this.state.log.push(`update:${this.table}(${matched.length})`);
      return matched;
    }

    this.state.log.push(`select:${this.table}`);
    if (this.ordering !== null) {
      const { column, ascending } = this.ordering;
      matched = [...matched].sort((a, b) => {
        const av = String(a[column] ?? '');
        const bv = String(b[column] ?? '');
        const c = av < bv ? -1 : av > bv ? 1 : 0;
        return ascending ? c : -c;
      });
    }
    if (this.limitN !== null) matched = matched.slice(0, this.limitN);
    return matched;
  }
}

export interface SupabaseMock {
  client: SupabaseClient;
  /** Replace a table's rows (stored and mutated by reference). */
  seed(table: string, rows: MockRow[]): void;
  /** Live view of a table's rows. */
  rows(table: string): MockRow[];
  /** Every executed op in order — query-count tests assert on this. */
  log: string[];
}

export function mockSupabase(): SupabaseMock {
  const state: HarnessState = { tables: new Map(), log: [], seq: 0 };
  const shape = { from: (table: string) => new MockQuery(state, table) };
  // The real SupabaseClient is a class with protected members, so no structural
  // stub can satisfy its nominal type — this single documented widening at the
  // test boundary mirrors the repo's existing stubs (lib/hypotheses/__tests__).
  const client = shape as unknown as SupabaseClient;
  return {
    client,
    seed: (table, rows) => { state.tables.set(table, rows); },
    rows: (table) => state.tables.get(table) ?? [],
    log:  state.log,
  };
}
