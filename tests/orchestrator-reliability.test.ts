// Reliability guard for the brain-completion fix.
//
// waitUntil behavior cannot be exercised in a unit test (it's a Vercel platform
// primitive), so we assert at the SOURCE level that the routes wire it up — the
// regression we are guarding against is the orchestrator being fired bare
// (`void orchestrateClientCore(...)`), which the serverless runtime freezes
// before it reaches synthesize. We also assert the master route now tags the
// recorded artifact with a resolved framework + funnel_stage (previously null).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('briefs/submit route — reliable orchestrator execution', () => {
  const src = read('app/api/briefs/submit/route.ts');

  it('imports waitUntil from @vercel/functions', () => {
    expect(src).toMatch(/import\s*\{\s*waitUntil\s*\}\s*from\s*'@vercel\/functions'/);
  });
  it('wraps orchestrateClientCore in waitUntil (not a bare fire-and-forget)', () => {
    expect(src).toMatch(/waitUntil\(\s*[\s\S]*orchestrateClientCore/);
    expect(src).not.toMatch(/void\s+orchestrateClientCore/);
  });
  it('extends the function budget with maxDuration = 300', () => {
    expect(src).toMatch(/export\s+const\s+maxDuration\s*=\s*300/);
  });
});

describe('client-core/run route — long-orchestrator budget', () => {
  const src = read('app/api/client-core/run/route.ts');
  it('awaits the orchestrator and extends maxDuration = 300', () => {
    expect(src).toMatch(/await\s+orchestrateClientCore/);
    expect(src).toMatch(/export\s+const\s+maxDuration\s*=\s*300/);
  });
});

describe('ai/master route — full artifact isolation tags', () => {
  const src = read('app/api/ai/master/route.ts');
  it('resolves a framework (input or winning marketer default) for the artifact', () => {
    expect(src).toMatch(/framework_default/);
    expect(src).toMatch(/framework:\s*resolvedFramework/);
  });
  it('derives and passes a funnel_stage for the artifact', () => {
    expect(src).toMatch(/deriveFunnelStage\(type\)/);
    expect(src).toMatch(/funnelStage/);
  });
});
