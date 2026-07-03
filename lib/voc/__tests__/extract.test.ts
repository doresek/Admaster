// lib/voc/extract — the prompt composition and, above all, the ANTI-
// FABRICATION GATE in parseExtraction: quotes must be real spans of the
// source (whitespace/punct tolerant); everything else is dropped with a
// reason, and a malformed OUTPUT (not item) is a typed failure, never a throw.

import { describe, expect, it } from 'vitest';
import { buildExtractionPrompt, extractQuotes, parseExtraction } from '../extract';
import {
  DENTAL_EXTRACTION_JSON,
  FABRICATED_EXTRACTION_JSON,
  GOOGLE_REVIEWS_DENTAL,
  MockLlm,
} from './fixtures';

describe('buildExtractionPrompt', () => {
  it('embeds source type, atom summaries, and fences the raw text as untrusted data', () => {
    const prompt = buildExtractionPrompt(GOOGLE_REVIEWS_DENTAL, 'own_reviews', [
      '[customers/objection] פחד שהטיפול יכאב',
    ]);
    expect(prompt).toContain('own_reviews');
    expect(prompt).toContain('[customers/objection] פחד שהטיפול יכאב');
    expect(prompt).toContain('<<<UNTRUSTED_VOC_DATA');
    expect(prompt).toContain(GOOGLE_REVIEWS_DENTAL);
    // The seven extractables are all named (voc-mining §2).
    for (const e of ['pain', 'desire', 'objection', 'alternative', 'trigger', 'proof', 'identity']) {
      expect(prompt).toContain(e);
    }
  });

  it('omits the existing-beliefs block when no atoms are supplied', () => {
    const prompt = buildExtractionPrompt('טקסט', 'manual');
    expect(prompt).not.toContain('אמונות קיימות');
  });
});

describe('parseExtraction — valid batches', () => {
  it('parses a well-formed batch with all fields', () => {
    const result = parseExtraction(DENTAL_EXTRACTION_JSON, GOOGLE_REVIEWS_DENTAL);
    if (!result.ok) throw new Error(result.error);
    expect(result.quotes).toHaveLength(4);
    expect(result.fabricated).toBe(0);
    expect(result.dropped).toHaveLength(0);
    expect(result.quotes[0]).toMatchObject({
      quote:       'פחדתי שיכאב',
      extractable: 'objection',
      polarity:    'positive',
      funnel_fit:  'MOFU',
      target_hint: 'פחד שהטיפול יכאב',
    });
    expect(result.quotes[1].segment_tags).toEqual({ gender: 'female' });
  });

  it('tolerates markdown fences and surrounding prose around the JSON', () => {
    const wrapped = 'הנה התוצאה:\n```json\n' + DENTAL_EXTRACTION_JSON + '\n```\nסיימתי.';
    const result = parseExtraction(wrapped, GOOGLE_REVIEWS_DENTAL);
    if (!result.ok) throw new Error(result.error);
    expect(result.quotes).toHaveLength(4);
  });

  it('accepts a quote whose whitespace/punctuation differ from the source', () => {
    // Source: "אחרי שנים של פחד ממרפאות, פחדתי שיכאב" — model normalized.
    const output = JSON.stringify({
      quotes: [{
        quote: 'אחרי שנים  של פחד ממרפאות פחדתי שיכאב!',
        extractable: 'pain', polarity: 'positive', segment_tags: {}, funnel_fit: 'TOFU',
      }],
    });
    const result = parseExtraction(output, GOOGLE_REVIEWS_DENTAL);
    if (!result.ok) throw new Error(result.error);
    expect(result.quotes).toHaveLength(1);
    expect(result.fabricated).toBe(0);
  });

  it('defaults a MISSING polarity to neutral', () => {
    const output = JSON.stringify({
      quotes: [{ quote: 'בלי לחץ', extractable: 'proof', segment_tags: {}, funnel_fit: null }],
    });
    const result = parseExtraction(output, GOOGLE_REVIEWS_DENTAL);
    if (!result.ok) throw new Error(result.error);
    expect(result.quotes[0].polarity).toBe('neutral');
  });

  it('nulls an invalid funnel_fit instead of dropping the quote', () => {
    const output = JSON.stringify({
      quotes: [{ quote: 'בלי לחץ', extractable: 'proof', polarity: 'positive', segment_tags: {}, funnel_fit: 'FUNNEL' }],
    });
    const result = parseExtraction(output, GOOGLE_REVIEWS_DENTAL);
    if (!result.ok) throw new Error(result.error);
    expect(result.quotes[0].funnel_fit).toBeNull();
  });
});

