// Meta ad policy patterns (Hebrew). Each rule emits a policy_flags entry.
// Source: facebook.com/business/help — interpreted into Hebrew regex patterns.

export type PolicyFlag = {
  type:     string;
  severity: 'info' | 'warn' | 'block';
  issue:    string;
};

type Rule = { id: string; pattern: RegExp; severity: PolicyFlag['severity']; issue: string };

const RULES: Rule[] = [
  {
    id: 'performance_guarantee',
    pattern: /\b(100\s*אחוז|100%)\s*(הצלחה|מובטח|תוצאה)/,
    severity: 'block',
    issue: 'Meta אוסר על הבטחות הצלחה של 100%',
  },
  {
    id: 'before_after_body',
    pattern: /(לפני\s*ואחרי|before\s*&?\s*after).*(\d+\s*ק"?ג|\d+\s*קילו|\d+\s*kg)/i,
    severity: 'block',
    issue: 'Meta אוסר על תמונות/טענות לפני-ואחרי הקשורות למשקל גוף',
  },
  {
    id: 'personal_attribute',
    pattern: /\bאתה\s+(שמן|גזעני|הומו|דתי|נכה|חולה)\b/,
    severity: 'block',
    issue: 'Meta אוסר על פנייה ישירה לתכונה אישית רגישה',
  },
  {
    id: 'medical_claim_strong',
    pattern: /\b(מרפא|ריפוי|תרופה|מסיר\s+(כאב|מחלה))\b/,
    severity: 'warn',
    issue: 'טענות רפואיות חזקות דורשות אישור מיוחד; מומלץ לרכך',
  },
  {
    id: 'crypto_get_rich',
    pattern: /\b(להתעשר|רווח\s*מובטח|תשואה\s*של\s*\d+%)/,
    severity: 'block',
    issue: 'Meta אוסר על הבטחות התעשרות מהירה / תשואה מובטחת',
  },
  {
    id: 'shocking_imagery_text',
    pattern: /\b(זוועה|תמותה|דם|אסון)\b/,
    severity: 'warn',
    issue: 'שפה מזעזעת עלולה לפסול את המודעה',
  },
];

export function matchMetaPolicy(copy: string): PolicyFlag[] {
  const out: PolicyFlag[] = [];
  for (const r of RULES) {
    if (r.pattern.test(copy)) {
      out.push({ type: r.id, severity: r.severity, issue: r.issue });
    }
  }
  return out;
}
