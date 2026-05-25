/**
 * Marketing frameworks for richer avatar generation.
 *
 * Each framework returns a structured prompt fragment that guides the LLM
 * to produce specific kinds of customer insight.
 */

export type FrameworkKey =
  | 'jobs_to_be_done'
  | 'awareness_levels'
  | 'sophistication_levels'
  | 'pain_pleasure'
  | 'voice_of_customer';

export interface Framework {
  key:            FrameworkKey;
  name:           string;
  hebrewName:     string;
  description:    string;
  promptFragment: string;
}

export const FRAMEWORKS: Record<FrameworkKey, Framework> = {
  jobs_to_be_done: {
    key:        'jobs_to_be_done',
    name:       'Jobs-to-be-Done',
    hebrewName: 'משימות שהלקוח שוכר את המוצר לבצע',
    description: "Clayton Christensen's JTBD — what 'job' does the customer hire the product to do?",
    promptFragment: `
Use the Jobs-to-be-Done framework to identify:
1. Functional job: the practical task being accomplished
2. Emotional job: how the customer wants to FEEL during/after
3. Social job: how the customer wants to be PERCEIVED by others
4. The current "old hire" being replaced (status quo, competitor, or workaround)
5. Three "anxieties" that prevent switching, and three "habits" that reinforce status quo
`.trim(),
  },

  awareness_levels: {
    key:        'awareness_levels',
    name:       'Eugene Schwartz Awareness Levels',
    hebrewName: 'רמות מודעות של יוג׳ין שוורץ',
    description: 'Map the audience to one of 5 awareness levels (unaware → most aware).',
    promptFragment: `
Place this audience on Eugene Schwartz's 5 awareness levels:
- Unaware:        doesn't know they have the problem
- Problem-aware:  feels the pain but doesn't know solutions exist
- Solution-aware: knows solutions exist, doesn't know specific products
- Product-aware:  knows about the product, hasn't bought
- Most-aware:     knows the product, ready to buy with right offer

Identify the dominant level AND the messaging strategy required for that level
(story-led, problem-amplification, solution-comparison, product-benefit, or offer-led).
`.trim(),
  },

  sophistication_levels: {
    key:        'sophistication_levels',
    name:       'Market Sophistication',
    hebrewName: 'רמת תחכום השוק',
    description: "Schwartz's 5 stages of market sophistication.",
    promptFragment: `
Identify market sophistication level (1-5):
1. First to market — simple direct claim works
2. Competitors emerge — amplify the claim with bigger promises
3. Audience tired of claims — introduce a unique mechanism
4. Mechanism saturated — elaborate the mechanism with new specifics
5. Audience cynical — shift to identity/lifestyle/movement positioning

Recommend the angle required for THIS sophistication level.
`.trim(),
  },

  pain_pleasure: {
    key:        'pain_pleasure',
    name:       'Pain-Pleasure Map',
    hebrewName: 'מפת כאב-עונג',
    description: 'Specific pains avoided and pleasures sought.',
    promptFragment: `
List with vivid specificity:
- 5 PAINS the customer is currently feeling (use first-person internal language: "I hate that...", "I'm tired of...")
- 5 DESIRED OUTCOMES (sensory, specific: not "success" but "checking my phone Monday morning and seeing 3 new leads")
- 3 FEARS they have about choosing wrong
- 3 STATUS gains they're seeking
Use the customer's actual vocabulary, not marketing language.
`.trim(),
  },

  voice_of_customer: {
    key:        'voice_of_customer',
    name:       'Voice of Customer',
    hebrewName: 'קול הלקוח',
    description: 'Real phrases the customer would say verbatim.',
    promptFragment: `
Generate 8-12 verbatim quotes the customer would SAY (not write), each in first person.
Mix:
- Frustrations    ("I've tried X and it just...")
- Aspirations     ("If I could just...")
- Skepticism      ("I bet this is another...")
- Decision criteria ("It has to be...")
- Identity statements ("I'm the kind of person who...")
Use natural spoken language, contractions, slang where appropriate.
For Hebrew audiences, use idiomatic Hebrew with the actual register the persona would use.
`.trim(),
  },
};

export function getFrameworksForAvatar(keys: FrameworkKey[]): Framework[] {
  return keys.map((k) => FRAMEWORKS[k]).filter(Boolean);
}

export function buildFrameworkSection(keys: FrameworkKey[]): string {
  const fws = getFrameworksForAvatar(keys);
  if (!fws.length) return '';

  return `\n## Required Frameworks\n\nApply each of the following frameworks in your output:\n\n${fws
    .map((f, i) => `### ${i + 1}. ${f.name}\n${f.promptFragment}`)
    .join('\n\n')}\n`;
}

export const DEFAULT_FRAMEWORK_SET: FrameworkKey[] = [
  'jobs_to_be_done',
  'awareness_levels',
  'pain_pleasure',
  'voice_of_customer',
];
