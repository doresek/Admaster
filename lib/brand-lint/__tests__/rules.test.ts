// lib/brand-lint/__tests__/rules.test.ts
//
// Deep behavior tests for the deterministic pass — real Hebrew ad copy, not
// synthetic tokens. Each describe block pins one rule's contract.

import { describe, expect, it } from 'vitest';
import {
  computeScore,
  countEmoji,
  emojiPolicy,
  findHebrewWordMatches,
  genderAddressConsistency,
  loadedWords,
  metaPolicySafety,
  tabooWords,
} from '../rules';
import type { LintViolation } from '../types';
import { makeSpec } from './fixtures';

const rules = (vs: LintViolation[]) => vs.map((v) => v.rule);

describe('tabooWords (Hebrew prefix-aware matching)', () => {
  const spec = makeSpec({ taboo_words: ['מבצע'] });

  it('catches the exact word', () => {
    const vs = tabooWords('יש לנו מבצע מיוחד השבוע', spec);
    expect(vs).toHaveLength(1);
    expect(vs[0].severity).toBe('block');
    expect(vs[0].message).toContain('מבצע');
    expect(vs[0].index).toBe('יש לנו '.length);
  });

  it('catches clitic-prefix-attached forms: ומבצע / למבצע / ולמבצע', () => {
    expect(tabooWords('הגעתם בדיוק בזמן, ומבצע החורף מחכה', spec)).toHaveLength(1);
    expect(tabooWords('נרשמתם למבצע?', spec)).toHaveLength(1);
    expect(tabooWords('ולמבצע הזה יש סוף', spec)).toHaveLength(1);
  });

  it('reports the surface form that appeared in the text', () => {
    const vs = tabooWords('נרשמתם למבצע?', spec);
    expect(vs[0].message).toContain('למבצע');
  });

  it('does NOT false-positive on substrings inside longer words (קל vs מקלדת)', () => {
    const kal = makeSpec({ taboo_words: ['קל'] });
    // "קל" sits inside "מקלדת" as a raw substring but is not a token match.
    expect(tabooWords('מקלדת אלחוטית חדשה', kal)).toHaveLength(0);
    // "שוקל" ends with קל but "שו" is not a valid ordered prefix chain
    // (the conjunction ו can only be OUTERMOST).
    expect(tabooWords('הוא שוקל את ההצעה', kal)).toHaveLength(0);
    // "דקל" ends with קל but ד is not a clitic prefix.
    expect(tabooWords('עץ דקל ברחוב', kal)).toHaveLength(0);
    // The bare word itself is still caught.
    expect(tabooWords('זה קל ופשוט', kal)).toHaveLength(1);
  });

  it('does not match suffixed/inflected forms (documented limitation)', () => {
    expect(tabooWords('כל המבצעים הסתיימו', spec)).toHaveLength(0);
  });

  it('empty taboo list → no violations', () => {
    expect(tabooWords('מבצע ענק בכל הסניפים', makeSpec())).toHaveLength(0);
  });

  it('supports multi-word taboo phrases', () => {
    const phrase = makeSpec({ taboo_words: ['הזדמנות אחרונה'] });
    expect(tabooWords('זו הזדמנות אחרונה להצטרף', phrase)).toHaveLength(1);
    expect(tabooWords('הזדמנות נהדרת, אחרונה ברשימה', phrase)).toHaveLength(0);
  });
});

describe('findHebrewWordMatches', () => {
  it('returns char offsets into the original content', () => {
    const ms = findHebrewWordMatches('שלום, ומבצע החורף כאן', 'מבצע');
    expect(ms).toHaveLength(1);
    expect(ms[0].matched).toBe('ומבצע');
    expect(ms[0].index).toBe('שלום, '.length);
  });
});

describe('loadedWords (copywriting-craft §5 defaults + client overrides)', () => {
  it('default list words flag with severity flag', () => {
    const vs = loadedWords('מבצע ענק לסוף השבוע', makeSpec());
    expect(vs).toHaveLength(1);
    expect(vs[0].rule).toBe('loaded_word');
    expect(vs[0].severity).toBe('flag');
  });

  it('catches prefix-attached loaded words (בחינם)', () => {
    const vs = loadedWords('משלוח בחינם לכל הארץ', makeSpec());
    expect(vs).toHaveLength(1);
    expect(vs[0].message).toContain('חינם');
  });

  it('client override allow silences a default word', () => {
    const spec = makeSpec({ loaded_words_policy: { 'מבצע': 'allow' } });
    expect(loadedWords('מבצע ענק לסוף השבוע', spec)).toHaveLength(0);
  });

  it('client override block escalates a default word to block', () => {
    const spec = makeSpec({ loaded_words_policy: { 'מבצע': 'block' } });
    const vs = loadedWords('מבצע ענק לסוף השבוע', spec);
    expect(vs).toHaveLength(1);
    expect(vs[0].severity).toBe('block');
  });

  it('client can add custom words beyond the defaults', () => {
    const spec = makeSpec({ loaded_words_policy: { 'וואו': 'warn' } });
    const vs = loadedWords('וואו איזה חיסכון', spec);
    expect(vs).toHaveLength(1);
    expect(vs[0].message).toContain('וואו');
  });

  it('multiple loaded words each get their own violation', () => {
    const vs = loadedWords('מבצע בלעדי — משלוח חינם', makeSpec());
    expect(vs).toHaveLength(3);
  });
});