describe('parseExtraction — the anti-fabrication gate', () => {
  it('REJECTS a quote that is not a span of the source, and counts it', () => {
    const result = parseExtraction(FABRICATED_EXTRACTION_JSON, GOOGLE_REVIEWS_DENTAL);
    if (!result.ok) throw new Error(result.error);
    expect(result.quotes).toHaveLength(1); // only the real one survives
    expect(result.fabricated).toBe(1);
    expect(result.dropped).toEqual([
      expect.objectContaining({ reason: 'fabricated', detail: expect.stringContaining('שינה לי את החיים') }),
    ]);
  });

  it('rejects a subtly-reworded quote (word swapped) — no fuzzy mercy on words', () => {
    // Source says "הייתי מתביישת לחייך"; the model "improved" a word.
    const output = JSON.stringify({
      quotes: [{ quote: 'הייתי מתביישת לצחוק', extractable: 'pain', polarity: 'positive', segment_tags: {}, funnel_fit: 'TOFU' }],
    });
    const result = parseExtraction(output, GOOGLE_REVIEWS_DENTAL);
    if (!result.ok) throw new Error(result.error);
    expect(result.quotes).toHaveLength(0);
    expect(result.fabricated).toBe(1);
  });
});

describe('parseExtraction — per-item validation', () => {
  it('drops an invalid extractable with a reason, keeps the rest', () => {
    const output = JSON.stringify({
      quotes: [
        { quote: 'פחדתי שיכאב', extractable: 'complaint', polarity: 'positive', segment_tags: {}, funnel_fit: null },
        { quote: 'בלי לחץ', extractable: 'proof', polarity: 'positive', segment_tags: {}, funnel_fit: 'BOFU' },
      ],
    });
    const result = parseExtraction(output, GOOGLE_REVIEWS_DENTAL);
    if (!result.ok) throw new Error(result.error);
    expect(result.quotes).toHaveLength(1);
    expect(result.dropped).toEqual([expect.objectContaining({ reason: 'invalid_extractable' })]);
  });

  it('drops a PRESENT-but-invalid polarity, empty quotes, and non-objects', () => {
    const output = JSON.stringify({
      quotes: [
        { quote: 'בלי לחץ', extractable: 'proof', polarity: 'meh', segment_tags: {} },
        { quote: '', extractable: 'pain', polarity: 'positive' },
        'not an object',
      ],
    });
    const result = parseExtraction(output, GOOGLE_REVIEWS_DENTAL);
    if (!result.ok) throw new Error(result.error);
    expect(result.quotes).toHaveLength(0);
    expect(result.dropped.map((d) => d.reason).sort()).toEqual(
      ['empty_quote', 'invalid_polarity', 'not_an_object'].sort(),
    );
  });
});

describe('parseExtraction — malformed output (typed failure, never a throw)', () => {
  it('fails on empty output', () => {
    const result = parseExtraction('', GOOGLE_REVIEWS_DENTAL);
    expect(result).toEqual({ ok: false, error: 'empty model output' });
  });

  it('fails on non-JSON output', () => {
    const result = parseExtraction('אין לי מושג { לא ג׳ייסון', GOOGLE_REVIEWS_DENTAL);
    expect(result.ok).toBe(false);
  });

  it('fails when there is no quotes array', () => {
    const result = parseExtraction('{"items": []}', GOOGLE_REVIEWS_DENTAL);
    expect(result).toEqual({ ok: false, error: 'model output has no quotes array' });
  });
});

describe('extractQuotes — the seam', () => {
  it('composes the prompt, runs the injected llm, parses the output', async () => {
    const llm = new MockLlm(DENTAL_EXTRACTION_JSON);
    const result = await extractQuotes(GOOGLE_REVIEWS_DENTAL, 'own_reviews', [], llm);
    if (!result.ok) throw new Error(result.error);
    expect(result.quotes).toHaveLength(4);
    expect(llm.prompts).toHaveLength(1);
    expect(llm.prompts[0]).toContain('<<<UNTRUSTED_VOC_DATA');
  });
});
