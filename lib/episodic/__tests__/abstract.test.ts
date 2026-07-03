// Behavior tests for the fleet-safe abstraction pass (abstractEpisode). The
// abstraction guards Israeli-privacy-sensitive fields: the Hebrew client name
// everywhere it appears, phones, emails, URLs, and caller-supplied business
// terms — and refuses (returns null) when what remains is too thin to teach.
import { describe, expect, it } from 'vitest';
import { abstractEpisode } from '../compose';

const CLIENT = 'מרפאת שיניים ד"ר כהן';

// A real-shaped Hebrew episode, the way composeFromDiagnosis renders one.
const EPISODE = [
  'Situation: campaign item underperformed — funnel stage MOFU; angle "ביטחון רגשי"; metrics: ctr=0.021, cvr=0.0095.',
  `Action: ran link-isolation diagnosis over the client's insight atoms; recommended: swap_landing_headline.`,
  'Outcome: failed link = funnel.',
  `Lesson: funnel link broke — דף הנחיתה של מרפאת שיניים ד"ר כהן מכר הנחה בעוד המודעה של מרפאת שיניים ד"ר כהן מכרה ביטחון רגשי; ליצירת קשר: 050-1234567, info@kohen-dental.co.il, https://kohen-dental.co.il/landing.`,
].join('\n');

describe('abstractEpisode — client name', () => {
  it('strips every occurrence of a Hebrew client name', () => {
    const out = abstractEpisode(EPISODE, { clientName: CLIENT });
    expect(out).not.toBeNull();
    expect(out).not.toContain('כהן');
    expect(out).not.toContain('מרפאת שיניים');
    // Both occurrences replaced, not just the first.
    expect((out ?? '').match(/\{business\}/g)?.length).toBe(2);
  });

  it('tolerates whitespace and gershayim variants inside the name', () => {
    const text = `Lesson: funnel broke — the landing page of מרפאת   שיניים ד״ר כהן contradicted the ad angle for parents of anxious kids.`;
    const out = abstractEpisode(text, { clientName: CLIENT });
    expect(out).not.toBeNull();
    expect(out).not.toContain('כהן');
    expect(out).toContain('{business}');
  });

  it('is case-insensitive for Latin client names', () => {
    const text = 'Lesson: offer broke — Kohen Dental discount framing contradicted the premium positioning atoms of KOHEN DENTAL for this audience.';
    const out = abstractEpisode(text, { clientName: 'kohen dental' });
    expect(out).not.toBeNull();
    expect(out).not.toMatch(/kohen dental/i);
    expect((out ?? '').match(/\{business\}/g)?.length).toBe(2);
  });
});

describe('abstractEpisode — PII channels', () => {
  it('strips phones (local and +972), emails and URLs', () => {
    const out = abstractEpisode(EPISODE, { clientName: CLIENT });
    expect(out).not.toBeNull();
    expect(out).not.toContain('050-1234567');
    expect(out).not.toContain('info@kohen-dental.co.il');
    expect(out).not.toContain('https://kohen-dental.co.il');
    expect(out).toContain('{phone}');
    expect(out).toContain('{email}');
    expect(out).toContain('{url}');
  });

  it('strips +972 and www-style variants', () => {
    const text = 'Lesson: audience broke — leads called +972-50-123-4567 and browsed www.kohen-dental.co.il/pricing before churning at the price step.';
    const out = abstractEpisode(text);
    expect(out).not.toBeNull();
    expect(out).not.toContain('+972');
    expect(out).not.toContain('www.kohen-dental');
    expect(out).toContain('{phone}');
    expect(out).toContain('{url}');
  });

  it('does NOT redact metric values or ISO dates as phones', () => {
    const text = 'Situation: 14000 impressions, ctr=0.021, cvr=0.0095, resolved on 2026-06-10 — the funnel scent break persisted for the whole window.';
    const out = abstractEpisode(text);
    expect(out).toContain('14000 impressions');
    expect(out).toContain('ctr=0.021');
    expect(out).toContain('2026-06-10');
    expect(out).not.toContain('{phone}');
  });

  it('strips caller-supplied business terms', () => {
    const text = 'Lesson: offer broke — the "חיוך של כוכבים" bundle priced out the parents segment even after the emotional-safety reframe.';
    const out = abstractEpisode(text, { businessTerms: ['חיוך של כוכבים'] });
    expect(out).not.toBeNull();
    expect(out).not.toContain('חיוך של כוכבים');
    expect(out).toContain('{term}');
  });
});

describe('abstractEpisode — conservatism', () => {
  it('returns null when the redacted residue is too short to be useful', () => {
    expect(abstractEpisode(`${CLIENT} 050-1234567`, { clientName: CLIENT })).toBeNull();
    expect(abstractEpisode('short text', {})).toBeNull();
    expect(abstractEpisode('', {})).toBeNull();
    expect(abstractEpisode('   \n  ', {})).toBeNull();
  });

  it('placeholders do not count toward the usefulness threshold', () => {
    // Lots of placeholders, almost no substance → still null.
    const text = `${CLIENT} ${CLIENT} ${CLIENT} https://a.co info@a.co 050-1234567 ok`;
    expect(abstractEpisode(text, { clientName: CLIENT })).toBeNull();
  });

  it('is idempotent — abstracting twice equals abstracting once', () => {
    const once = abstractEpisode(EPISODE, { clientName: CLIENT });
    expect(once).not.toBeNull();
    const twice = abstractEpisode(once ?? '', { clientName: CLIENT });
    expect(twice).toBe(once);
  });
});
