// tests/articles/generate.test.ts — P3-3 pipeline against a deterministic stub
// runner + in-memory admin: outline parse robustness (malformed → retry →
// clean fail), FAQ as question-H2s, gate failure keeps status 'outline' with
// failures recorded, and the fixture E2E (valid tags → 'draft' + gate passed).

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StageRunner } from '@/lib/master-studio/pipeline';
import {
  assembleBody, generateArticle, parseOutline,
  type ArticleRowForGenerate,
} from '@/lib/articles/generate';
import type { ArticleOutline } from '@/lib/articles/types';

const words = (n: number, w = 'מילה') => Array(n).fill(w).join(' ');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_OUTLINE_RAW = `
[H1]כמה עולה טיפול שורש 2026[/H1]
[OPENING]${words(50)}[/OPENING]
[SECTION]h2: כמה עולה טיפול שורש בחיפה?
- מחיר לשן קדמית
- מחיר לשן אחורית[/SECTION]
[SECTION]h2: איך בוחרים רופא שיניים?
- ניסיון
- ביקורות[/SECTION]
[FAQ_Q]האם הטיפול כואב?[/FAQ_Q]
[FAQ_Q]מתי צריך טיפול שורש?[/FAQ_Q]
[SEO_TITLE]טיפול שורש 2026 — מחירון מלא[/SEO_TITLE]
[SEO_DESCRIPTION]כל המחירים והתשובות במקום אחד.[/SEO_DESCRIPTION]
`;

function articleRow(over: Partial<ArticleRowForGenerate> = {}): ArticleRowForGenerate {
  return {
    id:           '00000000-0000-0000-0000-00000000a001',
    title:        'כמה עולה טיפול שורש',
    kind:         'article',
    keywords:     ['כמה עולה טיפול שורש'],
    topic_source: { intent: 'commercial', injectionAtomIds: [] },
    grounded_in:  [],
    rationale:    'שאלת מחיר חמה',
    ...over,
  };
}

interface StubOpts {
  /** Section markdown per call index (default: one unique [FACT] each). */
  sectionMd?:      (call: number) => string;
  faqRaw?:         string;
  editRaw?:        (user: string) => string;
  outlineRaws?:    string[]; // consumed per outline call; last repeats
}

/** Deterministic stub runner dispatching on each stage's output-contract marker. */
function makeRunner(opts: StubOpts = {}) {
  const calls = { outline: 0, section: 0, faq: 0, edit: 0 };
  const run: StageRunner = async (system, user) => {
    if (system.includes('[H1]')) {
      const raws = opts.outlineRaws ?? [VALID_OUTLINE_RAW];
      const raw = raws[Math.min(calls.outline, raws.length - 1)];
      calls.outline++;
      return raw;
    }
    if (system.includes('[SECTION_MD]')) {
      const i = calls.section++;
      const md = opts.sectionMd
        ? opts.sectionMd(i)
        : `תשובה ישירה. המחיר [FACT]עובדה מספר ${i + 1}[/FACT] נכון להיום.`;
      return md ? `[SECTION_MD]${md}[/SECTION_MD]` : 'ללא תגיות';
    }
    if (system.includes('[FAQ_A]')) {
      calls.faq++;
      return opts.faqRaw ?? '[FAQ_A]לא. יש [FACT]הרדמה מקומית מלאה[/FACT].[/FAQ_A]\n[FAQ_A]כשיש כאב מתמשך.[/FAQ_A]';
    }
    if (system.includes('[BODY_MD]')) {
      calls.edit++;
      return opts.editRaw ? opts.editRaw(user) : `[BODY_MD]${user}[/BODY_MD]`;
    }
    throw new Error('unexpected stage system prompt');
  };
  return { run, calls };
}

interface Update { id: string; values: Record<string, unknown> }

