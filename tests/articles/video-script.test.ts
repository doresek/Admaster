// tests/articles/video-script.test.ts — P3-4: tagged parse, the deterministic
// quality check (hook words, beat count, duration math), and persistence as an
// articles row kind 'video_script'.

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StageRunner } from '@/lib/master-studio/pipeline';
import {
  checkVideoScript, estimateSeconds, formatVideoScriptMd, generateVideoScript,
  parseVideoScript, saveVideoScript,
  HOOK_MAX_WORDS, VIDEO_MAX_SECONDS, VIDEO_MIN_SECONDS, WORDS_PER_SECOND,
} from '@/lib/articles/video-script';
import type { VideoScript } from '@/lib/articles/types';

const words = (n: number, w = 'מילה') => Array(n).fill(w).join(' ');

/** hook 5 + 4×20 + cta 5 = 90 words → 36s at 2.5 wps: comfortably in-window. */
function validScript(): VideoScript {
  return {
    hook:  words(5, 'הוק'),
    beats: [
      { t: '0-5s',   line: words(20) },
      { t: '5-15s',  line: words(20) },
      { t: '15-30s', line: words(20) },
      { t: '30-40s', line: words(20) },
    ],
    cta: words(5, 'קריאה'),
  };
}

const VALID_RAW = `
[HOOK]${words(5, 'הוק')}[/HOOK]
[BEAT]t: 0-5s
line: ${words(20)}[/BEAT]
[BEAT]t: 5-15s
line: ${words(20)}[/BEAT]
[BEAT]t: 15-30s
line: ${words(20)}[/BEAT]
[BEAT]t: 30-40s
line: ${words(20)}[/BEAT]
[CTA]${words(5, 'קריאה')}[/CTA]
`;

describe('parseVideoScript', () => {
  it('parses the tagged fixture into {hook, beats[{t,line}], cta}', () => {
    const s = parseVideoScript(VALID_RAW)!;
    expect(s.hook).toBe(words(5, 'הוק'));
    expect(s.beats).toHaveLength(4);
    expect(s.beats[0].t).toBe('0-5s');
    expect(s.beats[0].line).toBe(words(20));
    expect(s.cta).toBe(words(5, 'קריאה'));
  });

  it('rejects malformed output (missing hook/cta/beats)', () => {
    expect(parseVideoScript('טקסט חופשי')).toBeNull();
    expect(parseVideoScript('[HOOK]הוק[/HOOK][CTA]עכשיו[/CTA]')).toBeNull();
    expect(parseVideoScript('[HOOK]הוק[/HOOK][BEAT]t: 0-5s\nline: שורה[/BEAT]')).toBeNull();
  });
});

describe('checkVideoScript — deterministic quality gate', () => {
  it('passes a well-formed 30-60s script and estimates duration exactly', () => {
    const c = checkVideoScript(validScript());
    expect(c.ok).toBe(true);
    expect(c.failures).toEqual([]);
    expect(c.estimatedSeconds).toBe(90 / WORDS_PER_SECOND); // 36s
  });

  it(`fails a hook longer than ${HOOK_MAX_WORDS} words (and an empty hook)`, () => {
    const long = checkVideoScript({ ...validScript(), hook: words(HOOK_MAX_WORDS + 1) });
    expect(long.failures.map((f) => f.rule)).toContain('hook_word_count');
    const empty = checkVideoScript({ ...validScript(), hook: '' });
    expect(empty.failures.map((f) => f.rule)).toContain('hook_word_count');
  });

  it('fails on beat count outside 3-5', () => {
    const two = checkVideoScript({ ...validScript(), beats: validScript().beats.slice(0, 2) });
    expect(two.failures.map((f) => f.rule)).toContain('beat_count');
    const six = checkVideoScript({
      ...validScript(),
      beats: [...validScript().beats, { t: 'a', line: 'ש' }, { t: 'b', line: 'ש' }],
    });
    expect(six.failures.map((f) => f.rule)).toContain('beat_count');
  });

  it(`fails duration outside ${VIDEO_MIN_SECONDS}-${VIDEO_MAX_SECONDS}s (word-count / ${WORDS_PER_SECOND} wps)`, () => {
    // 5+3×5+5 = 25 words → 10s: too short.
    const short: VideoScript = {
      hook:  words(5),
      beats: [{ t: '1', line: words(5) }, { t: '2', line: words(5) }, { t: '3', line: words(5) }],
      cta:   words(5),
    };
    const c1 = checkVideoScript(short);
    expect(estimateSeconds(short)).toBe(10);
    expect(c1.failures.map((f) => f.rule)).toContain('duration');
    // 5+3×60+5 = 190 words → 76s: too long.
    const long: VideoScript = { ...short, beats: short.beats.map((b) => ({ ...b, line: words(60) })) };
    expect(estimateSeconds(long)).toBe(76);
    expect(checkVideoScript(long).failures.map((f) => f.rule)).toContain('duration');
  });
});

