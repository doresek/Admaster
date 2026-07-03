// lib/brand-lint/__tests__/lint.test.ts
//
// Composition behavior: atom selection, defaults path, judge integration
// (mismatch / failure isolation), scoring, and the concurrent batch.

import { describe, expect, it } from 'vitest';
import { lintArtifact, lintBatch, selectBrandVoiceAtom } from '../lint';
import { MockRegisterJudge } from '../types';
import { makeAtom } from './fixtures';

const CLEAN = 'המרפאה פתוחה גם ביום שישי. אפשר לקבוע תור באתר.';

describe('selectBrandVoiceAtom', () => {
  it('highest-confidence active brand_voice atom wins', () => {
    const low   = makeAtom({ confidence: 0.55 });
    const high  = makeAtom({ confidence: 0.92 });
    const mid   = makeAtom({ confidence: 0.70 });
    expect(selectBrandVoiceAtom([low, high, mid])?.id).toBe(high.id);
  });

  it('confidence tie → the newest (updated_at) wins', () => {
    const older = makeAtom({ confidence: 0.8, updated_at: '2026-01-01T00:00:00.000Z' });
    const newer = makeAtom({ confidence: 0.8, updated_at: '2026-06-01T00:00:00.000Z' });
    expect(selectBrandVoiceAtom([older, newer])?.id).toBe(newer.id);
  });

  it('ignores superseded atoms and non-brand_voice kinds', () => {
    const superseded = makeAtom({ confidence: 0.99, status: 'superseded' });
    const wrongKind  = makeAtom({ confidence: 0.99, kind: 'real_usp' });
    const active     = makeAtom({ confidence: 0.60 });
    expect(selectBrandVoiceAtom([superseded, wrongKind, active])?.id).toBe(active.id);
    expect(selectBrandVoiceAtom([superseded, wrongKind])).toBeNull();
  });
});

