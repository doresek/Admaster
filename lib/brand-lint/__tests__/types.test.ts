// lib/brand-lint/__tests__/types.test.ts
//
// parseBrandVoice totality (jsonb is runtime-untrusted — every shape must
// yield a complete spec) + the MockRegisterJudge test double itself.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRAND_VOICE,
  MockRegisterJudge,
  parseBrandVoice,
} from '../types';
import { makeSpec } from './fixtures';

describe('parseBrandVoice', () => {
  it('full valid payload round-trips with no warnings', () => {
    const { spec, warnings } = parseBrandVoice({
      register:            'dugri',
      address:             { gender: 'female' },
      emoji_policy:        'none',
      taboo_words:         [' מבצע ', 'חינם', ''],
      loaded_words_policy: { 'בלעדי': 'allow', 'וואו': 'block' },
      humor:               'none',
      notes:               'בלי סופרלטיבים',
    });
    expect(warnings).toEqual([]);
    expect(spec.register).toBe('dugri');
    expect(spec.address.gender).toBe('female');
    expect(spec.emoji_policy).toBe('none');
    // trimmed, empties dropped
    expect(spec.taboo_words).toEqual(['מבצע', 'חינם']);
    expect(spec.loaded_words_policy).toEqual({ 'בלעדי': 'allow', 'וואו': 'block' });
    expect(spec.humor).toBe('none');
    expect(spec.notes).toBe('בלי סופרלטיבים');
  });

  it('partial payload: missing fields silently take documented defaults', () => {
    const { spec, warnings } = parseBrandVoice({ register: 'casual' });
    expect(warnings).toEqual([]);
    expect(spec.register).toBe('casual');
    expect(spec.address.gender).toBe('neutral');
    expect(spec.emoji_policy).toBe('light');
    expect(spec.taboo_words).toEqual([]);
    expect(spec.humor).toBe(DEFAULT_BRAND_VOICE.humor);
  });

  it('invalid field values default + warn (per field)', () => {
    const { spec, warnings } = parseBrandVoice({
      register:     'shouty',
      emoji_policy: 'lots',
      address:      { gender: 'robot' },
      taboo_words:  'מבצע',
    });
    expect(spec.register).toBe('business');
    expect(spec.emoji_policy).toBe('light');
    expect(spec.address.gender).toBe('neutral');
    expect(spec.taboo_words).toEqual([]);
    expect(warnings).toHaveLength(4);
  });

  it('invalid loaded_words_policy actions are dropped per-entry with a warning', () => {
    const { spec, warnings } = parseBrandVoice({
      loaded_words_policy: { 'מבצע': 'allow', 'חינם': 'maybe' },
    });
    expect(spec.loaded_words_policy).toEqual({ 'מבצע': 'allow' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('חינם');
  });

  it('garbage payloads (string / number) → full defaults + one warning', () => {
    for (const garbage of ['not-an-object', 42, true, ['a']]) {
      const { spec, warnings } = parseBrandVoice(garbage);
      expect(spec).toEqual(DEFAULT_BRAND_VOICE);
      expect(warnings).toHaveLength(1);
    }
  });

  it('null → defaults + a warning (atom exists but carries no payload)', () => {
    const { spec, warnings } = parseBrandVoice(null);
    expect(spec).toEqual(DEFAULT_BRAND_VOICE);
    expect(warnings).toHaveLength(1);
  });

  it('never mutates the shared DEFAULT_BRAND_VOICE (fresh spec per parse)', () => {
    const a = parseBrandVoice(null).spec;
    a.taboo_words.push('זבל');
    a.address.gender = 'male';
    expect(DEFAULT_BRAND_VOICE.taboo_words).toEqual([]);
    expect(DEFAULT_BRAND_VOICE.address.gender).toBe('neutral');
  });
});

describe('MockRegisterJudge', () => {
  it('plays back scripted verdicts and errors in order, then falls back permissive', async () => {
    const judge = new MockRegisterJudge(
      { registerMatch: false, concerns: ['גבוה מדי'] },
      new Error('boom'),
    );
    const spec = makeSpec();

    const first = await judge.judge('טקסט א', spec);
    expect(first).toEqual({ registerMatch: false, concerns: ['גבוה מדי'] });

    await expect(judge.judge('טקסט ב', spec)).rejects.toThrow('boom');

    const third = await judge.judge('טקסט ג', spec);
    expect(third).toEqual({ registerMatch: true, concerns: [] });
  });

  it('records every call with its content and spec', async () => {
    const judge = new MockRegisterJudge();
    const spec = makeSpec({ register: 'dugri' });
    await judge.judge('שלום', spec);
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0].content).toBe('שלום');
    expect(judge.calls[0].spec.register).toBe('dugri');
  });
});
