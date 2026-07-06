// In-memory Supabase stub for the heartbeat tests, modeled on
// lib/autonomy/__tests__/mock-supabase.ts (each capability folder owns its
// stub) and extended with the chain shapes the heartbeat's COMPOSED libraries
// use against it: .in / .gte / .lte / .overlaps / .order / .limit and the
// PostgREST `.or()` disjunction grammar the digest loader relies on
// (`status.in.(a,b),updated_at.gte.X`). Every write is logged so tests can
// assert exact audit behavior — including "nothing was written".

import type { SupabaseClient } from '@supabase/supabase-js';

export type MockRow = Record<string, unknown>;

interface MockResult {
  data:   unknown;
  error:  { message: string; code?: string } | null;
  count?: number | null;
}

/**
 * A registered partial-unique constraint. `conflict(payload, rows)` returns true
 * when inserting `payload` would collide with an existing row — the stub then
 * fails the insert with a Postgres unique_violation (code '23505'), letting
 * tests exercise the DB-arbitrated claim race (heartbeat_runs_claim_uniq).
 */
interface UniqueConstraint {
  table:    string;
  conflict: (payload: MockRow, rows: MockRow[]) => boolean;
}

interface HarnessState {
  tables:  Map<string, MockRow[]>;
  log:     string[];
  failOn:  Set<string>; // e.g. 'select:hypotheses', 'update:heartbeat_runs'
  uniques: UniqueConstraint[];
  seq:     number;
}

type Filter = (row: MockRow) => boolean;

/** Split a PostgREST .or() expression on top-level commas (paren-aware). */
function splitOr(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of expr) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current !== '') parts.push(current);
  return parts;
}

/** One `col.op.value` disjunct → predicate. Supports eq / gte / in. */
function orPredicate(clause: string): Filter {
  const [col, op, ...rest] = clause.split('.');
  const value = rest.join('.');
  if (op === 'eq')  return (r) => String(r[col]) === value;
  if (op === 'gte') return (r) => typeof r[col] === 'string' && r[col] >= value;
  if (op === 'in') {
    const values = value.replace(/^\(/, '').replace(/\)$/, '').split(',');
    return (r) => values.includes(String(r[col]));
  }
  return () => false;
}

class MockQuery {
  private readonly filters: Filter[] = [];
  private action: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private conflictCols: string[] = [];
  private payload: MockRow = {};
  private mode: 'list' | 'single' | 'maybeSingle' | 'count' = 'list';
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;

  constructor(private readonly state: HarnessState, private readonly table: string) {}

  select(_columns?: string, opts?: { count?: 'exact'; head?: boolean }): this {
    if (opts?.count === 'exact' && opts.head) this.mode = 'count';
    return this;
  }
  insert(row: MockRow): this { this.action = 'insert'; this.payload = row; return this; }
  update(patch: MockRow): this { this.action = 'update'; this.payload = patch; return this; }
  upsert(row: MockRow, opts?: { onConflict?: string }): this {
    this.action = 'upsert';
    this.payload = row;
    this.conflictCols = (opts?.onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean);
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
  gte(column: string, value: string): this {
    this.filters.push((r) => typeof r[column] === 'string' && r[column] >= value);
    return this;
  }
  lte(column: string, value: string): this {
    this.filters.push((r) => typeof r[column] === 'string' && r[column] <= value);
    return this;
  }
  lt(column: string, value: string): this {
    this.filters.push((r) => typeof r[column] === 'string' && r[column] < value);
    return this;
  }
  overlaps(column: string, values: readonly unknown[]): this {
    this.filters.push((r) => {
      const cell = r[column];
      return Array.isArray(cell) && cell.some((v) => values.includes(v));
    });
    return this;
  }
  or(expr: string): this {
    const predicates = splitOr(expr).map(orPredicate);
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
    if (this.state.failOn.has(`${this.action}:${this.table}`)) {
      return { data: null, error: { message: `forced failure: ${this.action}:${this.table}` }, count: null };
    }
    // Partial-unique enforcement: an insert that collides with a registered
    // constraint fails with Postgres unique_violation (23505), like the real DB.
    if (this.action === 'insert') {
      const existing = this.state.tables.get(this.table) ?? [];
      for (const u of this.state.uniques) {
        if (u.table === this.table && u.conflict(this.payload, existing)) {
          return {
            data:  null,
            error: { message: 'duplicate key value violates unique constraint', code: '23505' },
            count: null,
          };
        }
      }
    }
    let rows = this.run();
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        if (av === bv) return 0;
        const cmp = String(av) < String(bv) ? -1 : 1;
        return ascending ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);

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

    // upsert: merge into the row matching ALL onConflict columns, else insert —
    // mirrors PostgREST `upsert(row, { onConflict })` semantics.
    if (this.action === 'upsert') {
      const existing = this.conflictCols.length > 0
        ? table.find((r) => this.conflictCols.every((c) => r[c] === this.payload[c]))
        : undefined;
      if (existing) {
        Object.assign(existing, this.payload);
        this.state.log.push(`upsert:${this.table}(update)`);
        return [existing];
      }
      const row: MockRow = { id: `${this.table}-${++this.state.seq}`, created_at: new Date(0).toISOString(), ...this.payload };
      table.push(row);
      this.state.log.push(`upsert:${this.table}(insert)`);
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
  /**
   * Register a partial-unique constraint. On an insert into `table`, if
   * `conflict(payload, existingRows)` is true the insert fails with a Postgres
   * unique_violation (code '23505') — used to exercise the claim race.
   */
  enforceUnique(table: string, conflict: (payload: MockRow, rows: MockRow[]) => boolean): void;
}

export function mockSupabase(): SupabaseMock {
  const state: HarnessState = { tables: new Map(), log: [], failOn: new Set(), uniques: [], seq: 0 };
  const shape = { from: (table: string) => new MockQuery(state, table) };
  // The real SupabaseClient is a class with protected members, so no structural
  // stub can satisfy its nominal type — this ONE widening at the test boundary
  // is the repo's tolerated nominal cast (per lib/autonomy/__tests__/mock-supabase.ts).
  const client = shape as unknown as SupabaseClient;
  return {
    client,
    seed: (table, rows) => { state.tables.set(table, rows); },
    rows: (table) => state.tables.get(table) ?? [],
    log:    state.log,
    failOn: state.failOn,
    enforceUnique: (table, conflict) => { state.uniques.push({ table, conflict }); },
  };
}
