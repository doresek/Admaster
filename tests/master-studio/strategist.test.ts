// tests/master-studio/strategist.test.ts
import { describe, it, expect } from 'vitest';
import { composeStrategistPrompt, parseStrategist } from '@/lib/master-studio/strategist';

describe('composeStrategistPrompt', () => {
  it('embeds brief, master notes and asks for top-3', () => {
    const { system, user } = composeStrategistPrompt({
      brief: 'קורס יוגה לנשים אחרי לידה', platform: 'Instagram',
      masterNotes: 'אל תזכיר מחיר',
    });
    expect(user).toContain('קורס יוגה');
    expect(system).toContain('אל תזכיר מחיר');           // master notes injected
    expect(system).toContain('RANKED_MARKETERS');         // contract present
    expect(system).toContain('AVATAR_PROFILE');
  });
  it('instructs the avatar to be derived from the brief, not invented', () => {
    const { system } = composeStrategistPrompt({ brief: 'x', platform: 'FB' });
    expect(system).toContain('מקור האמת');
    expect(system).toContain('אל תמציא');
  });
});

describe('parseStrategist', () => {
  const raw = `[AVATAR_PROFILE]
persona: אמא טרייה בת 30
fears: לא לחזור לעצמה
desires: ביטחון בגוף
awareness_level: 2 - בעיה מודעת
objections: אין זמן
[/AVATAR_PROFILE]
[RANKED_MARKETERS]
1. halbert|Gary Halbert|🔥|סטוריטלינג רגשי
2. cialdini|Robert Cialdini|🧲|הוכחה חברתית
3. hormozi|Alex Hormozi|💰|הצעה שלא מסרבים
[/RANKED_MARKETERS]`;

  it('parses avatar and exactly 3 valid marketers', () => {
    const out = parseStrategist(raw);
    expect(out.avatar?.persona).toBe('אמא טרייה בת 30');
    expect(out.ranked.map(m => m.id)).toEqual(['halbert', 'cialdini', 'hormozi']);
    expect(out.ranked[0].why).toContain('סטוריטלינג');
  });

  it('pads to 3 from the corpus when fewer valid ids returned', () => {
    const out = parseStrategist(`[RANKED_MARKETERS]\n1. halbert|Gary|🔥|x\n[/RANKED_MARKETERS]`);
    expect(out.ranked).toHaveLength(3);
    expect(out.ranked[0].id).toBe('halbert');
    expect(new Set(out.ranked.map(m => m.id)).size).toBe(3); // distinct
  });

  it('drops unknown ids and dedupes', () => {
    const out = parseStrategist(`[RANKED_MARKETERS]\n1. bogus|x|x|x\n2. ogilvy|O|🎩|y\n3. ogilvy|O|🎩|y\n[/RANKED_MARKETERS]`);
    expect(out.ranked).toHaveLength(3);
    expect(out.ranked.filter(m => m.id === 'ogilvy')).toHaveLength(1);
    expect(out.ranked.every(m => m.id !== 'bogus')).toBe(true);
  });
});