describe('lintArtifact — composition', () => {
  it('no brand atom → lints against defaults + a no_brand_voice flag', async () => {
    const res = await lintArtifact(CLEAN, []);
    expect(res.violations.map((v) => v.rule)).toEqual(['no_brand_voice']);
    expect(res.violations[0].severity).toBe('flag');
    expect(res.passed).toBe(true);
    expect(res.score).toBe(95);
    expect(res.checked).toEqual({ deterministic: true, register: false });
  });

  it('multiple atoms → the winning atom\'s spec is the one enforced', async () => {
    const winner = makeAtom({ confidence: 0.9, structured: { taboo_words: ['אלף'] } });
    const loser  = makeAtom({ confidence: 0.6, structured: { taboo_words: ['בית'] } });
    const dead   = makeAtom({ confidence: 0.99, status: 'superseded', structured: { taboo_words: ['גימל'] } });

    const res = await lintArtifact('אלף ועוד בית ועוד גימל', [loser, winner, dead]);
    const taboo = res.violations.filter((v) => v.rule === 'taboo_word');
    expect(taboo).toHaveLength(1);
    expect(taboo[0].message).toContain('אלף');
    expect(res.passed).toBe(false);
  });

  it('a broken structured payload surfaces brand_voice_spec flags and lints on', async () => {
    const atom = makeAtom({ structured: { register: 'shouty' } });
    const res = await lintArtifact(CLEAN, [atom]);
    expect(res.violations.map((v) => v.rule)).toEqual(['brand_voice_spec']);
    expect(res.passed).toBe(true);
  });

  it('score arithmetic across rules: 1 block + 3 flags = 60', async () => {
    // taboo מבצע → block(−25); loaded מבצע + חינם + בלעדי → 3 flags(−15).
    const atom = makeAtom({ structured: { taboo_words: ['מבצע'], emoji_policy: 'light' } });
    const res = await lintArtifact('מבצע בלעדי — משלוח חינם לכל הארץ', [atom]);

    expect(res.violations.filter((v) => v.severity === 'block')).toHaveLength(1);
    expect(res.violations.filter((v) => v.severity === 'flag')).toHaveLength(3);
    expect(res.score).toBe(60);
    expect(res.passed).toBe(false);
  });

  it('judge register mismatch → flag carrying the concerns; checked.register = true', async () => {
    const judge = new MockRegisterJudge({ registerMatch: false, concerns: ['משלב גבוה מדי', 'אין דוגרי'] });
    const atom = makeAtom({ structured: { register: 'dugri' } });

    const res = await lintArtifact(CLEAN, [atom], judge);
    const mismatch = res.violations.filter((v) => v.rule === 'register_mismatch');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0].severity).toBe('flag');
    expect(mismatch[0].message).toContain('משלב גבוה מדי');
    expect(res.checked.register).toBe(true);
    expect(res.passed).toBe(true); // a register flag never fails the artifact
    expect(judge.calls[0].spec.register).toBe('dugri');
  });

  it('judge match with no concerns → no register violations', async () => {
    const res = await lintArtifact(CLEAN, [makeAtom()], new MockRegisterJudge({ registerMatch: true, concerns: [] }));
    expect(res.violations.filter((v) => v.rule.startsWith('register'))).toHaveLength(0);
    expect(res.checked.register).toBe(true);
  });

  it('judge throwing → register_inconclusive FLAG, never a rejection; passed unaffected', async () => {
    const judge = new MockRegisterJudge(new Error('LLM outage'));
    const res = await lintArtifact(CLEAN, [makeAtom()], judge);

    const inconclusive = res.violations.filter((v) => v.rule === 'register_inconclusive');
    expect(inconclusive).toHaveLength(1);
    expect(inconclusive[0].severity).toBe('flag');
    expect(inconclusive[0].message).toContain('LLM outage'); // the flag IS the log
    expect(res.checked.register).toBe(false); // the check did not complete
    expect(res.passed).toBe(true); // publishing is not hostage to the LLM
  });

  it('deterministic blocks still fail the artifact when the judge also fails', async () => {
    const atom = makeAtom({ structured: { taboo_words: ['מבצע'] } });
    const res = await lintArtifact('מבצע ענק', [atom], new MockRegisterJudge(new Error('down')));
    expect(res.passed).toBe(false);
    expect(res.violations.some((v) => v.rule === 'taboo_word')).toBe(true);
    expect(res.violations.some((v) => v.rule === 'register_inconclusive')).toBe(true);
  });

  it('no judge supplied → register pass simply not run', async () => {
    const res = await lintArtifact(CLEAN, [makeAtom()]);
    expect(res.checked.register).toBe(false);
    expect(res.violations.filter((v) => v.rule.startsWith('register'))).toHaveLength(0);
  });

  it('totality: empty string still yields a full LintResult', async () => {
    const res = await lintArtifact('', [makeAtom()]);
    expect(res.checked.deterministic).toBe(true);
    expect(res.passed).toBe(true);
  });
});

describe('lintBatch — concurrent batch audit', () => {
  it('one judge failure does not fail the batch (per-artifact isolation)', async () => {
    const judge = new MockRegisterJudge(
      { registerMatch: true, concerns: [] },
      new Error('rate limited'),
      { registerMatch: false, concerns: ['קליל מדי'] },
    );
    const atoms = [makeAtom()];

    const results = await lintBatch([CLEAN, CLEAN, CLEAN], atoms, judge);
    expect(results).toHaveLength(3);
    expect(judge.calls).toHaveLength(3);

    expect(results[0].violations.filter((v) => v.rule.startsWith('register'))).toHaveLength(0);
    expect(results[1].violations.map((v) => v.rule)).toContain('register_inconclusive');
    expect(results[2].violations.map((v) => v.rule)).toContain('register_mismatch');
    // every artifact still passed — all register findings are flags
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('empty batch → empty results', async () => {
    expect(await lintBatch([], [makeAtom()])).toEqual([]);
  });
});
