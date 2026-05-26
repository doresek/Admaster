# Master Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `/create` so a single click infers an audience avatar, auto-picks a master marketer from a curated corpus of 12, and generates the post in that marketer's voice — with a reveal panel showing avatar / marketer / principles.

**Architecture:** Single AI call (Claude Sonnet 4.6) with a layered prompt: role → 12-marketer corpus → priority Master Notes → output contract. Response is parsed via tag extraction into `{ avatar, marketer, why, principles, post, hashtags, image, tips, whatsapp }`. UI gets a new "🧠 Why this works" reveal panel above the existing tabs. No DB migration — metadata persists via `generated_content.meta` (jsonb) that already exists. Tests rely on `npm run type-check` + manual QA (project has no unit-test infra yet).

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, Supabase, Anthropic SDK (`@anthropic-ai/sdk`).

**Spec:** `docs/superpowers/specs/2026-05-27-master-studio-design.md`

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `lib/marketers.ts` | **CREATE** | The 12 marketer records (corpus) + helpers. |
| `lib/master-studio.ts` | **CREATE** | `composeMasterPrompt()` + `parseMasterResponse()`. |
| `types/index.ts` | MODIFY | Add `'master_post'` to `CreditAction` & `CREDIT_COSTS = 4`. |
| `app/api/ai/route.ts` | MODIFY | Read `maxTokens` from body so caller controls it (already does). No structural change — verify behavior. |
| `app/(dashboard)/create/page.tsx` | MODIFY | New state, Master Notes textarea, Override section, Why-this-works reveal panel, switch action to `'master_post'`. |

Existing `lib/hooks/useAI.ts` is **not** modified — its signature already supports new actions via the `action` string.

---

## Task 1: Marketers corpus

**Files:**
- Create: `lib/marketers.ts`

- [ ] **Step 1: Create `lib/marketers.ts` with the 12 records**

