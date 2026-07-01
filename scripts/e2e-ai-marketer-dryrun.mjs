#!/usr/bin/env node
// scripts/e2e-ai-marketer-dryrun.mjs
//
// ONE command that runs the WHOLE "AI marketer" closed loop IN-PROCESS against
// the REAL modules — dry-run, no network, no live Meta / InforU, no real DB —
// and clearly reports pass/fail.
//
//   node scripts/e2e-ai-marketer-dryrun.mjs
//
// The loop it exercises (per channel: meta_paid AND meta_organic):
//   decide → runCampaign (dry-run; PAUSED + zero live calls)
//          → ingestPerformance (a failing fixture)
//          → diagnoseCampaignItem → autoImprove → the living atom weakens
// Plus the WhatsApp leg (lib/whatsapp, mock mode, grounded send) and the
// Command Center grounded_in → insight-content resolution.
//
// WHY it shells vitest: the loop is TypeScript resolved through the `@/` path
// alias; running raw .mjs against the TS sources needs a TS loader that isn't
// available in this environment (Node 20, no tsx). vitest already owns tsconfig
// path resolution + transform, so we drive the scenario through it. The test
// file prints a readable step-by-step TRACE (angle + grounded_in, campaign
// status, verdict, failed_link, atom confidence before→after) via console.log,
// which `--reporter=verbose` surfaces. Exit code is propagated: non-zero if any
// assertion fails.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const testFile = 'tests/e2e/ai-marketer-full.test.ts';

const banner = (msg) => process.stdout.write(`\n${'='.repeat(72)}\n${msg}\n${'='.repeat(72)}\n`);

banner('AI-MARKETER FULL DRY-RUN CLOSED LOOP  (channels: meta_paid + meta_organic + WhatsApp + Command Center)');
process.stdout.write(
  'Invariants asserted: DRY-RUN · PAUSED · ZERO LIVE CALLS · LOOP CLOSES (atom updated)\n' +
  `Running: npx vitest run ${testFile} --reporter=verbose\n`,
);

const res = spawnSync(
  'npx',
  ['vitest', 'run', testFile, '--reporter=verbose'],
  { cwd: repoRoot, stdio: 'inherit', env: process.env },
);

if (res.error) {
  process.stderr.write(`\nFAILED to launch vitest: ${res.error.message}\n`);
  process.exit(1);
}

const code = res.status ?? 1;
if (code === 0) {
  banner('RESULT: PASS — the full AI-marketer loop ran dry-run, PAUSED, with zero live calls, and closed (atom updated).');
} else {
  banner(`RESULT: FAIL — vitest exited ${code}. See the assertion output above.`);
}
process.exit(code);
