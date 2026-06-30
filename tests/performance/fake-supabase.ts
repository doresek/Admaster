// Generic in-memory fake of a Supabase client for the performance + diagnosis
// tests. Unlike tests/intelligence/fake-admin (fixed table set), this supports
// ARBITRARY table names (content_performance / diagnoses / campaign_items /
// learning_signals / client_insights / insight_events …) which the 030 layer
// needs. A table listed in `failTables` returns a Postgres-style "relation does
// not exist" error so the graceful-degradation paths can be exercised.
//
// Supported chains:
//   insert(payload).select(cols).single()      -> create, returns row
//   insert(payload)            (awaited)        -> append (no return body)
//   update(payload).eq(...)... (awaited)        -> patch many
//   update(payload).eq(...).select().single()   -> patch one, returns row
//   select(cols).eq(...)/.in(...).maybeSingle() -> one | null
//   select(cols).eq(...)/.in(...)  (awaited)    -> list
//   select(cols)...order(...)                    -> list
let idCounter = 0;

export interface FakeSupabase {
  tables: Record<string, any[]>;
  client: { from: (table: string) => any; rpc?: (...a: any[]) => any };
}

export function makeFakeSupabase(
  seed: Record<string, any[]> = {},
  opts: { failTables?: string[] } = {},
): FakeSupabase {
  const tables: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const failTables = new Set(opts.failTables ?? []);

  const store = (t: string): any[] => (tables[t] ??= []);

  function matches(row: any, filters: [string, any][], inFilters: [string, any[]][]): boolean {
    return (
      filters.every(([col, val]) => row[col] === val) &&
      inFilters.every(([col, vals]) => vals.includes(row[col]))
    );
  }

  function from(table: string) {
    const dbError = failTables.has(table) ? { message: `relation "${table}" does not exist` } : null;
    const state: {
      op: 'insert' | 'update' | 'select' | null;
      payload: any;
      filters: [string, any][];
      inFilters: [string, any[]][];
    } = { op: null, payload: null, filters: [], inFilters: [] };

    function doInsert(): any {
      const now = new Date().toISOString();
      const row = { id: `row-${++idCounter}`, created_at: now, ...state.payload };
      store(table).push(row);
      return row;
    }
    function doUpdateMany(): number {
      const rows = store(table).filter((r) => matches(r, state.filters, state.inFilters));
      for (const r of rows) Object.assign(r, state.payload);
      return rows.length;
    }

    const builder: any = {
      insert(payload: any) { state.op = 'insert'; state.payload = payload; return builder; },
      update(payload: any) { state.op = 'update'; state.payload = payload; return builder; },
      select() { if (!state.op) state.op = 'select'; return builder; },
      eq(col: string, val: any) { state.filters.push([col, val]); return builder; },
      in(col: string, vals: any[]) { state.inFilters.push([col, vals]); return builder; },
      order() {
        const rows = store(table).filter((r) => matches(r, state.filters, state.inFilters));
        rows.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
        return Promise.resolve({ data: dbError ? null : rows.map((r) => ({ ...r })), error: dbError });
      },
      maybeSingle() {
        if (dbError) return Promise.resolve({ data: null, error: dbError });
        const row = store(table).find((r) => matches(r, state.filters, state.inFilters));
        return Promise.resolve({ data: row ? { ...row } : null, error: null });
      },
      single() {
        if (dbError) return Promise.resolve({ data: null, error: dbError });
        if (state.op === 'insert') return Promise.resolve({ data: { ...doInsert() }, error: null });
        if (state.op === 'update') {
          const rows = store(table).filter((r) => matches(r, state.filters, state.inFilters));
          if (rows[0]) Object.assign(rows[0], state.payload);
          return Promise.resolve({ data: rows[0] ? { ...rows[0] } : null, error: rows[0] ? null : { message: 'not found' } });
        }
        const row = store(table).find((r) => matches(r, state.filters, state.inFilters));
        return Promise.resolve({ data: row ? { ...row } : null, error: null });
      },
      then(resolve: any) {
        if (dbError) return resolve({ data: null, error: dbError });
        if (state.op === 'insert') { doInsert(); return resolve({ error: null }); }
        if (state.op === 'update') { doUpdateMany(); return resolve({ error: null }); }
        const rows = store(table).filter((r) => matches(r, state.filters, state.inFilters));
        return resolve({ data: rows.map((r) => ({ ...r })), error: null });
      },
    };
    return builder;
  }

  return { tables, client: { from } };
}