describe('generateVideoScript (stub runner)', () => {
  it('one call → parsed script + quality check', async () => {
    let calls = 0;
    const run: StageRunner = async () => { calls++; return VALID_RAW; };
    const r = await generateVideoScript({ title: 'טיפול שורש ללא כאב', run });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.script.beats).toHaveLength(4);
    expect(r.check.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it('malformed → one retry → succeeds', async () => {
    let calls = 0;
    const run: StageRunner = async () => (++calls === 1 ? 'שבור' : VALID_RAW);
    const r = await generateVideoScript({ title: 'נושא', run });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('malformed twice → clean failure', async () => {
    const run: StageRunner = async () => 'שבור';
    const r = await generateVideoScript({ title: 'נושא', run });
    expect(r.ok).toBe(false);
  });
});

describe('formatVideoScriptMd + saveVideoScript', () => {
  function makeAdmin() {
    const inserted: Record<string, unknown>[] = [];
    const updated: { id: string; values: Record<string, unknown> }[] = [];
    const admin = {
      from(table: string) {
        if (table !== 'articles') throw new Error(`unexpected table ${table}`);
        return {
          insert(row: Record<string, unknown>) {
            inserted.push(row);
            return { select: () => ({ maybeSingle: async () => ({ data: { id: 'new-row-id' }, error: null }) }) };
          },
          update(values: Record<string, unknown>) {
            return { eq: async (_c: string, id: string) => { updated.push({ id, values }); return { error: null }; } };
          },
        };
      },
    } as unknown as SupabaseClient;
    return { admin, inserted, updated };
  }

  it('formats a readable markdown script', () => {
    const md = formatVideoScriptMd('טיפול שורש', validScript());
    expect(md).toContain('# טיפול שורש — תסריט וידאו');
    expect(md).toContain(`**הוק (עצירת-גלילה):** ${words(5, 'הוק')}`);
    expect(md).toContain('| 0-5s |');
    expect(md).toContain(`**CTA:** ${words(5, 'קריאה')}`);
  });

  it('inserts a new articles row kind video_script, status draft on a passing check', async () => {
    const { admin, inserted } = makeAdmin();
    const script = validScript();
    const r = await saveVideoScript({
      admin, clientId: 'c1', ownerUserId: 'u1', title: 'טיפול שורש',
      script, check: checkVideoScript(script),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.article_id).toBe('new-row-id');
    expect(r.status).toBe('draft');
    expect(inserted).toHaveLength(1);
    expect(inserted[0].kind).toBe('video_script');
    expect(inserted[0].status).toBe('draft');
    expect(String(inserted[0].body_md)).toContain('תסריט וידאו');
    expect((inserted[0].outline as any).video.beats).toHaveLength(4);
  });

  it('failing check → status outline with seo.script_check_failures recorded', async () => {
    const { admin, inserted } = makeAdmin();
    const bad: VideoScript = { ...validScript(), hook: words(HOOK_MAX_WORDS + 5) };
    const r = await saveVideoScript({
      admin, clientId: 'c1', ownerUserId: 'u1', title: 'נושא',
      script: bad, check: checkVideoScript(bad),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe('outline');
    const seo = inserted[0].seo as Record<string, any>;
    expect(seo.script_check.passed).toBe(false);
    expect(seo.script_check_failures.length).toBeGreaterThan(0);
  });

  it('updates an existing row when articleId is given', async () => {
    const { admin, updated, inserted } = makeAdmin();
    const script = validScript();
    const r = await saveVideoScript({
      admin, clientId: 'c1', ownerUserId: 'u1', title: 'נושא',
      script, check: checkVideoScript(script), articleId: 'existing-id',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.article_id).toBe('existing-id');
    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe('existing-id');
    expect(updated[0].values.status).toBe('draft');
  });
});