function makeAdmin() {
  const updates: Update[] = [];
  const admin = {
    from(table: string) {
      if (table !== 'articles') throw new Error(`unexpected table ${table}`);
      return {
        update(values: Record<string, unknown>) {
          return {
            eq: async (_col: string, id: string) => {
              updates.push({ id, values });
              return { error: null };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, updates };
}

function baseInput(runner: ReturnType<typeof makeRunner>, admin: SupabaseClient) {
  return {
    article: articleRow(),
    atoms:   [],
    quotes:  [],
    run:     runner.run,
    admin,
    currentYear: 2026,
  };
}

// ── parseOutline robustness ───────────────────────────────────────────────────

describe('parseOutline', () => {
  it('parses the tagged outline fixture', () => {
    const p = parseOutline(VALID_OUTLINE_RAW)!;
    expect(p.h1).toBe('כמה עולה טיפול שורש 2026');
    expect(p.sections).toHaveLength(2);
    expect(p.sections[0]).toEqual({
      h2: 'כמה עולה טיפול שורש בחיפה?',
      points: ['מחיר לשן קדמית', 'מחיר לשן אחורית'],
    });
    expect(p.faq.map((f) => f.q)).toEqual(['האם הטיפול כואב?', 'מתי צריך טיפול שורש?']);
    expect(p.seoTitle).toBe('טיפול שורש 2026 — מחירון מלא');
  });

  it('rejects malformed outlines (missing tags / too few sections)', () => {
    expect(parseOutline('סתם טקסט חופשי')).toBeNull();
    expect(parseOutline('[H1]כותרת[/H1][OPENING]פתיח[/OPENING][FAQ_Q]ש?[/FAQ_Q]')).toBeNull();
    // One section only — below the 2-section floor.
    expect(parseOutline(
      '[H1]כ[/H1][OPENING]פ[/OPENING][SECTION]h2: ש?\n- א[/SECTION][FAQ_Q]ש?[/FAQ_Q]'
    )).toBeNull();
  });
});

// ── assembleBody ──────────────────────────────────────────────────────────────

describe('assembleBody', () => {
  it('renders FAQ entries as question-H2s (no FAQ schema)', () => {
    const outline: ArticleOutline = {
      h1: 'כותרת',
      opening_answer: 'פתיח',
      sections: [{ h2: 'כמה זה עולה?', points: [] }],
      faq: [{ q: 'האם יש אחריות?' }],
    };
    const body = assembleBody(outline, ['גוף הסקשן'], ['כן, שנה מלאה.']);
    expect(body).toContain('# כותרת');
    expect(body).toContain('## כמה זה עולה?');
    expect(body).toContain('## האם יש אחריות?');
    expect(body.indexOf('## האם יש אחריות?')).toBeGreaterThan(body.indexOf('## כמה זה עולה?'));
    expect(body).toContain('כן, שנה מלאה.');
  });
});

// ── The pipeline ──────────────────────────────────────────────────────────────

describe('generateArticle (stub runner E2E)', () => {
  it('happy path: valid tags → status draft, gate passed, persisted twice', async () => {
    const runner = makeRunner();
    const { admin, updates } = makeAdmin();
    const result = await generateArticle(baseInput(runner, admin));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('draft');
    expect(result.gate.passed).toBe(true);
    expect(result.gate.factCount).toBe(3); // 2 section facts + 1 FAQ fact
    // FAQ questions became question-H2s in the body.
    expect(result.body_md).toContain('## האם הטיפול כואב?');
    expect(result.body_md).toContain('## מתי צריך טיפול שורש?');
    // Tags stripped from the persisted body, content kept.
    expect(result.body_md).not.toContain('[FACT]');
    expect(result.body_md).toContain('הרדמה מקומית מלאה');
    // Lint (flag-only) ran deterministically.
    expect(result.lint.checked.deterministic).toBe(true);

    // Persistence: outline first, then the drafted body.
    expect(updates).toHaveLength(2);
    expect(updates[0].values.status).toBe('outline');
    expect((updates[0].values.outline as ArticleOutline).h1).toBe('כמה עולה טיפול שורש 2026');
    expect(updates[1].values.status).toBe('draft');
    expect(updates[1].values.body_md).toBe(result.body_md);
    const seo = updates[1].values.seo as Record<string, any>;
    expect(seo.title).toBe('טיפול שורש 2026 — מחירון מלא');
    expect(seo.gate).toEqual({ passed: true, fact_count: 3 });
    expect(seo.gate_failures).toBeUndefined();
    expect(seo.lint).toBeDefined();
  });

  it('malformed outline → one retry via the runner → succeeds', async () => {
    const runner = makeRunner({ outlineRaws: ['פלט שבור לגמרי', VALID_OUTLINE_RAW] });
    const { admin } = makeAdmin();
    const result = await generateArticle(baseInput(runner, admin));
    expect(result.ok).toBe(true);
    expect(runner.calls.outline).toBe(2);
  });

  it('malformed outline twice → clean failure, nothing persisted', async () => {
    const runner = makeRunner({ outlineRaws: ['שבור'] });
    const { admin, updates } = makeAdmin();
    const result = await generateArticle(baseInput(runner, admin));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('outline');
    expect(runner.calls.outline).toBe(2);
    expect(updates).toHaveLength(0);
  });

  it('gate failure (thin page) keeps status outline and records seo.gate_failures', async () => {
    const runner = makeRunner({
      sectionMd: () => 'טקסט כללי בלי אף עובדה קונקרטית.',
      faqRaw:    '[FAQ_A]לא כואב.[/FAQ_A]\n[FAQ_A]כשיש כאב.[/FAQ_A]',
    });
    const { admin, updates } = makeAdmin();
    const result = await generateArticle(baseInput(runner, admin));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('outline'); // NEVER draft on gate failure
    expect(result.gate.passed).toBe(false);
    expect(result.gate.failures.map((f) => f.rule)).toContain('information_gain');

    expect(updates[1].values.status).toBe('outline');
    const seo = updates[1].values.seo as Record<string, any>;
    expect(seo.gate.passed).toBe(false);
    expect(Array.isArray(seo.gate_failures)).toBe(true);
    expect(seo.gate_failures.length).toBeGreaterThan(0);
  });

  it('edit pass that breaks structure is discarded (deterministic assembly wins)', async () => {
    const runner = makeRunner({ editRaw: () => '[BODY_MD]טקסט קצר בלי כותרות ובלי עובדות[/BODY_MD]' });
    const { admin } = makeAdmin();
    const result = await generateArticle(baseInput(runner, admin));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The assembled skeleton survived the bad edit.
    expect(result.body_md).toContain('## כמה עולה טיפול שורש בחיפה?');
    expect(result.gate.passed).toBe(true);
  });

  it('edit pass that throws is fail-open (assembly used, pipeline still ok)', async () => {
    const runner = makeRunner({
      editRaw: () => { throw new Error('provider down'); },
    });
    const { admin } = makeAdmin();
    const result = await generateArticle(baseInput(runner, admin));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('draft');
  });

  it('section malformed twice → clean failure at stage section', async () => {
    const runner = makeRunner({ sectionMd: () => '' }); // stub returns untagged text
    const { admin, updates } = makeAdmin();
    const result = await generateArticle(baseInput(runner, admin));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('section');
    expect(updates).toHaveLength(1); // outline was persisted before the failure
  });

  it('FAQ answer-count mismatch after retry → clean failure at stage faq', async () => {
    const runner = makeRunner({ faqRaw: '[FAQ_A]תשובה אחת בלבד[/FAQ_A]' });
    const { admin } = makeAdmin();
    const result = await generateArticle(baseInput(runner, admin));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('faq');
    expect(runner.calls.faq).toBe(2);
  });
});