```ts
// ════════════════════════════════════════════
// 12 Master Marketers — corpus for /create
// Each record feeds the system prompt. Keep
// each block tight (~200 tokens) to stay
// within budget — short, scannable bullets.
// ════════════════════════════════════════════

import type { FrameworkId } from './frameworks';

export type MarketerId =
  | 'schwartz' | 'ogilvy' | 'hopkins' | 'halbert' | 'caples'
  | 'sugarman' | 'kennedy' | 'brunson' | 'hormozi' | 'carlton'
  | 'bencivenga' | 'cialdini';

export interface Marketer {
  id:                 MarketerId;
  name:               string;
  era:                string;
  emoji:              string;
  archetype:          string;
  best_for:           string[];
  framework_default:  FrameworkId;
  principles:         string[];      // 5-7 tight bullets
  signature_moves:    string[];      // 3-5 distinctive moves
  examples: { headline: string; why_it_works: string }[]; // 2-3
  voice_notes:        string;
}

export const MARKETERS: Marketer[] = [
  {
    id: 'schwartz',
    name: 'Eugene Schwartz',
    era: '1956 — Breakthrough Advertising',
    emoji: '🏛',
    archetype: 'Master of Awareness Levels',
    best_for: ['info products', 'cold traffic', 'long-form sales pages'],
    framework_default: 'aicpbsawn',
    principles: [
      '5 levels of awareness drive every word choice',
      'Match the message to where the prospect already is',
      'Mass desire — never create demand, channel it',
      'Specificity > superlatives ("3 ways" beats "best")',
      'Headline carries 80% of the work',
    ],
    signature_moves: [
      'Open at the prospect\'s current belief, not your product',
      'Bridge from problem-aware to solution-aware in 2-3 lines',
      'Layer proof in escalating intensity',
    ],
    examples: [
      { headline: 'Give Me 15 Minutes and I\'ll Give You a Super-Power Memory',
        why_it_works: 'Specific time + specific outcome + curiosity gap' },
      { headline: 'Now! A wonderful new way to cure baldness — without drugs',
        why_it_works: '"Now" = urgency; "without drugs" = risk reversal embedded in headline' },
    ],
    voice_notes: 'Clinical clarity, no fluff. Heavy on numbers and verifiable claims.',
  },
  {
    id: 'ogilvy',
    name: 'David Ogilvy',
    era: '1963 — Confessions of an Advertising Man',
    emoji: '🎩',
    archetype: 'Brand-builder with a researcher\'s eye',
    best_for: ['premium brands', 'long-form ads', 'trust-building'],
    framework_default: 'fab',
    principles: [
      'Facts sell — research before writing',
      'Headline is 5× more important than body copy',
      'Specifics beat adjectives every time',
      'The consumer is not a moron; she is your wife',
      'If it doesn\'t sell, it isn\'t creative',
    ],
    signature_moves: [
      'Lead with a surprising, true factual claim',
      'Use long body copy when product is considered',
      'Story-driven headlines that earn the second line',
    ],
    examples: [
      { headline: 'At 60 miles an hour the loudest noise in this new Rolls-Royce comes from the electric clock',
        why_it_works: 'Concrete sensory detail = proof of luxury without saying "luxury"' },
      { headline: 'How to create advertising that sells',
        why_it_works: 'Promises useful instruction; reader self-qualifies' },
    ],
    voice_notes: 'Refined, evidence-led, never shouts. Tells the reader something they did not know.',
  },
  {
    id: 'hopkins',
    name: 'Claude Hopkins',
    era: '1923 — Scientific Advertising',
    emoji: '🧪',
    archetype: 'Father of scientific, testable advertising',
    best_for: ['direct-response', 'mass-market products', 'measurable campaigns'],
    framework_default: 'aida',
    principles: [
      'Every ad must justify its cost — track or die',
      'Headline must select the right reader and reject the wrong one',
      '"Reason-why" copy: tell them precisely why',
      'Show the process — demystified products convert',
      'Samples and trials lower the wall',
    ],
    signature_moves: [
      'Couponed offers — every dollar attributed',
      'Demonstrate the manufacturing/quality story',
      'Plain talk over clever talk',
    ],
    examples: [
      { headline: 'Schlitz — the beer that made Milwaukee famous',
        why_it_works: 'Made Schlitz #1 by explaining standard brewing process competitors all used but never told' },
      { headline: 'Pepsodent — removes that film',
        why_it_works: 'Names a specific enemy ("film") — gives the brain something to fight' },
    ],
    voice_notes: 'Plain, almost dry. Process-revealing. Always justifies the claim.',
  },
  {
    id: 'halbert',
    name: 'Gary Halbert',
    era: '1980s — The Boron Letters',
    emoji: '📬',
    archetype: 'Direct-mail king, story-led persuader',
    best_for: ['emails', 'sales letters', 'high-intensity offers'],
    framework_default: 'aida',
    principles: [
      'A starving crowd > clever copy',
      'Lead with story, sell with logic, close with urgency',
      'Specific > generic ("$2,463" beats "thousands")',
      'Curiosity gap on every line — earn the next line',
      'Talk like a real human, not a brochure',
    ],
    signature_moves: [
      'Long personal-style opening that pulls reader in',
      '"P.S." that re-stakes the offer and adds urgency',
      'Frequent first-person admissions ("I almost gave up")',
    ],
    examples: [
      { headline: 'The Amazing Coat-of-Arms Letter (sold $7M of family crest reports)',
        why_it_works: 'Personalized + curiosity + low-cost offer to a starving identity-tribe' },
      { headline: 'How to Get Rich in Mail Order',
        why_it_works: 'Promise + clear vehicle + implied "I did it, so can you"' },
    ],
    voice_notes: 'Brash, conversational, profane when it serves the point. First-person.',
  },
  {
    id: 'caples',
    name: 'John Caples',
    era: '1932 — Tested Advertising Methods',
    emoji: '✍️',
    archetype: 'Headline master, testing fanatic',
    best_for: ['direct-response headlines', 'classified-style ads', 'split-tests'],
    framework_default: 'aida',
    principles: [
      'The right headline can multiply response 20×',
      'Self-interest, news, curiosity — pick at least two',
      'Test every claim against a control',
      '"How to" + benefit + audience qualifier',
      'Specific numbers beat round ones',
    ],
    signature_moves: [
      '"They Laughed When I Sat Down at the Piano — But When I Started to Play!"',
      'Story-style headline that creates immediate scene',
      'Open question that targets a felt anxiety',
    ],
    examples: [
      { headline: 'They Laughed When I Sat Down at the Piano',
        why_it_works: 'Sets up social humiliation + reversal = irresistible curiosity' },
      { headline: 'How a New Discovery Made a Plain Girl Beautiful',
        why_it_works: 'Promise + curiosity + identity-shift in 9 words' },
    ],
    voice_notes: 'Scene-builder. Builds immediate human conflict in the first 8 words.',
  },
  {
    id: 'sugarman',
    name: 'Joseph Sugarman',
    era: '1998 — The Adweek Copywriting Handbook',
    emoji: '🕶',
    archetype: 'Psychological-triggers maestro',
    best_for: ['product launches', 'gadget/lifestyle copy', 'high-AOV ecommerce'],
    framework_default: 'aida',
    principles: [
      'The only purpose of the first sentence is to make them read the second',
      'Slippery slope: every line earns the next',
      '30+ psychological triggers (involvement, scarcity, etc.)',
      'Storytelling sells — but story must serve the product',
      'Objections handled mid-copy, not at the end',
    ],
    signature_moves: [
      'Tiny opening line ("Lose weight.")',
      'Conversational asides that build rapport mid-pitch',
      'Pre-empt objections inside the narrative',
    ],
    examples: [
      { headline: 'BluBlocker — the sunglasses that changed your vision forever',
        why_it_works: 'Bold claim + visual demonstration + scarcity ("changed forever")' },
    ],
    voice_notes: 'Conversational, intimate, builds momentum. Reads like a friend selling you on something.',
  },
  {
    id: 'kennedy',
    name: 'Dan Kennedy',
    era: '1990s+ — Magnetic Marketing',
    emoji: '🧲',
    archetype: 'No-BS Direct Response',
    best_for: ['B2B services', 'coaching', 'aggressive promos'],
    framework_default: 'pas',
    principles: [
      'Message-Market-Media match before tactics',
      'Pain > pleasure as a buying motivator',
      'Deadline + scarcity in every offer',
      'Repulsion marketing — repel wrong fits explicitly',
      'Premium pricing as positioning',
    ],
    signature_moves: [
      'Use takeaway: "This is NOT for everyone"',
      'Hard deadline with consequence ("after Friday, $200 more")',
      'Frame buying as a status decision, not a price decision',
    ],
    examples: [
      { headline: 'WARNING: If You Are An Average Business Owner — Do NOT Read This',
        why_it_works: 'Repels low-fit, attracts premium prospects via reverse-qualification' },
    ],
    voice_notes: 'Blunt, confrontational, premium-positioned. Treats the reader as a serious operator.',
  },
  {
    id: 'brunson',
    name: 'Russell Brunson',
    era: '2017+ — Expert Secrets / DotCom Secrets',
    emoji: '🚀',
    archetype: 'Funnel-storytelling architect',
    best_for: ['info products', 'webinars', 'multi-step funnels'],
    framework_default: 'story',
    principles: [
      'Hook → Story → Offer (HSO) on every page',
      'Epiphany Bridge — convert via your own "aha" moment',
      'New opportunity beats improvement offer',
      'Stack of micro-commitments before the ask',
      'Future-pace the buyer: paint life after',
    ],
    signature_moves: [
      'Origin story with vulnerable failure → discovery → success',
      '"Stack slide" of bonuses with anchored values',
      'Identity sale: "people like me do X"',
    ],
    examples: [
      { headline: '7 Years Ago, I Was Broke In My Basement. Then I Discovered This One Thing…',
        why_it_works: 'Origin + curiosity gap + implied transformation' },
    ],
    voice_notes: 'Energetic, story-led, builds identity tribes. Slightly bombastic but earnest.',
  },
  {
    id: 'hormozi',
    name: 'Alex Hormozi',
    era: '2020+ — $100M Offers',
    emoji: '🔥',
    archetype: 'Value-stack arithmetic',
    best_for: ['high-ticket', 'lead-gen offers', 'cold-traffic conversion'],
    framework_default: 'fourps',
    principles: [
      'Value Equation: (Dream Outcome × Likelihood) / (Time × Effort)',
      'Specificity always — "$3,000 in 30 days" not "more money"',
      'Stack value until price feels insulting to NOT buy',
      'Risk reversal: "If it doesn\'t work, I pay you"',
      'Urgency + scarcity = real deadlines, not fake',
    ],
    signature_moves: [
      'Itemized bonus stack with anchored values',
      'Reverse-risk guarantee that puts skin in seller\'s game',
      'Hook formulas: "How [target] can [outcome] without [pain]"',
    ],
    examples: [
      { headline: 'How Gym Owners Can Get 30 New Members in 30 Days — Or I Refund Double',
        why_it_works: 'Specific + risk reversal stronger than industry norm' },
    ],
    voice_notes: 'Direct, numbers-heavy, mildly aggressive. No hedging — claims are absolute.',
  },
  {
    id: 'carlton',
    name: 'John Carlton',
    era: '1990s+ — Kick-Ass Copywriting',
    emoji: '🤠',
    archetype: 'Street-smart conversational closer',
    best_for: ['high-emotion offers', 'underdog brands', 'long sales letters'],
    framework_default: 'pas',
    principles: [
      'Sell like you\'re talking to your best friend in a bar',
      'Hook with embarrassment, anger, or hidden desire',
      'Storyselling — every claim wrapped in a vivid scene',
      'Honesty about flaws builds trust',
      'Always be moving the reader\'s emotional state',
    ],
    signature_moves: [
      'Vivid sensory opener ("It was 2am, I was sweating bullets…")',
      'Direct accusation/challenge to the reader',
      'Sudden plot twist mid-copy',
    ],
    examples: [
      { headline: 'Amazing Secret Discovered By One-Legged Golfer Adds 50 Yards To Your Drives',
        why_it_works: 'Pattern interrupt (one-legged) + specific outcome + curiosity gap' },
    ],
    voice_notes: 'Loose, profane-adjacent, deeply human. Sounds like a guy who has been around.',
  },
  {
    id: 'bencivenga',
    name: 'Gary Bencivenga',
    era: '1980s-2000s — Bencivenga Bullets',
    emoji: '🛡',
    archetype: 'Believability champion',
    best_for: ['skeptical audiences', 'health/finance offers', 'long-form sales'],
    framework_default: 'quest',
    principles: [
      'Believability is the great divider — if it sounds too good, prove it',
      'Sell exclusivity through expertise, not hype',
      'Bullets, bullets, bullets — give curiosity to scanners',
      'Anticipate every objection and answer in copy',
      'Borrow credibility from authorities/sources',
    ],
    signature_moves: [
      'Open with a credibility credential up-front',
      '"Fascination" bullets — partial reveals that demand the body copy',
      'Cite specific authorities/sources by name',
    ],
    examples: [
      { headline: 'Read This Or Die — The 14 Worst Things You Can Eat',
        why_it_works: 'High stakes + specific number + implied authority' },
    ],
    voice_notes: 'Measured, authoritative, evidence-saturated. Reads like a respected expert briefing you.',
  },
  {
    id: 'cialdini',
    name: 'Robert Cialdini',
    era: '1984 — Influence',
    emoji: '🧠',
    archetype: 'Behavioral-science codifier',
    best_for: ['behavioral nudges', 'persuasion frameworks', 'trust-building copy'],
    framework_default: 'bab',
    principles: [
      '6 universals: Reciprocity, Commitment, Social Proof, Liking, Authority, Scarcity',
      'Pre-suasion — what comes before the ask shapes the answer',
      'Unity: "we" framings outperform "you" in tribes',
      'Contrast principle anchors perception',
      'Reasons-why activate compliance ("because…")',
    ],
    signature_moves: [
      'Layer 2-3 universals in one message',
      'Pre-suade with a question that primes the desired frame',
      'Use authentic social proof with named specifics',
    ],
    examples: [
      { headline: 'Join the 47,000+ founders who get our weekly briefing',
        why_it_works: 'Social proof (specific number) + identity unity ("founders")' },
    ],
    voice_notes: 'Calm, observational, grounded in research. Frames persuasion as ethics.',
  },
];

export const MARKETERS_BY_ID: Record<MarketerId, Marketer> =
  MARKETERS.reduce((acc, m) => { acc[m.id] = m; return acc; }, {} as Record<MarketerId, Marketer>);

/**
 * Compact one-marketer block for the system prompt. ~200 tokens each.
 */
export function marketerToPromptBlock(m: Marketer): string {
  return `── ${m.emoji} ${m.name} (${m.id}) ──
