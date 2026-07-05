// Ensures BOTH prod content shapes of approvals.content render, plus the
// snapshotted fields the extended /api/approvals POST now writes.
import { describe, it, expect } from 'vitest';
import { normalizeAdContent, groundingLine, firstLine } from '@/components/approvals/ad-content';

describe('normalizeAdContent', () => {
  it('handles the manual dashboard shape { text, image_url }', () => {
    const ad = normalizeAdContent({ text: 'שלום עולם\nשורה שנייה', image_url: 'https://x/img.png' });
    expect(ad.text).toBe('שלום עולם\nשורה שנייה');
    expect(ad.imageUrl).toBe('https://x/img.png');
    expect(ad.imagePrompt).toBeNull();
    expect(firstLine(ad)).toBe('שלום עולם');
  });

  it('handles the autopilot shape { post, hashtags, image_prompt, score, judge }', () => {
    const ad = normalizeAdContent({
      post: 'מודעה מ-Autopilot לבדיקה',
      hashtags: ['שיווק', '#עסקים', ''],
      image_prompt: 'בעל עסק מחייך מול לפטופ',
      framework: 'AIDA',
      score: 87,
      judge: { verdict: 'approve', rationale: 'קופי ממוקד כאב עם CTA ברור', scores: {}, overall: 80, flags: [] },
    });
    expect(ad.text).toBe('מודעה מ-Autopilot לבדיקה');
    expect(ad.hashtags).toEqual(['שיווק', '#עסקים']);
    expect(ad.imageUrl).toBeNull();
    expect(ad.imagePrompt).toBe('בעל עסק מחייך מול לפטופ');
    expect(ad.score).toBe(87);
    expect(ad.judgeRationale).toBe('קופי ממוקד כאב עם CTA ברור');
  });

  it('reads snapshotted client_name, grounding, audience and budget', () => {
    const ad = normalizeAdContent({
      text: 'פוסט',
      client_name: 'מאפיית לחם הארץ',
      audience: 'הורים צעירים ברדיוס 10 ק"מ',
      budget: { daily: 50, currency: 'ILS' },
      grounding: [
        { id: 'a1', content: 'לקוחות מזכירים את הריח של הלחם הטרי', confidence: 0.9, layer: 'voice' },
        { id: 'a2', content: '', confidence: 0.5, layer: 'x' }, // empty content dropped
        'not-an-object',
      ],
    });
    expect(ad.clientName).toBe('מאפיית לחם הארץ');
    expect(ad.audience).toBe('הורים צעירים ברדיוס 10 ק"מ');
    expect(ad.budget).toBe('₪50 ליום');
    expect(ad.grounding).toHaveLength(1);
    expect(groundingLine(ad)).toBe('המודעה נבנתה סביב לקוחות מזכירים את הריח של הלחם הטרי');
  });

  it('degrades gracefully on null / string / garbage payloads', () => {
    expect(normalizeAdContent(null).text).toBe('');
    expect(normalizeAdContent(undefined).grounding).toEqual([]);
    expect(normalizeAdContent('טקסט גולמי').text).toBe('טקסט גולמי');
    expect(normalizeAdContent(42).text).toBe('');
    expect(groundingLine(normalizeAdContent({}))).toBeNull();
  });

  it('formats budgets from number, string and object shapes', () => {
    expect(normalizeAdContent({ text: 'x', budget: 1200 }).budget).toBe('₪1,200');
    expect(normalizeAdContent({ text: 'x', budget: '₪100 ליום' }).budget).toBe('₪100 ליום');
    expect(normalizeAdContent({ text: 'x', budget: { daily_budget: 30, currency: 'USD' } }).budget).toBe('30 USD ליום');
    expect(normalizeAdContent({ text: 'x', budget: {} }).budget).toBeNull();
  });
});
