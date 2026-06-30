// lib/brief-v2.ts
//
// Brief v2 — shared, framework-agnostic vocabulary + validation for the
// owner-language "Group A" questions. Imported by BOTH the client questionnaire
// (app/brief/BriefQuestionnaire.tsx) and the server submit route
// (app/api/briefs/submit/route.ts) so the required-satisfaction rule can never
// drift between the UI gate and the server gate.
//
// Group A = REQUIRED owner-language questions (5 required + 1 optional `own_proof`).
// Group B = the existing Hormozi×Schwartz "pro" questions (now optional, collapsed).
//
// No schema change: every answer (including the "unsure" escape) is stored as a
// plain value inside the existing `briefs.values` jsonb.

/**
 * Sentinel stored in `values[key]` when the owner deliberately clicks the
 * "לא בטוח / לא יודע" escape. It satisfies the required-question gate but marks
 * the answer so the analyzer can infer cautiously at a lower confidence.
 */
export const UNSURE_SENTINEL = '__unsure__';

/** Minimum trimmed length for a free-text answer to satisfy a required question. */
export const MIN_ANSWER_LEN = 10;

export interface OwnerQuestion {
  id:       string;
  /** Hebrew label / question text. */
  label:    string;
  /** Hebrew helper text shown under the label. */
  help:     string;
  required: boolean;
}

/**
 * Group A — "שאלות לבעל העסק" (owner language). Order is the display order.
 * 5 required + `own_proof` (optional, never blocks submit).
 */
export const GROUP_A_QUESTIONS: OwnerQuestion[] = [
  {
    id: 'own_about',
    label: 'ספר על העסק שלך כאילו אתה מספר לחבר — מה אתה עושה, ולמי?',
    help: 'בלי ז\'רגון שיווקי. פשוט כמו שהיית מסביר לחבר טוב על קפה.',
    required: true,
  },
  {
    id: 'own_differentiator',
    label: 'מה אתה עושה שאחרים בתחום שלך לא עושים?',
    help: 'מה הלקוחות אומרים שמיוחד אצלך? למה הם בוחרים דווקא בך?',
    required: true,
  },
  {
    id: 'own_cost_of_no',
    label: 'אם לקוח היה בוחר לא לקנות ממך — מה הוא היה מפסיד?',
    help: 'מה המחיר האמיתי של לא לפעול — בכסף, בזמן, בתסכול, בהזדמנות שעוברת.',
    required: true,
  },
  {
    id: 'own_happy_customer',
    label: 'מי הלקוח הכי מרוצה שלך — ומה הוא קיבל ממך?',
    help: 'תאר לקוח אמיתי אחד: מי הוא, מה היה המצב שלו, ומה השתנה אצלו.',
    required: true,
  },
  {
    id: 'own_unspoken_need',
    label: 'מה לקוחות שלך צריכים — אבל לא יודעים לבקש?',
    help: 'מה הם באמת מחפשים מתחת לפני השטח, גם אם הם לא מנסחים את זה ככה.',
    required: true,
  },
  {
    id: 'own_proof',
    label: 'ספר על מקרה שבו עזרת ללקוח — מה היה לפני ומה אחרי?',
    help: 'סיפור הצלחה קונקרטי אחד. אופציונלי — אבל מאוד עוזר לנו.',
    required: false,
  },
];

/** The 5 required Group-A keys that gate submit. */
export const REQUIRED_OWNER_KEYS: string[] = GROUP_A_QUESTIONS.filter((q) => q.required).map((q) => q.id);

/** Is the value the deliberate "unsure" escape (string sentinel or `{ unsure: true }`)? */
export function isUnsure(value: unknown): boolean {
  if (value === UNSURE_SENTINEL) return true;
  return typeof value === 'object' && value !== null && (value as { unsure?: unknown }).unsure === true;
}

/**
 * A REQUIRED question is satisfied iff the answer is a real text answer
 * (trimmed length ≥ MIN_ANSWER_LEN) OR the unsure-escape is active.
 */
export function isRequiredSatisfied(value: unknown): boolean {
  if (isUnsure(value)) return true;
  return typeof value === 'string' && value.trim().length >= MIN_ANSWER_LEN;
}

/** How many of the 5 required Group-A questions are satisfied. */
export function countSatisfiedRequired(values: Record<string, unknown> | null | undefined): number {
  if (!values) return 0;
  return REQUIRED_OWNER_KEYS.reduce((n, k) => (isRequiredSatisfied(values[k]) ? n + 1 : n), 0);
}

/** All 5 required Group-A questions satisfied → submit allowed. */
export function allRequiredSatisfied(values: Record<string, unknown> | null | undefined): boolean {
  return countSatisfiedRequired(values) === REQUIRED_OWNER_KEYS.length;
}