ארכיטיפ: ${m.archetype}
תקופה: ${m.era}
הכי טוב ל: ${m.best_for.join(', ')}
framework מועדף: ${m.framework_default}
עקרונות:
${m.principles.map(p => `  • ${p}`).join('\n')}
מהלכים ייחודיים:
${m.signature_moves.map(s => `  • ${s}`).join('\n')}
דוגמאות:
${m.examples.map(e => `  • "${e.headline}" — ${e.why_it_works}`).join('\n')}
קול: ${m.voice_notes}`;
}
```

- [ ] **Step 2: Verify the file type-checks**

Run: `npm run type-check`
Expected: passes (no new errors introduced by this file).

- [ ] **Step 3: Commit**

```bash
git add lib/marketers.ts
git commit -m "feat(create): add 12-marketer corpus for Master Studio"
```

---

## Task 2: Master Studio prompt builder + parser

**Files:**
- Create: `lib/master-studio.ts`

- [ ] **Step 1: Create `lib/master-studio.ts`**

```ts
// ════════════════════════════════════════════
// Master Studio — prompt composition & parsing
// ════════════════════════════════════════════

import { MARKETERS, MARKETERS_BY_ID, marketerToPromptBlock, type MarketerId } from './marketers';
import { FRAMEWORKS_BY_ID, type FrameworkId } from './frameworks';
import type { BrandDNA } from '@/types';

export interface MasterStudioInput {
  brief:        string;
  brand?:       BrandDNA;
  masterNotes?: string;
  platform:     string;       // label, e.g. "Facebook"
  tone?:        string;
  type?:        string;
  /** If user locked a framework via Override chips. */
  framework?:   FrameworkId;
  /** If user locked a hook style via Override chips. */
  hook?:        string;
  locale?:      'he' | 'en' | 'ar';
}

export interface AvatarProfile {
  persona:         string;
  fears:           string;
  desires:         string;
  awareness_level: string;
  objections:      string;
}

export interface MarketerPick {
  id:    MarketerId | string;   // string fallback if unknown id returned
  name:  string;
  emoji: string;
}

export interface PrincipleApplied {
  principle:   string;
  application: string;
}

export interface MasterStudioOutput {
  avatar:     AvatarProfile | null;
  marketer:   MarketerPick  | null;
  why:        string;
  principles: PrincipleApplied[];
  post:       string;
  hashtags:   string[];
  image:      string;
  tips:       string;
  whatsapp:   string;
}

const MASTER_NOTES_MAX = 2000;

/**
 * Build the layered system prompt for Master Studio.
 * Input total budget ~3500 tokens.
 */
export function composeMasterPrompt(opts: MasterStudioInput): string {
  const lang = opts.locale === 'en' ? 'in English'
             : opts.locale === 'ar' ? 'بالعربية'
             : 'בעברית';

  const masterNotes = (opts.masterNotes ?? '').trim().slice(0, MASTER_NOTES_MAX);
  const corpus = MARKETERS.map(marketerToPromptBlock).join('\n\n');

  const forcedFw = opts.framework
    ? `Forced framework: ${opts.framework} (${FRAMEWORKS_BY_ID[opts.framework]?.name_en ?? opts.framework}) — MUST use this`
    : 'Forced framework: none — choose the framework that best matches the picked marketer';

  const forcedHook = opts.hook
    ? `Forced hook style: ${opts.hook} — MUST use this opening style`
    : 'Forced hook style: none — pick the most effective hook for this avatar';

  return `אתה Master Studio — היוצר השיווקי הטוב בעולם. אתה מאחד את החוכמה של 12 ענקי הקופי.

