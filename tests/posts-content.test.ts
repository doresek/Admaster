// Characterization tests for the generated_content ("posts") flow.
//
// These lock in what the code does TODAY, ahead of a slice that will link posts
// to a client via client_id (the same disciplined link we did for briefs).
//
// WHY SOURCE-LEVEL ASSERTIONS: the create/read logic lives inline inside route
// handlers that are tightly coupled to the Anthropic SDK, auth, credit
// deduction and buildAiContext — there is no exported pure function to call.
// Rather than force brittle full-route mocking (explicitly out of scope), we
// assert against the real source so the test is a genuine tripwire: when the
// next slice adds client_id to the /api/ai and /api/campaign inserts, these
// tests fail by design and must be updated alongside that change.
//
// See the "coupling findings" in the step report for the paths left untested.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

// Extract the balanced (...) argument that follows `generated_content').insert`.
// Handles nested parens (e.g. quick-campaign's `insert(variants.map(...))`).
function insertPayload(src: string): string {
  const marker = "generated_content').insert";
  const at = src.indexOf(marker);
  if (at < 0) throw new Error('no generated_content insert found');
  const open = src.indexOf('(', at + marker.length);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  throw new Error('unbalanced insert payload');
}

// ════════════════════════════════════════════════════════════════
// 1. WRITE paths — what each insert writes, and the client_id reality
// ════════════════════════════════════════════════════════════════
describe('generated_content write paths: current client_id linkage', () => {
  it('/api/ai now sets client_id from the active client (mirrors master)', () => {
    const payload = insertPayload(read('app/api/ai/route.ts'));
    expect(payload).toContain('user_id');
    expect(payload).toContain('type:');                    // type = the credit `action`
    expect(payload).toContain('client_id: activeClientId ?? null'); // <-- gap now closed
  });

  it('/api/campaign (quick-campaign) now sets client_id from the active client', () => {
    const payload = insertPayload(read('app/api/quick-campaign/route.ts'));
    expect(payload).toContain("type:");
    expect(payload).toContain("'campaign'");
    expect(payload).toContain('client_id: activeClientId ?? null'); // <-- gap now closed
  });

  it('/api/ai/master IS already client-linked (writes client_id + type=master_post)', () => {
    // CP-3 extracted the master run-and-persist logic (shared by the single and
    // batch routes) into lib/generation-queue/run-master.ts — the insert lives there.
    const payload = insertPayload(read('lib/generation-queue/run-master.ts'));
    expect(payload).toContain('client_id');
    expect(payload).toContain("'master_post'");
  });

  it('all three writers compute an active client id in scope (so the link is available, not missing data)', () => {
    expect(read('app/api/ai/route.ts')).toContain('activeClientId');
    expect(read('app/api/quick-campaign/route.ts')).toContain('activeClientId');
    expect(read('app/api/ai/master/route.ts')).toContain('activeClientId');
  });
});

// ════════════════════════════════════════════════════════════════
// 2. READ paths — results are scoped by user_id only (no DB client filter)
// ════════════════════════════════════════════════════════════════
describe('generated_content read paths: scoping is user_id-only at the DB', () => {
  const readers = [
    'app/api/library/route.ts',
    'app/api/recommendations/route.ts',
    'app/(dashboard)/page.tsx',
    'app/(dashboard)/lab/page.tsx',
    'app/(dashboard)/library/page.tsx',
    'app/(dashboard)/history/page.tsx',
  ];

  it('every reader filters by user_id and none filters by client_id at the DB layer', () => {
    for (const rel of readers) {
      const src = read(rel);
      // each reader touches generated_content
      expect(src).toContain('generated_content');
      // and there is no `.eq('client_id', …)` DB filter anywhere in these readers
      expect(src).not.toContain(".eq('client_id'");
    }
  });

  it('client filtering in history is done in memory (post-fetch), not in the query', () => {
    const src = read('app/(dashboard)/history/page.tsx');
    expect(src).toContain(".eq('user_id'");          // DB scope = user only
    expect(src).toContain('it.client_id !== clientF'); // client filter = client-side array filter
  });
});
