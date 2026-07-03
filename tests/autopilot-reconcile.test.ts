// C2 (HIGH) reliability regression: autopilot runs that die on a serverless
// timeout leave the orchestration credit lost and the row stuck in 'running'.
// The route self-heals on the next invocation via reconcileStaleRuns():
//   - fail + REFUND every provably-dead ('running' + older than the function
//     budget) run, refunding exactly once under concurrent invocations, and
//   - prefer to RESUME the most-recent stale run for the SAME client (its credit
//     was already paid) instead of charging + inserting a duplicate.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reconcileStaleRuns } from '@/lib/autopilot/orchestrator';

// Minimal chainable fake of the Supabase client used by reconcileStaleRuns +
// refundExplicit. A fresh builder per from() call keeps read vs update separate.
function makeSupabase(opts: { staleRows: any[]; claimWins?: boolean }) {
  const claimWins = opts.claimWins ?? true;
  const refundCalls: any[] = [];
  const failedIds: string[] = [];

  const supabase: any = {
    from() {
      const b: any = {
        _isUpdate: false,
        _id: null as string | null,
        update() { b._isUpdate = true; return b; },
        eq(col: string, val: string) { if (col === 'id') b._id = val; return b; },
        lt() { return b; },
        order() { return Promise.resolve({ data: opts.staleRows }); }, // terminal read
        select() {
          if (b._isUpdate) {
            if (claimWins && b._id) failedIds.push(b._id);
            return Promise.resolve({ data: claimWins ? [{ id: b._id }] : [] });
          }
          return b; // start of the read chain
        },
      };
      return b;
    },
    rpc(name: string, args: any) { refundCalls.push({ name, args }); return Promise.resolve({ error: null }); },
  };

  return { supabase, refundCalls, failedIds };
}

describe('reconcileStaleRuns — C2 timed-out run self-heal', () => {
  it('returns null and refunds nothing when there are no stale runs', async () => {
    const { supabase, refundCalls } = makeSupabase({ staleRows: [] });
    const res = await reconcileStaleRuns(supabase, 'u1', 'cX');
    expect(res).toBeNull();
    expect(refundCalls).toHaveLength(0);
  });

  it('fails + refunds every stale run when none is resumable for the client', async () => {
    const staleRows = [
      { id: 'r1', client_id: 'c1', current_step: 'score' },
      { id: 'r2', client_id: null, current_step: null },
    ];
    const { supabase, refundCalls, failedIds } = makeSupabase({ staleRows });
    const res = await reconcileStaleRuns(supabase, 'u1', 'cX'); // clientId matches neither
    expect(res).toBeNull();
    expect(failedIds.sort()).toEqual(['r1', 'r2']);
    expect(refundCalls).toHaveLength(2);
    // refund goes back to the right user/action/cost
    expect(refundCalls[0]).toEqual({
      name: 'refund_credits',
      args: { p_user_id: 'u1', p_action: 'autopilot_run', p_cost: 5 },
    });
  });

  it('resumes the matching-client stale run (no refund) and fails+refunds the rest', async () => {
    const staleRows = [
      { id: 'r1', client_id: 'c1', current_step: 'targeting' }, // resumable (same client)
      { id: 'r2', client_id: 'c2', current_step: 'score' },
    ];
    const { supabase, refundCalls, failedIds } = makeSupabase({ staleRows });
    const res = await reconcileStaleRuns(supabase, 'u1', 'c1');
    expect(res).toEqual({ id: 'r1', fromStep: 'targeting' });
    // only the non-resumable run is failed + refunded; the adopted run keeps its credit
    expect(failedIds).toEqual(['r2']);
    expect(refundCalls).toHaveLength(1);
  });

  it('does not refund when it loses the status-flip race (no rows claimed)', async () => {
    const staleRows = [{ id: 'r1', client_id: null, current_step: null }];
    const { supabase, refundCalls } = makeSupabase({ staleRows, claimWins: false });
    const res = await reconcileStaleRuns(supabase, 'u1', 'cX');
    expect(res).toBeNull();
    expect(refundCalls).toHaveLength(0); // another invocation already reconciled it
  });
});

describe('autopilot/run route — C2 timeout budget (source-level)', () => {
  const src = readFileSync(resolve(process.cwd(), 'app/api/autopilot/run/route.ts'), 'utf8');
  it('extends the function budget with maxDuration = 300', () => {
    expect(src).toMatch(/export\s+const\s+maxDuration\s*=\s*300/);
  });
  it('opportunistically reconciles stale runs before starting a new one', () => {
    expect(src).toMatch(/reconcileStaleRuns\(supabase,\s*user\.id,\s*clientId\)/);
  });
});
