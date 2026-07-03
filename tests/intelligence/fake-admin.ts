// In-memory fake of the Supabase admin client for the intelligence tests.
//
// Supports exactly the chains the data layer uses:
//   • insert(payload).select(cols).single()           -> create, returns row
//   • insert(payload)            (awaited directly)    -> append (events)
//   • update(payload).eq(...).select(cols).single()   -> patch, returns row
//   • update(payload).eq(...).eq(...).select(cols)     -> CAS patch, returns
//                                        (awaited)         the updated rows[]
//   • select(cols).eq(...)...order(...)                -> list (awaited)
//   • select(cols).eq(...).maybeSingle()               -> one | null
//   • upsert(payload, { onConflict }) (awaited)        -> insert/merge by key
//
// Tables are plain arrays; rows get a generated id + timestamps on insert.
let idCounter = 0;

export interface FakeDb {
  client_insights:   any[];
  insight_events:    any[];
  client_strategy:   any[];
  clients:           any[];
  briefs:            any[];
  content_artifacts: any[];
  learning_signals:  any[];
  rpcCalls:          Array<{ fn: string; args: any }>;
  admin:             any;
}

export function makeFakeDb(
  seed: { insights?: any[]; clients?: any[]; briefs?: any[]; artifacts?: any[]; signals?: any[] } = {},
): FakeDb {
  const db = {
    client_insights:   (seed.insights ?? []).map((r) => ({ ...r })),
    insight_events:    [] as any[],
    client_strategy:   [] as any[],
    clients:           (seed.clients ?? []).map((r) => ({ ...r })),
    briefs:            (seed.briefs ?? []).map((r) => ({ ...r })),
    content_artifacts: (seed.artifacts ?? []).map((r) => ({ ...r })),
    learning_signals:  (seed.signals ?? []).map((r) => ({ ...r })),
  };
  const rpcCalls: Array<{ fn: string; args: any }> = [];

  function matches(row: any, filters: [string, any][], inFilters: [string, any[]][]): boolean {
    return (
      filters.every(([col, val]) => row[col] === val) &&
      inFilters.every(([col, vals]) => vals.includes(row[col]))
    );
  }

  function from(table: keyof typeof db) {
    const state: { op: 'insert' | 'update' | 'upsert' | 'select' | null; payload: any; filters: [string, any][]; inFilters: [string, any[]][]; onConflict?: string; selected: boolean } = {
      op: null, payload: null, filters: [], inFilters: [], selected: false,
    };

    const store = () => db[table] as any[];

    function doInsert(): any {
      const now = new Date().toISOString();
      const row =
        table === 'client_insights'
          ? {
              id:                `ins-${++idCounter}`,
              structured:        null,
              source_ref:        null,
              evidence_count:    1,
              status:            'active',
              superseded_by:     null,
              superseded_reason: null,
              first_seen_at:     now,
              updated_at:        now,
              ...state.payload,
            }
          : { id: `row-${++idCounter}`, created_at: now, ...state.payload };
      store().push(row);
      return row;
    }

    function doUpdate(): any {
      const row = store().find((r) => matches(r, state.filters, state.inFilters));
      if (!row) return null;
      Object.assign(row, state.payload);
      return row;
    }

    function doUpsert() {
      const key = state.onConflict ?? 'id';
      const existing = store().find((r) => r[key] === state.payload[key]);
      if (existing) Object.assign(existing, state.payload);
      else store().push({ id: `row-${++idCounter}`, ...state.payload });
      return { data: null, error: null };
    }

    const builder: any = {
      insert(payload: any) { state.op = 'insert'; state.payload = payload; return builder; },
      update(payload: any) { state.op = 'update'; state.payload = payload; return builder; },
      upsert(payload: any, opts?: { onConflict?: string }) {
        state.op = 'upsert'; state.payload = payload; state.onConflict = opts?.onConflict;
        return Promise.resolve(doUpsert());
      },
      select() { state.selected = true; if (!state.op) state.op = 'select'; return builder; },
      eq(col: string, val: any) { state.filters.push([col, val]); return builder; },
      in(col: string, vals: any[]) { state.inFilters.push([col, vals]); return builder; },
      order() { // terminal list read
        const rows = store().filter((r) => matches(r, state.filters, state.inFilters));
        rows.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
        return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
      },
      maybeSingle() {
        const row = store().find((r) => matches(r, state.filters, state.inFilters));
        return Promise.resolve({ data: row ? { ...row } : null, error: null });
      },
      single() {
        if (state.op === 'insert') return Promise.resolve({ data: { ...doInsert() }, error: null });
        if (state.op === 'update') {
          const r = doUpdate();
          return Promise.resolve({ data: r ? { ...r } : null, error: r ? null : { message: 'not found' } });
        }
        const row = store().find((r) => matches(r, state.filters, state.inFilters));
        return Promise.resolve({ data: row ? { ...row } : null, error: null });
      },
      // awaited directly: insert-without-select (events), update-without-select
      // (mark processed), or a filtered list read (select).
      then(resolve: any) {
        if (state.op === 'insert') { doInsert(); return resolve({ error: null }); }
        if (state.op === 'update') {
          // CAS/patch-many. Snapshot AFTER applying so a
          // `.update().eq().select()` (no .single) returns the updated rows —
          // used by the C4 processed-CAS claim. Without .select the awaited
          // shape stays exactly `{ error: null }` (unchanged behavior).
          const rows = store().filter((r) => matches(r, state.filters, state.inFilters));
          for (const r of rows) Object.assign(r, state.payload);
          if (state.selected) return resolve({ data: rows.map((r) => ({ ...r })), error: null });
          return resolve({ error: null });
        }
        if (state.op === 'select') {
          const rows = store().filter((r) => matches(r, state.filters, state.inFilters));
          return resolve({ data: rows.map((r) => ({ ...r })), error: null });
        }
        resolve({ error: null });
      },
    };
    return builder;
  }

  function rpc(fn: string, args: any) {
    rpcCalls.push({ fn, args });
    // Per-client build claim (C1): in the single-threaded fake there is never a
    // competing in-flight build, so the claim is always granted.
    if (fn === 'claim_client_build') return Promise.resolve({ data: true, error: null });
    return Promise.resolve({ data: { success: true, credits: 100 }, error: null });
  }

  return { ...db, rpcCalls, admin: { from, rpc } };
}