describe('emojiPolicy (grapheme-cluster counting)', () => {
  it('countEmoji counts a ZWJ family sequence as ONE', () => {
    expect(countEmoji('👨‍👩‍👧').count).toBe(1);
  });

  it('countEmoji counts a skin-tone modifier sequence as ONE', () => {
    expect(countEmoji('👍🏽').count).toBe(1);
  });

  it('countEmoji counts a flag (regional-indicator pair) as ONE', () => {
    expect(countEmoji('🇮🇱').count).toBe(1);
  });

  it('countEmoji ignores text-presentation symbols like © and ™', () => {
    expect(countEmoji('© כל הזכויות שמורות ™ 2026').count).toBe(0);
  });

  it('policy matrix: none / light / free × 0 / 1 / 3 emoji', () => {
    const none  = makeSpec({ emoji_policy: 'none' });
    const light = makeSpec({ emoji_policy: 'light' });
    const free  = makeSpec({ emoji_policy: 'free' });

    // 0 emoji — every policy passes
    expect(emojiPolicy('טקסט נקי לגמרי', none)).toHaveLength(0);
    expect(emojiPolicy('טקסט נקי לגמרי', light)).toHaveLength(0);
    expect(emojiPolicy('טקסט נקי לגמרי', free)).toHaveLength(0);

    // 1 emoji — none blocks, light passes, free passes
    const one = 'נתראה שם 🎉';
    expect(emojiPolicy(one, none).map((v) => v.severity)).toEqual(['block']);
    expect(emojiPolicy(one, light)).toHaveLength(0);
    expect(emojiPolicy(one, free)).toHaveLength(0);

    // 3 emoji — none blocks, light flags, free passes
    const three = 'חגיגה 🎉🎈🔥';
    expect(emojiPolicy(three, none).map((v) => v.severity)).toEqual(['block']);
    expect(emojiPolicy(three, light).map((v) => v.severity)).toEqual(['flag']);
    expect(emojiPolicy(three, free)).toHaveLength(0);
  });

  it("policy 'none' blocks even a single ZWJ sequence, counted once", () => {
    const vs = emojiPolicy('בואו כל המשפחה 👨‍👩‍👧', makeSpec({ emoji_policy: 'none' }));
    expect(vs).toHaveLength(1);
    expect(vs[0].message).toContain('1');
  });

  it("policy 'light' passes exactly 2 emoji (the boundary)", () => {
    expect(emojiPolicy('שני אלה 🎉🎈 מספיקים', makeSpec({ emoji_policy: 'light' }))).toHaveLength(0);
  });
});

describe('genderAddressConsistency (curated markers, conservative)', () => {
  it('mixing feminine + masculine 2nd-person singular in one ad = BLOCK', () => {
    // The #1 embarrassing generation bug: תרגישי (fem) then ותרגיש (masc).
    const text = 'כבר מהאימון הראשון תרגישי הבדל אמיתי. ותרגיש איך הגוף מתחזק מיום ליום.';
    const vs = genderAddressConsistency(text, makeSpec());
    expect(rules(vs)).toEqual(['gender_mix']);
    expect(vs[0].severity).toBe('block');
    expect(vs[0].message).toContain('תרגישי');
  });

  it('a mixed text gets ONLY the block, not an extra mismatch flag', () => {
    const text = 'בואי לנסות. תרגיש את ההבדל.';
    const vs = genderAddressConsistency(text, makeSpec({ address: { gender: 'female' } }));
    expect(rules(vs)).toEqual(['gender_mix']);
  });

  it("consistent feminine text vs spec address 'male' = FLAG", () => {
    const text = 'בואי לגלות טיפול חדש. תרגישי את ההבדל כבר בפגישה הראשונה.';
    const vs = genderAddressConsistency(text, makeSpec({ address: { gender: 'male' } }));
    expect(rules(vs)).toEqual(['gender_address_mismatch']);
    expect(vs[0].severity).toBe('flag');
  });

  it('text with no second-person markers → pass (no violation)', () => {
    const text = 'המוצר החדש זמין עכשיו בכל הסניפים. אפשר להזמין גם באתר.';
    expect(genderAddressConsistency(text, makeSpec({ address: { gender: 'female' } }))).toHaveLength(0);
  });

  it("plural address matches spec 'plural' → pass", () => {
    const text = 'הצטרפו אלינו עוד היום ותיהנו מחודש ראשון מתנה. מחכים לכם!';
    expect(genderAddressConsistency(text, makeSpec({ address: { gender: 'plural' } }))).toHaveLength(0);
  });

  it("singular address under spec 'plural' → flag", () => {
    const vs = genderAddressConsistency('הצטרפי עכשיו למועדון', makeSpec({ address: { gender: 'plural' } }));
    expect(rules(vs)).toEqual(['gender_address_mismatch']);
  });

  it("plural address under a singular spec is NOT flagged (sanctioned mixed-audience strategy)", () => {
    const text = 'שלחו לנו הודעה ונחזור אליכם תוך שעה';
    expect(genderAddressConsistency(text, makeSpec({ address: { gender: 'male' } }))).toHaveLength(0);
  });

  it("spec 'neutral' never flags a consistent gendered address", () => {
    const text = 'בואי לנסות, תרגישי את ההבדל';
    expect(genderAddressConsistency(text, makeSpec({ address: { gender: 'neutral' } }))).toHaveLength(0);
  });

  it('ambiguous unpointed forms (שלך / את) are deliberately NOT markers', () => {
    // "שלך" reads as either gender in unpointed Hebrew; "את" is also the
    // object marker — the conservative list must not fire on either.
    const text = 'המקום שלך מחכה. אנחנו רואים את הצורך שלך.';
    expect(genderAddressConsistency(text, makeSpec({ address: { gender: 'male' } }))).toHaveLength(0);
  });
});

