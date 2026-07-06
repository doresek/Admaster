// tests/master-studio/creator.test.ts
import { describe, it, expect } from 'vitest';
import { composeCreatorPrompt, parseCreator } from '@/lib/master-studio/creator';
import { MARKETERS_BY_ID } from '@/lib/marketers';

const avatar = { persona: 'אמא טרייה', fears: 'x', desires: 'y', awareness_level: '2', objections: 'z' };

describe('composeCreatorPrompt', () => {
  it('embeds the assigned marketer name and the avatar persona', () => {
    const { system, user } = composeCreatorPrompt(
      { brief: 'קורס יוגה', platform: 'Instagram' }, MARKETERS_BY_ID.halbert, avatar);
    expect(system).toContain(MARKETERS_BY_ID.halbert.name);
    expect(system).toContain('אמא טרייה');
    expect(system).toContain('[POST]');
    expect(user).toContain('קורס יוגה');
  });
  it('forces framework when locked', () => {
    const { system } = composeCreatorPrompt(
      { brief: 'x', platform: 'FB', framework: 'pas' }, MARKETERS_BY_ID.halbert, avatar);
    expect(system).toMatch(/PAS|pas/);
  });
  it('GROUNDING forbids inventing names/specifics and overrides the urge to add color', () => {
    const { system } = composeCreatorPrompt(
      { brief: 'x', platform: 'FB' }, MARKETERS_BY_ID.halbert, avatar);
    expect(system).toContain('אסור להמציא');
    expect(system).toContain('בעל העסק'); // generic fallback, never an invented name
    expect(system).toContain('גובר על הנטייה להוסיף "צבע"');
  });
  it('includes the framed lessons section when learningContext is provided (G1)', () => {
    const lessons = '• עצירת-גלילה (scroll_stop) — ממוצע 70';
    const { system } = composeCreatorPrompt(
      { brief: 'x', platform: 'FB', learningContext: lessons }, MARKETERS_BY_ID.halbert, avatar);
    expect(system).toContain('═══ לקחים מפוסטים קודמים — חיזוק נקודות התורפה ═══');
    expect(system).toContain(lessons);
    // Reliability contract intact — parser tags and grounding still present.
    expect(system).toContain('[POST]');
    expect(system).toContain('אסור להמציא');
  });

  it('prompts are byte-identical to the no-history prompt when learningContext is absent/empty', () => {
    const base = composeCreatorPrompt({ brief: 'x', platform: 'FB' }, MARKETERS_BY_ID.halbert, avatar);
    const withUndef = composeCreatorPrompt(
      { brief: 'x', platform: 'FB', learningContext: undefined }, MARKETERS_BY_ID.halbert, avatar);
    const withEmpty = composeCreatorPrompt(
      { brief: 'x', platform: 'FB', learningContext: '' }, MARKETERS_BY_ID.halbert, avatar);
    const withBlank = composeCreatorPrompt(
      { brief: 'x', platform: 'FB', learningContext: '   \n ' }, MARKETERS_BY_ID.halbert, avatar);
    expect(withUndef.system).toBe(base.system);
    expect(withEmpty.system).toBe(base.system);
    expect(withBlank.system).toBe(base.system);
    expect(withEmpty.user).toBe(base.user);
    expect(base.system).not.toContain('לקחים מפוסטים קודמים');
  });

  it('engineers a scroll-stopping image + hook derived from the avatar atoms', () => {
    const { system } = composeCreatorPrompt(
      { brief: 'x', platform: 'FB' }, MARKETERS_BY_ID.halbert, avatar);
    expect(system).toContain('עצירת-גלילה');          // scroll-stop directive present
    expect(system).toContain('pattern-interrupt');    // craft cue for the image
    expect(system).toMatch(/scroll-STOPPING image/);  // the IMAGE_PROMPT tag is enriched
    expect(system).toContain('[IMAGE_PROMPT]');        // parser tag still intact
    expect(system).toContain('[POST]');                // parser tag still intact
  });
});

describe('parseCreator', () => {
  it('parses a full post block', () => {
    const raw = `[PRINCIPLES_APPLIED]\n- עקרון: "story" → איך התבטא: פתחתי בסיפור\n[/PRINCIPLES_APPLIED]
[POST]בוקר טוב אמהות 🌸[/POST][HASHTAGS]#יוגה #אמהות[/HASHTAGS]
[IMAGE_PROMPT]a calm yoga studio[/IMAGE_PROMPT][TIPS]פרסמי בבוקר[/TIPS][WHATSAPP]היי, יש קורס[/WHATSAPP]`;
    const d = parseCreator(raw)!;
    expect(d.post).toContain('בוקר טוב');
    expect(d.hashtags).toEqual(['#יוגה', '#אמהות']);
    expect(d.image).toBe('a calm yoga studio');
    expect(d.principles[0].principle).toBe('story');
  });
  it('returns null when [POST] missing', () => {
    expect(parseCreator('[HASHTAGS]#x[/HASHTAGS]')).toBeNull();
  });
});