תהליך חובה (4 שלבים):
1) ניתוח אווטאר עמוק מהבריף + BrandDNA לפי Schwartz 5 awareness levels.
2) בחירת המשווק האידיאלי מ-12 לפי awareness, סוג מוצר, פלטפורמה, וה-Master Notes.
3) גילום מלא של אותו משווק — קולו, framework המועדף, signature moves שלו.
4) יישום עקרונות שלו על הפוסט עם הסבר קצר על כל עיקרון.

כתוב ${lang}.

═══ MASTER NOTES (🔒 PRIORITY — overrides everything below) ═══
${masterNotes || '— אין הערות מיוחדות —'}

═══ 12 MARKETERS CORPUS ═══
${corpus}

═══ OVERRIDES ═══
- ${forcedFw}
- ${forcedHook}
- Platform: ${opts.platform}
- Tone hint: ${opts.tone ?? '—'}
- Post type hint: ${opts.type ?? '—'}

═══ OUTPUT CONTRACT (return ONLY these tags, in this order, nothing else) ═══
[AVATAR_PROFILE]
persona: ...
fears: ...
desires: ...
awareness_level: 1-5 + תווית
objections: ...
[/AVATAR_PROFILE]
[MARKETER_PICK]id|name|emoji[/MARKETER_PICK]
[WHY_THIS_MARKETER]2-3 משפטים למה דווקא הוא[/WHY_THIS_MARKETER]
[PRINCIPLES_APPLIED]
- עקרון: "<שם העיקרון>" → איך התבטא: <משפט קצר>
- עקרון: "<שם העיקרון>" → איך התבטא: <משפט קצר>
- עקרון: "<שם העיקרון>" → איך התבטא: <משפט קצר>
[/PRINCIPLES_APPLIED]
[POST]הפוסט המלא, עם אמוג'ים וקריאה לפעולה[/POST]
[HASHTAGS]12-15 האשטגים בעברית ואנגלית[/HASHTAGS]
[IMAGE_PROMPT]Detailed English prompt for Ideogram/Midjourney[/IMAGE_PROMPT]
[TIPS]3 טיפים לפרסום: מתי, לאיזה קהל, תקציב[/TIPS]
[WHATSAPP]גרסה קצרה לWhatsApp ללא אמוג'ים מוגזמים[/WHATSAPP]`;
}