describe('metaPolicySafety (copywriting-craft §7 / Meta personal attributes)', () => {
  it('"סובלים מ-X?" personal-attribute callout → BLOCK', () => {
    const vs = metaPolicySafety('סובלים מהשמנה? יש פתרון', makeSpec());
    expect(vs.some((v) => v.rule === 'meta_personal_attribute' && v.severity === 'block')).toBe(true);
  });

  it('the safe reframe — situation, not person — passes', () => {
    expect(metaPolicySafety('יש פתרון להשמנה, בלי דיאטות קסם', makeSpec())).toHaveLength(0);
  });

  it('financial-state callout "יש לך חובות?" → BLOCK', () => {
    const vs = metaPolicySafety('יש לך חובות? אנחנו נסדר את זה', makeSpec());
    expect(vs.some((v) => v.rule === 'meta_personal_attribute' && v.severity === 'block')).toBe(true);
  });

  it('age callout "בגילך" → BLOCK', () => {
    const vs = metaPolicySafety('בגילך זה כבר לא פשוט לרדת במשקל', makeSpec());
    expect(vs.some((v) => v.rule === 'meta_personal_attribute')).toBe(true);
  });

  it('appearance-attribute possession "הקמטים שלך" → BLOCK', () => {
    const vs = metaPolicySafety('הקמטים שלך ייעלמו תוך שבועיים', makeSpec());
    expect(vs.some((v) => v.rule === 'meta_personal_attribute')).toBe(true);
  });

  it('"מובטח" in outcome context → FLAG (not block)', () => {
    const vs = metaPolicySafety('תוצאות מובטחות תוך שבוע', makeSpec());
    expect(vs.map((v) => [v.rule, v.severity])).toEqual([['meta_absolute_claim', 'flag']]);
  });

  it('"לצמיתות" → FLAG', () => {
    const vs = metaPolicySafety('פתרון לצמיתות להסרת שיער', makeSpec());
    expect(vs.some((v) => v.rule === 'meta_absolute_claim' && v.severity === 'flag')).toBe(true);
  });

  it('"100%" flags only in outcome context — "100% כותנה" is a composition fact', () => {
    expect(metaPolicySafety('חולצה 100% כותנה', makeSpec())).toHaveLength(0);
    const vs = metaPolicySafety('שיטה עם 100% הצלחה', makeSpec());
    expect(vs.map((v) => v.rule)).toEqual(['meta_absolute_claim']);
  });

  it('clean dugri copy passes untouched', () => {
    expect(metaPolicySafety('זה עולה 490 ₪. בלי הפתעות. שלחו הודעה ונחזור תוך שעה.', makeSpec())).toHaveLength(0);
  });
});

describe('computeScore', () => {
  const block: LintViolation = { rule: 'x', severity: 'block', message: '', excerpt: '' };
  const flag:  LintViolation = { rule: 'y', severity: 'flag',  message: '', excerpt: '' };

  it('100 with no violations', () => expect(computeScore([])).toBe(100));
  it('−25 per block', () => expect(computeScore([block])).toBe(75));
  it('−5 per flag', () => expect(computeScore([flag, flag])).toBe(90));
  it('mixed arithmetic', () => expect(computeScore([block, flag])).toBe(70));
  it('floors at 0', () => expect(computeScore([block, block, block, block, block])).toBe(0));
});
