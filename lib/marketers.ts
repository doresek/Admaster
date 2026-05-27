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