/** Extract content inside `[TAG]…[/TAG]`. Empty string if missing. */
function xt(raw: string, tag: string): string {
  const m = raw.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`));
  return m ? m[1].trim() : '';
}

/** Parse `key: value` pairs inside a block. */
function parseKeyValueBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*([^:]+):\s*(.+)$/);
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

/** Parse bulleted list (lines starting with -, •, *, digit-dot). */
function parseList(s: string): string[] {
  return s.split('\n')
    .map(l => l.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter(Boolean);
}

/** Parse the "principle: X → application: Y" structured bullets. */
function parsePrinciples(block: string): PrincipleApplied[] {
  const items = parseList(block);
  return items.map(line => {
    const m = line.match(/^עקרון:\s*"?([^"→]+)"?\s*→\s*איך התבטא:\s*(.+)$/);
    if (m) return { principle: m[1].trim(), application: m[2].trim() };
    const arrow = line.match(/^(.+?)\s*→\s*(.+)$/);
    if (arrow) return { principle: arrow[1].trim(), application: arrow[2].trim() };
    return { principle: line, application: '' };
  });
}

function parseAvatar(block: string): AvatarProfile | null {
  if (!block) return null;
  const kv = parseKeyValueBlock(block);
  return {
    persona:         kv['persona']         ?? '',
    fears:           kv['fears']           ?? '',
    desires:         kv['desires']         ?? '',
    awareness_level: kv['awareness_level'] ?? '',
    objections:      kv['objections']      ?? '',
  };
}

function parseMarketer(block: string): MarketerPick | null {
  if (!block) return null;
  const parts = block.split('|').map(s => s.trim());
  const [idRaw, nameRaw, emojiRaw] = parts;
  const id = (idRaw ?? '').toLowerCase();
  const known = (MARKETERS_BY_ID as Record<string, { name: string; emoji: string }>)[id];
  if (known) {
    return { id: id as MarketerId, name: known.name, emoji: known.emoji };
  }
  // Fallback: trust returned name/emoji if id is unknown
  if (id) {
    console.warn('[master-studio] unknown marketer id:', id, '— falling back to schwartz');
    const fb = MARKETERS_BY_ID.schwartz;
    return { id: 'schwartz', name: nameRaw || fb.name, emoji: emojiRaw || fb.emoji };
  }
  return null;
}

export function parseMasterResponse(raw: string): MasterStudioOutput {
  const avatar     = parseAvatar(xt(raw, 'AVATAR_PROFILE'));
  const marketer   = parseMarketer(xt(raw, 'MARKETER_PICK'));
  const why        = xt(raw, 'WHY_THIS_MARKETER');
  const principles = parsePrinciples(xt(raw, 'PRINCIPLES_APPLIED'));
  const post       = xt(raw, 'POST');
  const hashtags   = xt(raw, 'HASHTAGS').split(/\s+/).filter(h => h.startsWith('#'));
  const image      = xt(raw, 'IMAGE_PROMPT');
  const tips       = xt(raw, 'TIPS');
  const whatsapp   = xt(raw, 'WHATSAPP');
  return { avatar, marketer, why, principles, post, hashtags, image, tips, whatsapp };
}

/** Critical-tag check used to decide whether to refund. */
export function isCriticalFailure(out: MasterStudioOutput): boolean {
  return !out.post || !out.marketer;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/master-studio.ts
git commit -m "feat(create): add Master Studio prompt builder and response parser"
```

---

## Task 3: Wire credit type & cost

**Files:**
- Modify: `types/index.ts` (find `CreditAction` and `CREDIT_COSTS`)

- [ ] **Step 1: Add `'master_post'` to `CreditAction`**

Locate the `CreditAction` union (currently ends with `| 'recommend';`). Add `'master_post'` to the union — group it with the Phase C block by placing the line directly above `| 'recommend';`:

```ts
  | 'analyze_brief'   // analyze a brief and suggest improvements
  | 'analyze_weak'    // analyze a weak/failing ad
  | 'offer_stack'     // Hormozi-style offer stack builder
  | 'img_adapt'       // adapt existing image to different aspect ratio
  | 'master_post'     // marketer-driven post generation (Master Studio)
  | 'recommend';      // AI agent recommendations
```

- [ ] **Step 2: Add the cost entry**

Locate `CREDIT_COSTS` (the `Record<CreditAction, number>` literal). Add directly above `recommend: 0`:

```ts
  master_post: 4,
  recommend:   0,
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "feat(types): register master_post credit action (4 credits)"
```

---

## Task 4: Verify API route handles `master_post` (no-op if already generic)

**Files:**
- Modify (verify only): `app/api/ai/route.ts`

The route is already generic — it reads `action`, `system`, `prompt`, `maxTokens` from the body and validates via `CREDIT_COSTS`. Adding `'master_post'` to types alone makes it valid. **No code change** is required here unless the route is hardcoded against specific actions.

- [ ] **Step 1: Read the file and confirm it is generic**

Run: `grep -n "CREDIT_COSTS\|action" app/api/ai/route.ts | head -20`
Expected output contains lines validating `action` via `CREDIT_COSTS[action]` (no allow-list of action names).

If you see a hardcoded allow-list, add `'master_post'` to it. Otherwise skip to commit-skip — there is nothing to commit for this task.

- [ ] **Step 2: Confirm `maxTokens` is honored**

Run: `grep -n "max_tokens\|maxTokens" app/api/ai/route.ts`
Expected: `max_tokens: maxTokens` (it reads from body, defaulting to 1200). No change needed — the caller will pass 2500.

- [ ] **Step 3: No commit (verification task)**

If you did make any change in Step 1, commit:
```bash
git add app/api/ai/route.ts
git commit -m "feat(api): accept master_post action"
```

---

## Task 5: `/create` page — state model + Master Notes textarea

**Files:**
- Modify: `app/(dashboard)/create/page.tsx`

This task introduces the new state and adds the Master Notes textarea. UI for the Why-this-works panel comes in Task 7.

- [ ] **Step 1: Replace the imports and state declarations**

Find the current imports + state block (lines ~1-25). Replace with:

```tsx
'use client';
import { useState } from 'react';
import { Card, CardLabel, Chip, Textarea, Btn, OutputBox, Tabs, CopyBtn, CostBadge, Alert, PageHeader } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import { FRAMEWORKS, FRAMEWORKS_BY_ID, type FrameworkId } from '@/lib/frameworks';
import { composeMasterPrompt, parseMasterResponse, isCriticalFailure, type MasterStudioOutput } from '@/lib/master-studio';
import { MARKETERS_BY_ID } from '@/lib/marketers';

const PLATFORMS = [
  { id: 'facebook',  l: 'Facebook',  i: '📘' },
  { id: 'instagram', l: 'Instagram', i: '📸' },
  { id: 'whatsapp',  l: 'WhatsApp',  i: '💬' },
  { id: 'tiktok',    l: 'TikTok',    i: '🎵' },
];
const TONES = ['חם ואישי','מקצועי','חסידי','דחיפות','סיפור'];
const TYPES = ['הצגת מוצר','מבצע','בניית אמון','שאלה לקהל','טיפ מקצועי'];
const HOOKS = ['שאלה פרובוקטיבית','עובדה מפתיעה','סיפור אישי','הצעה חסרת תחרות','אזהרה'];

const MASTER_NOTES_MAX = 2000;

export default function CreatePage() {
  const [plt,  setPlt]   = useState('facebook');
  const [tone, setTone]  = useState('חם ואישי');
  const [type, setType]  = useState('הצגת מוצר');

  // Override (optional)
  const [fwOverride,   setFwOverride]   = useState<FrameworkId | null>(null);
  const [hookOverride, setHookOverride] = useState<string | null>(null);

  const [brief,       setBrief]       = useState('');
  const [masterNotes, setMasterNotes] = useState('');

  const [tab,  setTab]   = useState('post');
  const [out,  setOut]   = useState<MasterStudioOutput | null>(null);
  const [revealOpen, setRevealOpen] = useState(true);

  const { call, loading, error } = useAI();
  const pLabel = PLATFORMS.find(p => p.id === plt)?.l ?? plt;
```

- [ ] **Step 2: Replace the `generate()` function**

Find the existing `async function generate()` and replace with:

```tsx
  async function generate() {
    if (!brief.trim()) return;
    const system = composeMasterPrompt({
      brief,
      platform:    pLabel,
      tone,
      type,
      framework:   fwOverride ?? undefined,
      hook:        hookOverride ?? undefined,
      masterNotes: masterNotes.slice(0, MASTER_NOTES_MAX),
    });
    const text = await call('master_post', system, `בריף: ${brief}`, 2500, plt);
    if (!text) return;
    const parsed = parseMasterResponse(text);
    if (isCriticalFailure(parsed)) {
      // Show as soft error — the API already deducted credits.
      // (Auto-refund is best implemented server-side in a follow-up.)
      console.warn('[create] critical tags missing in response');
    }
    setOut(parsed);
    setTab('post');
    setRevealOpen(true);
  }
```

- [ ] **Step 3: Replace the bottom-left brief card with brief + Master Notes**

Find the JSX block containing the `<Card>` with `<CardLabel>בריף</CardLabel>` and replace with:

```tsx
          <Card className="mb-3">
            <CardLabel>בריף</CardLabel>
            <Textarea value={brief} onChange={setBrief}
              placeholder="תאר מה אתה רוצה לפרסם. לדוגמה: מבצע לחג שבועות — תפילין מהודרות 15% הנחה לבני מצווה..."
              rows={4} />
          </Card>

          <Card className="mb-3" style={{ borderColor: '#3D2F6B' }}>
            <CardLabel>🔒 הערות מאסטר (עדיפות עליונה)</CardLabel>
            <Textarea
              value={masterNotes}
              onChange={(v) => setMasterNotes(v.slice(0, MASTER_NOTES_MAX))}
              placeholder="הוראות שמועדפות על הכל. למשל: לא להזכיר מחיר, להדגיש את הסבא, להימנע ממילת 'מבצע'..."
              rows={3}
            />
            <div className="text-[10px] text-[#2E4459] mt-1 text-left" dir="ltr">
              {masterNotes.length} / {MASTER_NOTES_MAX}
            </div>
          </Card>
```

- [ ] **Step 4: Update `<CostBadge>` to 4**

In the `<PageHeader>` JSX, change `<CostBadge cost={3} />` to `<CostBadge cost={4} />`.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: passes. The output tabs section in the file still references old `out.post`, `out.hashtags`, etc. — those fields exist on `MasterStudioOutput` (named the same) so existing JSX still compiles.

- [ ] **Step 6: Commit**

```bash
git add app/\(dashboard\)/create/page.tsx
git commit -m "feat(create): wire Master Studio state + master notes textarea"
```

---

## Task 6: `/create` page — Override section (framework + hook chips)

**Files:**
- Modify: `app/(dashboard)/create/page.tsx`

This task replaces the always-on framework/hook chips with an optional "Override" section.

- [ ] **Step 1: Replace the framework/hook chip sections inside the left settings `<Card>`**

Find the block that currently renders:
- `<CardLabel>Framework קופירייטינג</CardLabel>` (with `FRAMEWORKS.map(...)`)
- `<CardLabel>Hook</CardLabel>` (with `HOOKS.map(...)`)
- The framework-description blurb div

Replace **the entire combined block** (everything from the `Framework קופירייטינג` label down through the `Hook` chips inclusive) with:

```tsx
            <CardLabel>פלטפורמה</CardLabel>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {PLATFORMS.map(p => <Chip key={p.id} label={`${p.i} ${p.l}`} active={plt===p.id} onClick={()=>setPlt(p.id)} />)}
            </div>

            <CardLabel>סוג פוסט</CardLabel>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {TYPES.map(t => <Chip key={t} label={t} active={type===t} onClick={()=>setType(t)} />)}
            </div>

            <CardLabel>טון</CardLabel>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {TONES.map(t => <Chip key={t} label={t} active={tone===t} onClick={()=>setTone(t)} />)}
            </div>

            <div className="border-t border-[#1E2F42] pt-3 mt-3">
              <CardLabel>🎛 Override (אופציונלי)</CardLabel>
              <div className="text-[11px] text-[#2E4459] mb-2">
                כברירת מחדל — ה-AI בוחר את ה-framework וה-hook. לחץ chip לכפיית בחירה.
              </div>

              <div className="text-[11px] text-[#6B8FA8] mb-1">Framework</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <Chip label="— AI יבחר —" active={fwOverride===null} onClick={() => setFwOverride(null)} />
                {FRAMEWORKS.map(f => (
                  <Chip
                    key={f.id}
                    label={`${f.emoji} ${f.name_he.split('—')[0].trim()}`}
                    active={fwOverride===f.id}
                    onClick={() => setFwOverride(fwOverride === f.id ? null : f.id)}
                  />
                ))}
              </div>
              {fwOverride && (
                <div className="text-[10px] text-[#6B8FA8] bg-[#162030] rounded-lg px-3 py-2 mb-3 leading-relaxed">
                  <strong className="text-[#D9E8F5]">{FRAMEWORKS_BY_ID[fwOverride].name_en}:</strong> {FRAMEWORKS_BY_ID[fwOverride].description}
                </div>
              )}

              <div className="text-[11px] text-[#6B8FA8] mb-1">Hook</div>
              <div className="flex flex-wrap gap-1.5">
                <Chip label="— AI יבחר —" active={hookOverride===null} onClick={() => setHookOverride(null)} />
                {HOOKS.map(h => (
                  <Chip
                    key={h}
                    label={h}
                    active={hookOverride===h}
                    onClick={() => setHookOverride(hookOverride === h ? null : h)}
                  />
                ))}
              </div>
            </div>
```

The existing `TYPES` / `TONES` chip blocks that lived above are now merged into the same `<Card>` — make sure not to leave duplicated blocks. Verify the surrounding `<Card>` opens before the platform block and closes after the override section.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: passes.

- [ ] **Step 3: Visual sanity check via dev server**

Run: `npm run dev` (background)
Open: http://localhost:3000/create
Confirm:
- Framework + Hook chips appear under "🎛 Override (אופציונלי)" with a leading "— AI יבחר —" chip active by default
- Clicking a framework chip activates it and shows its description; clicking the same chip again deactivates back to "AI יבחר"
- Same behavior for hook chips
Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/create/page.tsx
git commit -m "feat(create): move framework + hook into optional Override section"
```

---

## Task 7: `/create` page — "Why this works" reveal panel

**Files:**
- Modify: `app/(dashboard)/create/page.tsx`

- [ ] **Step 1: Add the reveal panel JSX above the existing tabs**

Find the existing right-column block — specifically the JSX `{out ? (` ternary. Just inside the `<>` (after `{out ? (` and before `<Tabs ... />`), insert this reveal panel:

```tsx
              {(out.avatar || out.marketer) && (
                <Card className="mb-3" style={{ borderColor: '#2A3E66' }}>
                  <button
                    onClick={() => setRevealOpen(o => !o)}
                    className="w-full flex items-center justify-between text-right"
                  >
                    <span className="text-[13px] font-semibold text-[#D9E8F5] flex items-center gap-2">
                      🧠 Why this works
                    </span>
                    <span className="text-[#6B8FA8] text-xs">{revealOpen ? '▾' : '▸'}</span>
                  </button>

                  {revealOpen && (
                    <div className="mt-3 space-y-3 text-[12px] leading-relaxed">
                      {out.avatar && (
                        <div>
                          <div className="text-[11px] font-bold text-[#6B8FA8] uppercase tracking-wider mb-1">👤 אווטאר</div>
                          <div className="space-y-0.5 text-[#D9E8F5]">
                            {out.avatar.persona         && <div><span className="text-[#6B8FA8]">פרסונה:</span> {out.avatar.persona}</div>}
                            {out.avatar.fears           && <div><span className="text-[#6B8FA8]">פחדים:</span> {out.avatar.fears}</div>}
                            {out.avatar.desires         && <div><span className="text-[#6B8FA8]">רצונות:</span> {out.avatar.desires}</div>}
                            {out.avatar.awareness_level && <div><span className="text-[#6B8FA8]">Awareness:</span> {out.avatar.awareness_level}</div>}
                            {out.avatar.objections      && <div><span className="text-[#6B8FA8]">התנגדויות:</span> {out.avatar.objections}</div>}
                          </div>
                        </div>
                      )}

                      {out.marketer && (
                        <div className="border-t border-[#1E2F42] pt-2">
                          <div className="text-[11px] font-bold text-[#6B8FA8] uppercase tracking-wider mb-1">🎯 משווק נבחר</div>
                          <div className="text-[#D9E8F5] flex items-center gap-2">
                            <span className="text-lg">{out.marketer.emoji}</span>
                            <span className="font-semibold">{out.marketer.name}</span>
                          </div>
                          {out.why && <div className="text-[#6B8FA8] mt-1">{out.why}</div>}
                        </div>
                      )}

                      {out.principles.length > 0 && (
                        <div className="border-t border-[#1E2F42] pt-2">
                          <div className="text-[11px] font-bold text-[#6B8FA8] uppercase tracking-wider mb-1">📚 עקרונות שיושמו</div>
                          <ul className="space-y-1 text-[#D9E8F5]">
                            {out.principles.map((p, i) => (
                              <li key={i}>
                                <span className="font-semibold text-[#3D9FFF]">{p.principle}</span>
                                {p.application && <span className="text-[#6B8FA8]"> → {p.application}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/create/page.tsx
git commit -m "feat(create): add 'Why this works' reveal panel with avatar/marketer/principles"
```

---

## Task 8: End-to-end manual QA

**Files:**
- None modified.

- [ ] **Step 1: Run build to catch any compile issues**

Run: `npm run build`
Expected: build completes without errors.

- [ ] **Step 2: Run dev server**

Run: `npm run dev` (background)

- [ ] **Step 3: Authenticate and navigate**

Open http://localhost:3000/create in the browser. Log in if needed.

- [ ] **Step 4: Run the QA checklist from the spec**

For each, perform the action and verify:

- [ ] Generate with brief only (no Master Notes, no Override). Expect: post + reveal panel populated with avatar, marketer, principles.
- [ ] Generate with Master Notes "לא להזכיר מחיר". Expect: no price appears in the output post.
- [ ] Lock framework = PAS via Override. Generate. Expect: post structure follows PAS even if marketer picked is, e.g., Brunson.
- [ ] Lock hook = "עובדה מפתיעה". Generate. Expect: post opens with a surprising fact.
- [ ] Cycle through 4 platforms (FB / IG / WA / TikTok). Expect: output length & style adapt.
- [ ] Resize browser to <640px. Expect: two columns collapse cleanly; reveal panel stays readable.
- [ ] Toggle "🧠 Why this works" header. Expect: collapses and expands.
- [ ] Regenerate same brief twice. Expect: different outputs.
- [ ] Empty brief → "✨ צור פוסט" button disabled.
- [ ] Master Notes counter shows `n / 2000` and stops at 2000.

- [ ] **Step 5: Stop dev server, commit any tweaks discovered during QA**

If QA surfaced visual/wording bugs, fix and commit. Then:

```bash
git log --oneline -10
```

Confirm the last ~7 commits tell the Master Studio story end-to-end.

---

## Self-Review

**Spec coverage** — checked against `docs/superpowers/specs/2026-05-27-master-studio-design.md`:

| Spec section | Task |
|---|---|
| §3 The 12 marketers | Task 1 |
| §4 Files to add | Tasks 1, 2 |
| §4 Files to update | Tasks 3, 4, 5, 6, 7 |
| §4 No DB migration | covered by absence of any migration task |
| §5 Prompt contract | Task 2 |
| §5 Token budget / max_tokens=2500 | Task 5, step 2 |
| §6 UI Settings column | Tasks 5, 6 |
| §6 UI Output column (reveal) | Task 7 |
| §7 Parsing | Task 2 |
| §7 Error handling — missing critical tag | Task 2 (`isCriticalFailure`) + Task 5 console.warn. **Note:** server-side auto-refund is deferred — added as a follow-up below. |
| §7 unknown marketer.id | Task 2 (`parseMarketer` fallback) |
| §8 Manual QA | Task 8 |

**Placeholder scan:** every step contains either exact code or an exact command; no `TBD`/`TODO` placeholders.

**Type consistency:** `MarketerId`, `MasterStudioOutput`, `composeMasterPrompt`, `parseMasterResponse`, `isCriticalFailure` are declared in Task 2 and consumed unchanged in Task 5. `FrameworkId` re-used from existing `lib/frameworks.ts`. Credit action `'master_post'` declared in Task 3 and used in Task 5.

**Known follow-up (out of scope for this plan):** server-side auto-refund when `[POST]`/`[MARKETER_PICK]` are missing. This would require parsing inside `app/api/ai/route.ts` for this action specifically — defer until we observe real-world failure rates.
