// lib/brand-lint/rules.ts
//
// C-07 deterministic lint pass — pure functions, no I/O, no LLM. This is the
// half of the lint that gives "100% mechanical brand coverage": every rule is
// a named function (content, spec) → violations, so each behavior is testable
// in isolation and the composition (lint.ts) is a flat pipeline.
//
// Craft sources (cited per rule): copywriting-craft §5 (Hebrew/Israeli
// persuasion rules incl. loaded words) and §7 (ship checklist incl. Meta
// policy); hebrew-content-writer for register/gender mechanics.
//
// ── Hebrew word matching (prefix-aware) ───────────────────────────────────────
// Hebrew clitic prefixes attach directly to the word: ו (and), ש/כש (that/
// when), ב/כ/ל/מ (in/as/to/from) and the article ה — so a taboo word "מבצע"
// appears in text as "ומבצע", "למבצע", "ולמבצע", "כשהמבצע"… Matching approach:
//   1. tokenize into maximal letter runs (Hebrew + Latin + digits, nikud kept
//      inside the token then stripped) — this alone kills raw-substring false
//      positives ("קל" can never match inside "מקלדת": tokens are compared
//      whole, never scanned inside);
//   2. a token matches word W iff token === W, or token endsWith W and the
//      leftover head is a VALID ORDERED prefix chain: ו? (כש|ש)? [בהכלמ]? —
//      order matters: "שוקל" is NOT ש+ו+קל because the conjunction ו can only
//      be outermost, so "שו" is rejected and "שוקל" (weighs) stays clean.
// Honest limits: suffixed/inflected forms are NOT matched ("מבצעים" does not
// match taboo "מבצע") — we only tolerate prefixes, per the false-positive-averse
// design; and a real word that IS prefix+taboo (e.g. taboo "לב" vs "שלב")
// will false-positive — taboo lists should prefer distinctive words.

import type { BrandVoiceSpec, LintViolation, LoadedWordAction } from './types';

/** A deterministic lint rule: pure (content, spec) → violations. */
export type LintRule = (content: string, spec: BrandVoiceSpec) => LintViolation[];

// ── tokenizer ─────────────────────────────────────────────────────────────────

interface Token { text: string; index: number }

