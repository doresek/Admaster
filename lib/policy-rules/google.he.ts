// Google Ads policy patterns (Hebrew). Each rule emits a policy_flags entry.
// Source: support.google.com/adspolicy — interpreted into Hebrew regex patterns.

import type { PolicyFlag } from './meta.he';

type Rule = { id: string; pattern: RegExp; severity: PolicyFlag['severity']; issue: string };

const RULES: Rule[] = [
  {
    id: 'excessive_punctuation',
    pattern: /[!]{3,}|[?]{3,}/,
    severity: 'warn',
    issue: 'Google Ads מגביל שימוש מוגזם בסימני קריאה/שאלה',
  },
  {
    id: 'trademark_risk',
    pattern: /\b(iPhone|iPad|Apple|Google|Microsoft|Samsung|Nike|Adidas)\b/,
    severity: 'warn',
    issue: 'שימוש בשם מותג מסחרי דורש אישור בעלים',
  },
  {
    id: 'misleading_claim',
    pattern: /\b(מספר\s*1\s*בארץ|הטוב\s*ביותר\s*במדינה)\b/,
    severity: 'warn',
    issue: 'טענות "מספר 1" דורשות הוכחה ציבורית',
  },
  {
    id: 'click_bait_punctuation',
    pattern: /\b(לחצו\s+(כאן|עכשיו)|לא\s+תאמינו)\b/,
    severity: 'info',
    issue: 'ניסוח clickbait — Google עלול להוריד את ציון הרלוונטיות',
  },
];

export function matchGooglePolicy(copy: string): PolicyFlag[] {
  const out: PolicyFlag[] = [];
  for (const r of RULES) {
    if (r.pattern.test(copy)) {
      out.push({ type: r.id, severity: r.severity, issue: r.issue });
    }
  }
  return out;
}