// Letter runs: Hebrew letters (U+05D0–U+05EA covers finals), nikud (kept so a
// pointed word stays one token, stripped before compare), geresh/gershayim
// (פיצ'ר, צה״ל), Latin letters and digits, ASCII apostrophe (פיצ'ר spelled
// with '). Everything else (spaces, punctuation, emoji) separates tokens.
const WORD_RE = /[\u05B0-\u05C7\u05D0-\u05EA\u05F3\u05F4A-Za-z0-9']+/g;
const NIKUD_RE = /[\u05B0-\u05C7]/g;

function tokenize(content: string): Token[] {
  const out: Token[] = [];
  for (const m of content.matchAll(WORD_RE)) {
    const text = m[0].replace(NIKUD_RE, '');
    if (text.length > 0 && m.index !== undefined) out.push({ text, index: m.index });
  }
  return out;
}

// Valid clitic-prefix chains in canonical order: conjunction ו outermost, then
// ש/כש, then one of ב/ה/כ/ל/מ. Empty chain = the bare word itself.
const PREFIX_CHAIN_RE = /^ו?(?:כש|ש)?[בהכלמ]?$/;

const tokenMatchesWord = (token: string, word: string): boolean =>
  token.endsWith(word) && PREFIX_CHAIN_RE.test(token.slice(0, token.length - word.length));

export interface WordMatch { matched: string; index: number }

/**
 * Find prefix-tolerant whole-word occurrences of `word` (or a multi-word
 * phrase: first word prefix-tolerant, subsequent words exact) in `content`.
 * Exported so taboo + loaded-word rules (and future rules) share ONE matcher.
 */
export function findHebrewWordMatches(content: string, word: string): WordMatch[] {
  const parts = word.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return [];

  const tokens = tokenize(content);
  const out: WordMatch[] = [];
  for (let i = 0; i + parts.length <= tokens.length; i++) {
    if (!tokenMatchesWord(tokens[i].text, parts[0])) continue;
    let ok = true;
    for (let j = 1; j < parts.length; j++) {
      if (tokens[i + j].text !== parts[j]) { ok = false; break; }
    }
    if (ok) {
      const last = tokens[i + parts.length - 1];
      out.push({ matched: content.slice(tokens[i].index, last.index + last.text.length), index: tokens[i].index });
    }
  }
  return out;
}

/** ~40 chars of context around a finding, with ellipses when clipped. */
export function excerptAround(content: string, index: number, radius = 20): string {
  const start = Math.max(0, index - radius);
  const end   = Math.min(content.length, index + radius);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

// ── rule: taboo words ─────────────────────────────────────────────────────────

/**
 * Client-declared banned words (spec.taboo_words) — always BLOCK. WHY: the
 * taboo list is the client's explicit "never say this" (competitor names,
 * off-brand slang, legally risky terms); one occurrence is a brand breach,
 * so this is the hardest deterministic rule. Prefix-aware matching per the
 * header note ("ומבצע" contains taboo "מבצע").
 */
export function tabooWords(content: string, spec: BrandVoiceSpec): LintViolation[] {
  const out: LintViolation[] = [];
  for (const word of spec.taboo_words) {
    for (const m of findHebrewWordMatches(content, word)) {
      out.push({
        rule:     'taboo_word',
        severity: 'block',
        message:  `מילה אסורה למותג: "${word}" (הופיעה כ-"${m.matched}")`,
        excerpt:  excerptAround(content, m.index),
        index:    m.index,
      });
    }
  }
  return out;
}

// ── rule: loaded words ────────────────────────────────────────────────────────

/**
 * Default loaded-words list per copywriting-craft §5 ("loaded words to handle
 * with care") — Israeli readers auto-discount these; default action 'warn':
 *   מבצע   — flea-market flavor; fine for retail, cheapens premium;
 *   חינם   — triggers catch-scanning ("what's the קומבינה?"); state the catch;
 *   מהפכני — auto-discounted superlative; show, don't declare;
 *   בלעדי  — same superlative smell as מהפכני (reasonable addition);
 *   אחרון  — fake-scarcity flavor unless literally true (§5 קומבינה note);
 *   מטורף  — hype slang; reads as shouting outside casual registers.
 */
export const DEFAULT_LOADED_WORDS: Record<string, LoadedWordAction> = {
  'מבצע':   'warn',
  'חינם':   'warn',
  'מהפכני': 'warn',
  'בלעדי':  'warn',
  'אחרון':  'warn',
  'מטורף':  'warn',
};

/**
 * Loaded words: defaults above, overridden per word by the client's
 * spec.loaded_words_policy ('allow' silences, 'warn' flags, 'block' blocks —
 * a client may also ADD words of their own). WHY: these words are not banned,
 * they're risky; the client's vertical decides (מבצע is right for retail,
 * wrong for a premium clinic) — so the policy is client-owned with craft
 * defaults.
 */
export function loadedWords(content: string, spec: BrandVoiceSpec): LintViolation[] {
  const policy: Record<string, LoadedWordAction> = { ...DEFAULT_LOADED_WORDS, ...spec.loaded_words_policy };
  const out: LintViolation[] = [];
  for (const [word, action] of Object.entries(policy)) {
    if (action === 'allow' || word.length === 0) continue;
    for (const m of findHebrewWordMatches(content, word)) {
      out.push({
        rule:     'loaded_word',
        severity: action === 'block' ? 'block' : 'flag',
        message:  `מילה טעונה: "${word}" (הופיעה כ-"${m.matched}") — ${action === 'block' ? 'חסומה במדיניות המותג' : 'קוראים ישראלים מנכים אותה אוטומטית (copywriting-craft §5)'}`,
        excerpt:  excerptAround(content, m.index),
        index:    m.index,
      });
    }
  }
  return out;
}

// ── rule: emoji policy ────────────────────────────────────────────────────────

// A grapheme is an emoji iff it contains an emoji-presentation code point, a
// regional indicator (flags), a variation selector-16 (text-default pictographs
// styled as emoji: ❤️ ☎️) or a keycap combiner (1️⃣). Deliberately NOT
// \p{Extended_Pictographic} alone — that would count plain "©" and "™" as
// emoji. Counting unit is the GRAPHEME CLUSTER (Intl.Segmenter), not code
// points, so 👨‍👩‍👧 (ZWJ family) and 👍🏽 (skin tone) each count as ONE.
const EMOJI_GRAPHEME_RE = /\p{Emoji_Presentation}|\p{Regional_Indicator}|[\uFE0F\u20E3]/u;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Count emoji grapheme clusters. firstIndex = char offset of the first, or -1. */
export function countEmoji(content: string): { count: number; firstIndex: number } {
  let count = 0;
  let firstIndex = -1;
  for (const seg of GRAPHEMES.segment(content)) {
    if (EMOJI_GRAPHEME_RE.test(seg.segment)) {
      count++;
      if (firstIndex < 0) firstIndex = seg.index;
    }
  }
  return { count, firstIndex };
}

/**
 * Emoji policy per the register (copywriting-craft §5: "B2B/professional →
 * business register, zero emoji"; young/consumer → tolerance). 'none' → any
 * emoji BLOCKS (a single 🎉 in a law-firm post is a brand breach); 'light' →
 * more than 2 flags; 'free' → pass.
 */
export function emojiPolicy(content: string, spec: BrandVoiceSpec): LintViolation[] {
  const { count, firstIndex } = countEmoji(content);
  if (count === 0 || spec.emoji_policy === 'free') return [];

  if (spec.emoji_policy === 'none') {
    return [{
      rule:     'emoji_policy',
      severity: 'block',
      message:  `מדיניות המותג אוסרת אמוג'י — נמצאו ${count}`,
      excerpt:  excerptAround(content, firstIndex),
      index:    firstIndex,
    }];
  }
  // 'light'
  if (count > 2) {
    return [{
      rule:     'emoji_policy',
      severity: 'flag',
      message:  `מדיניות אמוג'י "light" מתירה עד 2 — נמצאו ${count}`,
      excerpt:  excerptAround(content, firstIndex),
      index:    firstIndex,
    }];
  }
  return [];
}

// ── rule: gender-address consistency ──────────────────────────────────────────

// CURATED marker lists, not general morphology — deliberately conservative.
// Hebrew 2nd-person gender is often letter-identical in unpointed writing
// (לך/שלך/אותך read as either gender; את is also the object marker), so we
// only trust markers whose LETTERS are gender-distinct:
//   • feminine 2sg: the ־י suffix on future/imperative verbs (תרגישי, בואי)
//     and the fem-spelled עלייך — morphologically the most reliable class;
//   • masculine 2sg: the pronoun אתה + common bare-masculine CTA verbs. Honest
//     limit: forms like תרגיש are ALSO 3fs future ("היא תרגיש") — in 2nd-person-
//     heavy ad copy the 2ms reading dominates, but third-person narration can
//     false-positive; that trade-off is accepted and documented here;
//   • plural: אתם/אתן, the unambiguous dative/possessive לכם/שלכם/אתכם, and
//     common plural-imperative CTAs (בואו, שלחו — which collide with 3pl past
//     "הם שלחו"; same accepted limit as above).
// A word with NO marker (impersonal "יש ל…", "אפשר…") passes with no violation
// — absence of evidence is not a violation (per the conservative mandate).
// Markers match as whole tokens with only ו/ש/כש prefixes tolerated (ותרגישי,
// שתבואי, כשתרגיש) — the article/prepositions don't attach to finite verbs.

const MASC_2SG_MARKERS: readonly string[] = [
  'אתה',
  'תרגיש', 'תקבל', 'תיהנה', 'תצטרף', 'תבוא', 'תשלח', 'תבדוק', 'תנסה', 'תתקשר', 'תירשם',
  'בוא', 'קבל', 'הצטרף', 'שלח', 'בדוק', 'נסה', 'התקשר', 'הירשם',
];

const FEM_2SG_MARKERS: readonly string[] = [
  'עלייך',
  'תרגישי', 'תקבלי', 'תיהני', 'תצטרפי', 'תבואי', 'תשלחי', 'תבדקי', 'תנסי', 'תתקשרי', 'תירשמי', 'תלחצי',
  'בואי', 'קבלי', 'הצטרפי', 'שלחי', 'בדקי', 'נסי', 'התקשרי', 'הירשמי', 'לחצי',
];

const PLURAL_MARKERS: readonly string[] = [
  'אתם', 'אתן', 'לכם', 'לכן', 'שלכם', 'שלכן', 'אתכם', 'אתכן', 'עליכם',
  'תרגישו', 'תקבלו', 'תיהנו', 'תצטרפו', 'תבואו', 'תשלחו', 'תבדקו', 'תנסו', 'תתקשרו', 'תירשמו', 'תלחצו',
  'בואו', 'קבלו', 'הצטרפו', 'שלחו', 'בדקו', 'נסו', 'התקשרו', 'הירשמו', 'לחצו',
];

// Only ו (and), ש/כש (that/when) attach to these markers.
const MARKER_PREFIX_RE = /^ו?(?:כש|ש)?$/;

interface MarkerHit { marker: string; matched: string; index: number }

function findMarkers(tokens: Token[], markers: readonly string[]): MarkerHit[] {
  const out: MarkerHit[] = [];
  for (const t of tokens) {
    for (const marker of markers) {
      if (t.text.endsWith(marker) && MARKER_PREFIX_RE.test(t.text.slice(0, t.text.length - marker.length))) {
        out.push({ marker, matched: t.text, index: t.index });
        break;
      }
    }
  }
  return out;
}

/**
 * Gender-address consistency — two checks:
 *   (a) CONSISTENCY: masculine-2sg + feminine-2sg markers in one text → BLOCK.
 *       WHY: copywriting-craft §5 "Never alternate forms mid-copy" — mixed
 *       gendered address is the #1 embarrassing generation bug; it reads as
 *       machine-written and burns trust instantly.
 *   (b) SPEC MATCH: address gender that contradicts spec.address.gender →
 *       FLAG. WHY: §5 "match the dominant sub_audience atom". Flag, not block:
 *       the copy may target a legitimate sub-audience. Plural under a
 *       male/female spec is NOT flagged (plural is the sanctioned
 *       mixed-audience strategy); 'neutral' spec never flags.
 * No markers found → pass (conservative by design; see marker-list note).
 */
export function genderAddressConsistency(content: string, spec: BrandVoiceSpec): LintViolation[] {
  const tokens = tokenize(content);
  const masc   = findMarkers(tokens, MASC_2SG_MARKERS);
  const fem    = findMarkers(tokens, FEM_2SG_MARKERS);
  const plural = findMarkers(tokens, PLURAL_MARKERS);

  const out: LintViolation[] = [];

  // (a) mixing masculine + feminine singular address = block
  if (masc.length > 0 && fem.length > 0) {
    const second = masc[0].index > fem[0].index ? masc[0] : fem[0];
    out.push({
      rule:     'gender_mix',
      severity: 'block',
      message:  `ערבוב פנייה בזכר ובנקבה באותו טקסט: "${masc[0].matched}" לצד "${fem[0].matched}" — לעולם לא מחליפים צורת פנייה באמצע (copywriting-craft §5)`,
      excerpt:  excerptAround(content, second.index),
      index:    second.index,
    });
    // Already blocked for mixing — a mismatch flag on top would double-punish
    // the same root cause.
    return out;
  }

  // (b) consistent-but-mismatched address vs the declared audience
  const g = spec.address.gender;
  const mismatch: MarkerHit | null =
    g === 'male'   && fem.length    > 0 ? fem[0]  :
    g === 'female' && masc.length   > 0 ? masc[0] :
    g === 'plural' && masc.length   > 0 ? masc[0] :
    g === 'plural' && fem.length    > 0 ? fem[0]  :
    null;

  if (mismatch) {
    out.push({
      rule:     'gender_address_mismatch',
      severity: 'flag',
      message:  `הפנייה בטקסט ("${mismatch.matched}") אינה תואמת את מגדר הפנייה המוגדר למותג (${g})`,
      excerpt:  excerptAround(content, mismatch.index),
      index:    mismatch.index,
    });
  }
  return out;
}

// ── rule: Meta policy safety ──────────────────────────────────────────────────

// Personal-attribute callout patterns → BLOCK. WHY (copywriting-craft §7,
// media-buying B21): Meta's personal-attributes policy forbids copy that
// asserts or implies knowledge of the READER's health, weight, financial
// state, age or condition ("סובלים מהשמנה?" → policy strike). A strike hurts
// the WHOLE account's auction standing, not just the ad — so this is a hard
// block, and the fix is always the same reframe: describe the SITUATION, not
// the person ("יש פתרון להשמנה" is safe). Patterns end with a
// no-following-Hebrew-letter lookahead where a ך/כם suffix carries the match.
interface PolicyPattern { re: RegExp; label: string }

const NOT_LETTER = '(?![\\u05D0-\\u05EA])';

const PERSONAL_ATTRIBUTE_PATTERNS: readonly PolicyPattern[] = [
  // "Do you suffer from…" — asserts the reader HAS the condition (health/state).
  { re: new RegExp(`סובל(?:ת|ים|ות)?\\s+מ`, 'u'), label: 'פנייה ישירה למצב אישי ("סובלים מ…")' },
  // "You have debts/overdraft" — asserts the reader's financial state.
  { re: new RegExp(`יש\\s+ל(?:ך|כם|כן)${NOT_LETTER}\\s+(?:חוב|חובות|מינוס|אוברדראפט|הלוואות)`, 'u'), label: 'ייחוס מצב פיננסי אישי' },
  // "You have excess weight / a problem / pain" — asserts a personal condition.
  { re: new RegExp(`יש\\s+ל(?:ך|כם|כן)${NOT_LETTER}\\s+(?:עודף\\s+משקל|השמנה|בעיה|בעיית|כאב|כאבי)`, 'u'), label: 'ייחוס מצב גופני/אישי' },
  // "Your weight" — direct weight attribution.
  { re: new RegExp(`המשקל\\s+של(?:ך|כם|כן)${NOT_LETTER}`, 'u'), label: 'התייחסות ישירה למשקל הקורא' },
  // "You are fat" — direct appearance callout.
  { re: new RegExp(`את(?:ה)?\\s+שמנ(?:ה|ים|ות)?${NOT_LETTER}`, 'u'), label: 'הערה ישירה על מראה/משקל' },
  // "At your age…" — age attribution.
  { re: new RegExp(`בגיל(?:ך|כם)${NOT_LETTER}|בגיל\\s+של(?:ך|כם)${NOT_LETTER}`, 'u'), label: 'התייחסות ישירה לגיל הקורא' },
  // "Your debts / your overdraft" — financial attribution.
  { re: new RegExp(`(?:החובות|המינוס|האוברדראפט|ההלוואות)\\s+של(?:ך|כם|כן)${NOT_LETTER}`, 'u'), label: 'ייחוס חובות/מצב פיננסי' },
  // "Your wrinkles / acne / cellulite / thinning hair" — appearance attribution.
  { re: new RegExp(`(?:הקמטים|האקנה|הצלוליט|השיער\\s+הדליל)\\s+של(?:ך|כם|כן)${NOT_LETTER}`, 'u'), label: 'ייחוס מאפיין מראה אישי' },
  // "Your depression / anxiety" — mental-health attribution.
  { re: new RegExp(`(?:הדיכאון|החרדה|החרדות)\\s+של(?:ך|כם|כן)${NOT_LETTER}`, 'u'), label: 'ייחוס מצב נפשי' },
  // "Your diabetes / illness / cholesterol" — medical-condition attribution.
  { re: new RegExp(`(?:הסוכרת|המחלה|הכולסטרול|הלחץ\\s+דם)\\s+של(?:ך|כם|כן)${NOT_LETTER}`, 'u'), label: 'ייחוס מצב רפואי' },
  // "Struggling to conceive / lose weight" — implies the reader's condition.
  { re: new RegExp(`מתקש(?:ה|ים|ות)\\s+ל(?:הרות|היכנס\\s+להריון|רדת\\s+במשקל)`, 'u'), label: 'ייחוס קושי אישי (פוריות/משקל)' },
  // "Tired of your weight/debts/pain" — frustration framed on the reader's attribute.
  { re: new RegExp(`נמאס\\s+ל(?:ך|כם|כן)${NOT_LETTER}\\s+מה(?:משקל|חובות|כאבים|מינוס)`, 'u'), label: 'תסכול ממאפיין אישי של הקורא' },
];

// Unsubstantiated absolute-outcome claims → FLAG. WHY (copywriting-craft §7:
// "no unrealistic promises"; §4: claims without proof get weakened, and §5:
// Israeli skepticism auto-discounts superlatives — anything smelling of
// קומבינה poisons the ad). מובטח/לצמיתות are inherently outcome promises;
// "100%" flags only when its sentence contains an outcome word, so "100%
// כותנה" (a composition fact) passes.
const ABSOLUTE_ALWAYS: readonly PolicyPattern[] = [
  { re: new RegExp(`מובטח(?:ת|ים|ות)?${NOT_LETTER}`, 'u'), label: 'הבטחת תוצאה ("מובטח")' },
  { re: new RegExp(`לצמיתות${NOT_LETTER}`, 'u'), label: 'הבטחת קבע ("לצמיתות")' },
];

const OUTCOME_WORDS: readonly string[] = [
  'תוצאה', 'תוצאות', 'הצלחה', 'ירידה', 'רווח', 'ריפוי', 'שיפור', 'החזר', 'הבטחה', 'פתרון',
];

/**
 * Meta policy safety — the account-standing shield (copywriting-craft §7,
 * media-buying B21). Personal-attribute callouts BLOCK; absolute outcome
 * claims FLAG. See the pattern tables above for the per-pattern rationale.
 */
export function metaPolicySafety(content: string, _spec: BrandVoiceSpec): LintViolation[] {
  const out: LintViolation[] = [];

  for (const { re, label } of PERSONAL_ATTRIBUTE_PATTERNS) {
    const m = re.exec(content);
    if (m) {
      out.push({
        rule:     'meta_personal_attribute',
        severity: 'block',
        message:  `סיכון מדיניות Meta — ${label}: ניסוח שמייחס תכונה אישית לקורא עלול לגרור policy strike שפוגע בכל החשבון. נסחו מחדש סביב המצב, לא סביב האדם`,
        excerpt:  excerptAround(content, m.index),
        index:    m.index,
      });
    }
  }

  for (const { re, label } of ABSOLUTE_ALWAYS) {
    const m = re.exec(content);
    if (m) {
      out.push({
        rule:     'meta_absolute_claim',
        severity: 'flag',
        message:  `טענה מוחלטת ללא ביסוס — ${label}: טענה בלי הוכחה נחלשת או נמחקת (copywriting-craft §4/§7)`,
        excerpt:  excerptAround(content, m.index),
        index:    m.index,
      });
    }
  }

  // "100%" — only in outcome context (sentence-level co-occurrence heuristic).
  for (const sentence of splitSentences(content)) {
    const idx = sentence.text.indexOf('100%');
    if (idx < 0) continue;
    if (OUTCOME_WORDS.some((w) => sentence.text.includes(w))) {
      out.push({
        rule:     'meta_absolute_claim',
        severity: 'flag',
        message:  'טענה מוחלטת ללא ביסוס — "100%" בהקשר של תוצאה (copywriting-craft §4/§7)',
        excerpt:  excerptAround(content, sentence.index + idx),
        index:    sentence.index + idx,
      });
    }
  }

  return out;
}

interface Sentence { text: string; index: number }

function splitSentences(content: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  for (let i = 0; i <= content.length; i++) {
    const ch = i < content.length ? content[i] : '\n';
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n' || i === content.length) {
      const text = content.slice(start, i);
      if (text.trim().length > 0) out.push({ text, index: start });
      start = i + 1;
    }
  }
  return out;
}

// ── scoring + the rule roster ─────────────────────────────────────────────────

/** Spec C-07 scoring: 100 − 25 per block − 5 per flag, floored at 0. */
export function computeScore(violations: readonly LintViolation[]): number {
  let score = 100;
  for (const v of violations) score -= v.severity === 'block' ? 25 : 5;
  return Math.max(0, score);
}

/** The deterministic pass, in fixed order (lint.ts runs exactly this roster). */
export const DETERMINISTIC_RULES: readonly LintRule[] = [
  tabooWords,
  loadedWords,
  emojiPolicy,
  genderAddressConsistency,
  metaPolicySafety,
];
