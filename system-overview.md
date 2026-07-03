# Ad Master Pro — System Overview

> **Audience:** external consultant performing a system review.
> **Scope:** complete architectural picture with an emphasis on the **marketing
> generation module**. Contains **no secrets** (env values, keys, tokens and
> connection strings are omitted or shown as `[REDACTED]`) and **no real user or
> customer data** (examples use dummy values such as `user@example.com`,
> `Customer A`).
>
> Generated from a read of the source tree at branch `chore/db-infra`.

---

## 1. Overview

**Ad Master Pro** is an AI-powered social-media / performance-marketing SaaS,
built for marketers and small agencies operating primarily in the Israeli market
(Hebrew-first, with English and Arabic locales). A marketer connects their
clients' Meta (Facebook/Instagram) ad accounts, captures each client's business
context as a structured **brief** and a reusable **Brand DNA**, and then uses
AI to generate, score, refine, approve, and (eventually) launch ad creative.

Usage is metered by a **credit system** — every AI action deducts credits, and a
failed external call refunds them.

### The marketing module's role

The marketing module is the **content-generation and quality engine** at the
core of the product. It turns a brief into ad copy and grades that copy, through
several cooperating subsystems:

- **Master Studio** — a *best-of-N* generation pipeline. A strategist picks the
  3 best-matched "master marketers" for the brief; each writes a competing post;
  an LLM judge scores them on 7 dimensions and picks a winner; a conditional
  editor pass boosts the winner if its score is below threshold.
- **Performance Score** — a separate, cheaper scoring engine that grades any ad
  copy 0–100 for a target channel/audience and extracts demographics, emotions,
  offerings, and ad-policy flags.
- **Judge** — a system-wide artifact evaluator (operational / managerial /
  practical / design) that returns an approve / revise / reject verdict; it is
  the gate seam used by the autopilot.
- **Autopilot** — an orchestrator that chains generate → score → judge →
  human-approval gate → (targeting → launch → insights), driving a per-client
  **journey** state machine.

These produce the artifacts the rest of the app (cockpit, history, approvals,
analytics) consumes.

---

## 2. Tech stack & key dependencies

From `package.json` (Node engine: `>=20.0.0 <21.0.0`).

| Layer        | Technology |
|--------------|------------|
| Framework    | Next.js 14 (App Router), React 18 |
| Language     | TypeScript 5 |
| Hosting      | Vercel |
| Database/Auth| Supabase (PostgreSQL + Auth + RLS) |
| AI (text)    | Anthropic Claude via `@anthropic-ai/sdk` |
| AI (images)  | Google Vertex AI (`google-auth-library`, service-account JWT) |
| Payments     | Stripe |
| Ads API      | Meta Graph API |
| Styling      | Tailwind CSS 3 |
| State/data   | Zustand, SWR |
| Testing      | Vitest, Playwright |

**Runtime dependencies**

```
@anthropic-ai/sdk ^0.21.0      stripe ^15.8.0
@supabase/ssr ^0.10.3          swr ^2.2.5
@supabase/supabase-js ^2.106.2 zustand ^4.5.2
google-auth-library ^10.6.2    clsx ^2.1.1
next ^14.2.35                  tailwind-merge ^2.3.0
react / react-dom ^18          date-fns ^3.6.0 / date-fns-tz ^3.1.3
react-hot-toast ^2.4.1         lucide-react ^0.383.0
```

**Dev / tooling**

```
typescript ^5            vitest ^4.1.7        playwright ^1.60.0
eslint ^8 + eslint-config-next   tailwindcss ^3.4.1   autoprefixer / postcss
@types/* (node, react, react-dom)   ws ^8.21.0
```

**Optional:** `@opentelemetry/api ^1.9.1`.

**Scripts:** `dev` (Next + Turbo), `build`, `start`, `lint`, `type-check`
(`tsc --noEmit`), `test` (`vitest run`), `test:watch`.

There is **no** Python component (`requirements.txt` is empty).

---

## 3. Directory structure

`tree`-style view, depth 3, ignoring `node_modules`, `.git`, `dist`, `build`
(and `.next`):

```
admaster-db/
├── README.md
├── DEPLOY.md
├── SETUP-VERTEX-AI.md
├── package.json
├── next.config.js
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── vitest.config.ts
├── vercel.json
├── middleware.ts                # auth protection
├── .env.example                 # variable NAMES only (no values committed)
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   ├── (auth)/                  # login, register
│   ├── (dashboard)/             # all protected pages (see below)
│   ├── (public)/                # blog, contact, faq, features, pricing, welcome, how-it-works
│   ├── api/                     # route handlers (see below)
│   ├── approve/[token]/         # public client-approval portal
│   ├── brief/                   # public brief-intake form
│   └── lp/[slug]/               # public landing pages
├── components/
│   ├── cockpit/                 # CockpitBoard, JourneyStepper, AutopilotPanel
│   ├── layout/                  # Sidebar
│   ├── onboarding/              # OnboardingWizard, MetaConnectGuide
│   ├── ui/
│   ├── ScorePanel.tsx · ScoreBadge.tsx · BoostButton.tsx
│   ├── RecommendationsWidget.tsx · NotificationBell.tsx
│   ├── ClientSwitcher.tsx · CreditsBadge.tsx · TopFiveFilter.tsx · FAB.tsx
├── lib/
│   ├── master-studio/           # best-of-N pipeline (MARKETING MODULE core)
│   │   ├── index.ts · pipeline.ts · strategist.ts
│   │   ├── creator.ts · judge.ts · editor.ts
│   ├── judge/                   # system-wide artifact judge (index, prompt, types)
│   ├── autopilot/               # orchestrator, steps, credits, types
│   ├── policy-rules/            # meta.he.ts, google.he.ts (ad-policy heuristics)
│   ├── supabase/                # client.ts, server.ts
│   ├── hooks/                   # useAI, useMetaClients
│   ├── landing-skill-data/      # CSV/MD design corpus for landing generation
│   ├── marketers.ts             # 12-marketer corpus
│   ├── frameworks.ts            # 8 copywriting frameworks
│   ├── scoring.ts               # performance-score prompt + parser
│   ├── ai-context.ts            # Brand DNA + client + brief → prompt context
│   ├── journey.ts               # per-client journey state machine
│   ├── credits.ts               # deduct/refund helpers
│   ├── vertex-ai.ts · image-pipeline.ts · image-storage.ts
│   ├── landing-design.ts · landing-templates.ts · landing-skill-loader.ts
│   ├── frameworks.ts · marketers.ts · scoring.ts
│   ├── i18n.ts · i18n-context.tsx · rate-limit.ts · crypto.ts
│   ├── active-client.ts · meta.ts
├── types/
│   └── index.ts                 # shared types + CREDIT_COSTS
├── supabase/
│   └── migrations/              # 001..013 SQL (schema is applied manually)
├── tests/
│   ├── scoring.test.ts · policy-rules.test.ts
│   └── master-studio/           # pipeline, strategist, creator, judge, editor, …
├── docs/
│   └── superpowers/             # plans/ and specs/ (design docs)
└── scripts/                     # QA / smoke / drift-check utilities (*.mjs)
```

**`app/(dashboard)/` pages (selected):** `cockpit` (home), `create`,
`quick-campaign`, `variations`, `refine`, `analyze`, `analyze-brief`,
`analyze-weak`, `campaign`, `offer-stack`, `messages`, `series`, `landing-pages`,
`images`, `lab`, `brand`, `clients`, `briefs`, `send-brief`, `approvals`,
`schedule`, `calendar`, `publish`, `pixel`, `competitor`, `analytics`,
`reports`, `library`, `history`, `recommendations`, `notifications`, `team`,
`agency`, `settings`, `support`, `onboarding`, `credits`.

**`app/api/` route handlers (selected):** `ai/master`, `ai/score`,
`ai/score/boost`, `ai` (generic), `quick-campaign`, `autopilot/{run,resume,status}`,
`approvals` + `approvals/public`, `briefs` + `briefs/{submit,code-meta}`,
`landing/{generate,refine,variants,upload,lead,public}`, `images`, `meta` +
`meta/clients`, `credits` + `credits/webhook`, `recommendations`, `analytics`,
`reports`, `schedule`, `pixel`, `competitor`, `team`, `notifications`,
`settings`, `onboarding`, `library`, `tools`, `contact`, `active-client`.

---

## 4. Database schema (table structures only)

Supabase PostgreSQL. DDL lives in `supabase/migrations/001..013` and is applied
manually in the Supabase SQL Editor. **No data rows are included below** — only
structure. Row-Level Security is enabled on user-owned tables (policies restrict
rows to `auth.uid()`); `SECURITY DEFINER` functions handle atomic credit moves.

### Core (migration 001)

```sql
-- extends Supabase auth.users
create table public.users (
  id          uuid references auth.users(id) on delete cascade primary key,
  name        text not null,
  email       text not null unique,
  credits     int  not null default 150,
  plan        text not null default 'free' check (plan in ('free','starter','pro','agency')),
  brand       jsonb default '{}'::jsonb,         -- Brand DNA
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table public.credit_history (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  action text not null, cost int not null,
  meta jsonb default '{}'::jsonb, created_at timestamptz default now()
);

create table public.brief_codes (          -- marketer-issued code, sent to client
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  user_id uuid references public.users(id) on delete cascade not null,
  agency_name text, created_at timestamptz default now()
);

create table public.briefs (               -- client submissions
  id uuid primary key default uuid_generate_v4(),
  code text not null references public.brief_codes(code),
  user_id uuid references public.users(id) on delete cascade not null,
  values jsonb not null default '{}'::jsonb,
  avatar text, ads text, funnel text,
  status text not null default 'new' check (status in ('new','has_avatar','complete')),
  submitted_at timestamptz default now(), updated_at timestamptz default now()
);

create table public.meta_clients (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  name text not null, industry text, emoji text default '🏢',
  token text not null,                       -- access token; value [REDACTED], encrypt via Vault in prod
  meta_user_id text, meta_user_name text,
  pages jsonb default '[]'::jsonb, ad_accounts jsonb default '[]'::jsonb,
  selected_page_id text, selected_ad_account_id text,
  status text default 'connected',
  posts_published int default 0, campaigns_created int default 0,
  connected_at timestamptz default now(), updated_at timestamptz default now()
);

create table public.generated_content (     -- posts, analyses, master_post output …
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  type text not null,                        -- 'post','analysis','variation','holiday','master_post',…
  platform text, input jsonb default '{}'::jsonb, output jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table public.plans (id text primary key, name text not null, credits int not null, price int not null);
```

**Functions / triggers (001):**
`handle_new_user()` (auto-creates a `public.users` row on signup),
`deduct_credits(p_user_id, p_action, p_cost)` (atomic, `SELECT … FOR UPDATE`,
writes `credit_history`), `update_brief_status()` (derives brief `status`).
Later migrations add `refund_credits(...)` (004) and harden the
`search_path` of `SECURITY DEFINER` functions (009).

### Marketing-module tables

```sql
-- Performance-score results (migration 006)
create table public.scores (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  brand_id uuid,                              -- soft ref (brand lives on users.brand today)
  source_kind text not null check (source_kind in ('master_post','variation','refine','manual','saved_ad')),
  source_id uuid,
  copy_text text not null,
  channel text not null check (channel in (
    'meta_feed','meta_story','meta_reel','google_search','google_display','email','sms','landing','tiktok')),
  audience_segment jsonb default '{}'::jsonb,
  locale text not null default 'he' check (locale in ('he','en','ar')),
  score int not null check (score between 0 and 100),
  band text not null check (band in ('low','mid','high')),
  demographics jsonb not null, emotions text[] not null default '{}',
  extracts jsonb not null default '{}'::jsonb, policy_flags jsonb default '[]'::jsonb,
  predicted_hook text, model_version text not null default '[model-tag]',
  prompt_tokens int, output_tokens int,
  boost_iteration int default 0,
  parent_score_id uuid references public.scores(id) on delete set null,
  created_at timestamptz default now()
);

-- Iterative copy refinements
create table public.refinements (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  parent_id uuid references public.refinements(id) on delete set null,
  original_text text not null, refined_text text not null, feedback text not null,
  iteration int default 1, created_at timestamptz default now()
);

-- AI-image outputs
create table public.generated_images (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  prompt text not null, image_url text not null,
  provider text default 'ideogram', style text, aspect_ratio text default '1:1',
  used_in text, created_at timestamptz default now()
);

-- Surfaced next-best-actions
create table public.recommendations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  kind text not null check (kind in ('quick_win','growth','retention','warning','tip')),
  title text not null, body text, action_href text, action_label text,
  priority int default 0, dismissed boolean default false, created_at timestamptz default now()
);
```

### Workflow / autopilot tables

```sql
-- Client-shareable approval items (public /approve/[token] portal)
create table public.approvals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  client_id uuid references public.meta_clients(id) on delete set null,
  token text not null unique, title text,
  content jsonb not null default '{}'::jsonb,   -- { text, image_url, channel, framework }
  status text default 'pending' check (status in ('pending','approved','changes','rejected')),
  feedback text, created_at timestamptz default now(), responded_at timestamptz
);

-- Per-client journey state machine (migration 013)
create table public.client_journeys (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  client_id uuid references public.meta_clients(id) on delete cascade,
  state text not null default 'needs_brief' check (state in (
    'needs_client','needs_brief','brief_in','generating','scoring','awaiting_approval',
    'ready_to_launch','live','analyzing','optimizing','needs_attention')),
  mode text not null default 'manual' check (mode in ('manual','autopilot')),
  brief_id uuid, approval_id uuid, launched_ad_id uuid, current_run_id uuid,  -- soft refs
  next_action jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (user_id, client_id)
);

-- Audit timeline + judge-verdict seam
create table public.journey_events (
  id uuid primary key default uuid_generate_v4(),
  journey_id uuid references public.client_journeys(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  step text, from_state text, to_state text,
  status text default 'ok' check (status in ('ok','error','skipped','gate')),
  payload jsonb default '{}'::jsonb, created_at timestamptz default now()
);

-- One autopilot execution
create table public.autopilot_runs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade not null,
  client_id uuid references public.meta_clients(id) on delete cascade,
  journey_id uuid references public.client_journeys(id) on delete set null,
  status text not null default 'running' check (status in ('running','awaiting_approval','done','failed','cancelled')),
  current_step text, steps jsonb default '[]'::jsonb, result jsonb default '{}'::jsonb,
  error text, created_at timestamptz default now(), updated_at timestamptz default now()
);
```

**Other tables present** (defined in migrations 002–013, outside the marketing
core): `contacts`, `messages`, `message_series`, `series_messages`,
`scheduled_posts`, `notifications`, `user_settings`, `agency_settings`,
`team_members`, `brief_analyses`, `weak_ad_analyses`, `offer_stacks`,
`landing_pages`, `landing_page_leads`, `pixels`, `ad_performance`, `reports`,
`support_tickets`, `support_messages`, `credit_topups`, `stripe_events`.

> Note: migrations 003, 004, 007, 008 exist in two variants each (e.g.
> `003_messages_and_series.sql` + `003_security_hardening.sql`); the duplicate
> numbering is a known artifact (see §6).

---

## 5. Marketing module

The module is concentrated in `lib/master-studio/`, `lib/judge/`,
`lib/autopilot/`, and the supporting corpora `lib/marketers.ts`,
`lib/frameworks.ts`, `lib/scoring.ts`, `lib/ai-context.ts`, `lib/journey.ts`. Its
HTTP surface is `app/api/ai/master`, `app/api/ai/score`, and
`app/api/autopilot/*`.

All Claude model IDs are read from environment variables with safe defaults; no
keys appear in source.

### 5.1 Master Studio — best-of-N generation

A four-stage pipeline. Each stage is a pure prompt-compose + parse pair; the
network call is injected as a `StageRunner` so the pipeline is fully unit-testable
without a provider.

**`lib/master-studio/index.ts`** — shared types and parse helpers.

```ts
export interface MasterStudioInput {
  brief: string; brand?: BrandDNA; masterNotes?: string;
  platform: string; tone?: string; type?: string;
  framework?: FrameworkId; hook?: string; locale?: 'he' | 'en' | 'ar';
}

export interface MasterV2Output {
  avatar: AvatarProfile | null;
  marketers: MarketerPick[];                                  // survivors that competed
  winner: { marketer: MarketerPick; draft: VariantDraft; score: number };
  scores: VariantScore[]; judgeRationale: string; boosted: boolean;
}

export const SCORE_DIMS = ['hook_strength','clarity','emotional_resonance',
  'cta_strength','brand_fit','awareness_match','framework_adherence'] as const;

export function xt(raw: string, tag: string): string;          // extract [TAG]…[/TAG]
export function parseKeyValueBlock(block: string): Record<string,string>;
export function parsePrinciples(block: string): PrincipleApplied[];
export function parsePostTags(raw: string): VariantDraft | null; // shared by creator+editor
```

**`lib/master-studio/pipeline.ts`** — the orchestration. `BOOST_THRESHOLD = 80`.

```ts
export type StageRunner = (system: string, user: string, maxTokens: number) => Promise<string>;
export type PipelineResult =
  | { ok: true;  output: MasterV2Output }
  | { ok: false; reason: 'strategist' | 'creators' | 'judge' };

export async function runMasterPipeline(
  input: MasterStudioInput, run: StageRunner,
): Promise<PipelineResult>;
```

Flow: **A.** strategist → 3 ranked marketers (fail if 0). **B.** creators run in
parallel, one post each; need ≥2 survivors. **C.** judge scores survivors and
picks a winner. **D.** if the winner's score `< 80`, an editor pass attempts a
boost (falls back to the original on failure).

**`lib/master-studio/strategist.ts`** — chooses 3 of 12 marketers and drafts a
target avatar.

```ts
export function composeStrategistPrompt(input: MasterStudioInput): { system: string; user: string };
export function parseStrategist(raw: string): StrategistResult;   // { avatar, ranked: MarketerPick[] }
```

Robustness detail — `parseStrategist` validates IDs against the corpus, dedupes,
and **pads to exactly 3** from the corpus head so best-of-3 is always guaranteed:

```ts
// Pad to exactly 3 from the corpus head so best-of-3 is guaranteed.
for (const m of MARKETERS) {
  if (ranked.length === 3) break;
  if (!seen.has(m.id)) { seen.add(m.id); ranked.push({ id: m.id, name: m.name, emoji: m.emoji, why: '' }); }
}
```

**`lib/master-studio/creator.ts`** — one marketer writes one post, honoring a
forced framework/hook if supplied, under a strict `[POST]/[HASHTAGS]/…` contract.

```ts
export function composeCreatorPrompt(
  input: MasterStudioInput, marketer: Marketer, avatar: AvatarProfile | null,
): { system: string; user: string };
export function parseCreator(raw: string): VariantDraft | null;
```

**`lib/master-studio/judge.ts`** — scores each variant 0–100 across `SCORE_DIMS`,
returns strict JSON, and self-heals an invalid `winner_index`.

```ts
export function composeJudgePrompt(variants: JudgeVariant[], input: MasterStudioInput): { system: string; user: string };
export function parseJudge(raw: string, variantCount: number): JudgeResult | null;
```

```ts
// If the model's winner_index is not a real variant index, fall back to top score.
let winnerIndex = Number(obj.winner_index);
const valid = scores.some(s => s.index === winnerIndex);
if (!valid) winnerIndex = scores.reduce((best, s) => (s.score > best.score ? s : best), scores[0]).index;
```

**`lib/master-studio/editor.ts`** — conditional boost; rewrites the winner to
strengthen its 3 weakest dimensions while preserving voice/framework/notes.

```ts
export function composeEditorPrompt(
  draft: VariantDraft, marketer: MarketerPick | Marketer, score: VariantScore, input: MasterStudioInput,
): { system: string; user: string };
export function parseEditor(raw: string): VariantDraft | null;
```

**`lib/marketers.ts`** — corpus of **12 master copywriters** (Schwartz, Ogilvy,
Hopkins, Halbert, Caples, Sugarman, Kennedy, Brunson, Hormozi, Carlton,
Bencivenga, Cialdini). Each record carries archetype, `best_for`, default
framework, principles, signature moves, examples, and voice notes.

```ts
export interface Marketer {
  id: MarketerId; name: string; era: string; emoji: string; archetype: string;
  best_for: string[]; framework_default: FrameworkId;
  principles: string[]; signature_moves: string[];
  examples: { headline: string; why_it_works: string }[]; voice_notes: string;
}
export const MARKETERS_BY_ID: Record<MarketerId, Marketer>;
export function marketerToPromptBlock(m: Marketer): string;   // ~200-token block for the system prompt
```

**`lib/frameworks.ts`** — **8 copywriting frameworks** (PAS, AIDA, BAB, FAB, 4Ps,
QUEST, Story, AICPBSAWN). Each injects its structure into the system prompt under
the shared output contract.

```ts
export interface Framework { id: FrameworkId; name_he: string; name_en: string;
  emoji: string; description: string; structure: string[]; prompt: string; }
export const FRAMEWORKS_BY_ID: Record<FrameworkId, Framework>;
export function composeSystemPrompt(opts: {
  framework: FrameworkId; platform: string; tone: string; type: string; hook: string;
  locale?: 'he'|'en'|'ar';
}): string;
```

### 5.2 Performance Score

**`lib/scoring.ts`** — composes a strict-JSON scoring prompt and parses/validates
the response (range checks, defaults, derived `band`).

```ts
export type ScoreChannel = 'meta_feed'|'meta_story'|'meta_reel'|'google_search'
  |'google_display'|'email'|'sms'|'landing'|'tiktok';

export interface ScoreInput { copy: string; channel: ScoreChannel;
  locale?: 'he'|'en'|'ar'; brand?: BrandDNA; audience_segment?: {...}; }

export interface ScoreResult { score: number; band: 'low'|'mid'|'high';
  demographics: { age: Record<string,number>; gender: { m: number; f: number } };
  emotions: string[]; extracts: {...}; policy_flags: Array<{...}>;
  predicted_hook: '...'; }

export function composeScorePrompt(input: ScoreInput): { system: string; user: string };
export function parseScoreResponse(raw: string): { ok:true; value:ScoreResult } | { ok:false; error:string };
```

`band` is always derived from the numeric score, never trusted from the model:

```ts
function deriveBand(score: number): ScoreBand {
  if (score < 40) return 'low';
  if (score < 70) return 'mid';
  return 'high';
}
```

Supporting heuristics live in `lib/policy-rules/meta.he.ts` and
`lib/policy-rules/google.he.ts` (`matchMetaPolicy` / `matchGooglePolicy`),
merged with the model's `policy_flags`.

### 5.3 System-wide Judge

**`lib/judge/index.ts`** — a single weighted LLM evaluation used as the autopilot
gate. **Never throws** — any provider/parse failure degrades to a `revise`
verdict so the pipeline asks a human rather than silently approving.

```ts
// dimension weights
const WEIGHTS = { practical: 0.4, operational: 0.3, managerial: 0.2, design: 0.1 };

export async function evaluate(supabase: SupabaseClient, input: JudgeInput): Promise<JudgeVerdict>;
// JudgeVerdict = { scores, overall, verdict: 'approve'|'revise'|'reject', rationale, flags }
```

A practical score supplied by the caller (e.g. the performance score) overrides
the model's own practical estimate.

### 5.4 Autopilot orchestration

**`lib/autopilot/types.ts`** — the step contract and ordered pipeline.

```ts
export type StepName = 'generate'|'score'|'judge'|'approval'|'targeting'|'launch'|'insights'|'recommend';
export const PIPELINE: StepName[] = ['generate','score','judge','approval','targeting','launch','insights'];
export interface StepResult { ok: boolean; gate?: boolean; data?: Record<string,unknown>; error?: string; }
```

**`lib/autopilot/orchestrator.ts`** — runs each step, threads an accumulator,
records progress to `autopilot_runs`, transitions the journey, and **stops at the
human-approval gate**. Resumable from any step.

```ts
export interface RunOutcome { status: 'awaiting_approval'|'done'|'failed';
  stoppedAt: StepName | null; steps: RunStepRecord[]; error?: string; acc: Record<string,any>; }

export async function runAutopilot(rc: RunCtx, fromStep?: StepName): Promise<RunOutcome>;
export async function startRun(rc, opts?: { fromStep?: StepName }): Promise<RunOutcome>;
```

**`lib/autopilot/steps.ts`** — thin adapters over existing routes/lib fns:
`generate` (→ `/api/quick-campaign`), `score` (→ `/api/ai/score`, picks the best),
`judge` (in-process `evaluate`), `approval` (inserts a pending `approvals` row and
sets `gate: true`). `targeting` / `launch` / `insights` call Meta routes that live
on a separate branch and **degrade gracefully to "deferred"** when absent (see §6).

### 5.5 Shared context & journey

**`lib/ai-context.ts`** — `buildAiContext(...)` assembles Brand DNA
(`users.brand`) + active Meta client + the matching brief into one prompt block,
prepended to every AI route's system prompt.

**`lib/journey.ts`** — the per-client state machine (`getJourney`,
`ensureJourney`, `transition`, `logEvent`) over `client_journeys` /
`journey_events`, plus Hebrew next-best-action labels driving the cockpit.

### 5.6 HTTP entry point (representative)

`app/api/ai/master/route.ts` ties it together: auth → rate-limit (10/min/user) →
build context → **deduct 6 credits up front** → run the pipeline with an
Anthropic-backed `StageRunner` → **refund on any failure** → best-effort persist
to `generated_content`. Credit cost is centralized in `types/index.ts`
(`CREDIT_COSTS`, e.g. `master_post: 6`, `score`, `refine: 4`, `funnel: 12`,
`campaign: 15`, `series: 20`). Models are env-driven:
`CLAUDE_MODEL` (master), `CLAUDE_SCORE_MODEL`, `CLAUDE_JUDGE_MODEL` — all with
in-code defaults and **no committed keys**.

---

## 6. Current state

### Works today (verified)

- **Master Studio best-of-N** pipeline is complete and **unit-tested end to
  end** with an injected runner (strategist → creators → judge → conditional
  editor), including guaranteed-3 padding, judge JSON self-healing, and
  boost-threshold logic.
- **Performance Score** generation + parsing, including band derivation,
  histogram defaults, and policy-flag merging.
- **System-wide Judge** with fail-safe `revise` fallback.
- **Autopilot** runs `generate → score → judge → approval` and **stops at the
  human-approval gate**; runs are persisted and resumable; the per-client
  **journey** state machine and cockpit next-actions are wired.
- **Credit system**: atomic `deduct_credits` RPC, `refund_credits` on external
  failure, per-action costs centralized in `types`.
- **Public client-approval portal** (`/approve/[token]`) and **brief intake**
  (`/brief`) flows.
- **Test suite green:** `vitest run` (excluding the live test) — **9 files / 42
  tests passing** at time of writing.

### Known gaps, deferrals, and risks

- **Meta launch chain is deferred.** `autopilot/steps.ts` `targeting`, `launch`,
  and `insights` call `/api/meta/targeting|launch|ad-insights`, which live on a
  separate `feat/meta-ads-launcher` branch not present here. They **404 today and
  degrade to `deferred_until_meta_merge`** rather than failing — so an autopilot
  run completes only *up to* the approval gate end-to-end; actual ad launch and
  live insights are not yet functional in this branch.
- **`launched_ads` table is on another branch.** `client_journeys.launched_ad_id`
  and related fields are intentionally **soft references** (no FK) pending that
  merge.
- **Team invitations are stubbed.** `app/api/team/route.ts` has
  `// TODO: Send invitation email via Resend/SendGrid` — invites are created but
  no email is sent.
- **Duplicate-numbered migrations.** `003`, `004`, `007`, `008` each exist as two
  files (feature vs. security/backfill). Several `*_backfill_*` migrations
  (`007`, `008`, `010`) exist specifically to repair objects missed by earlier
  runs — a documented migration-numbering issue. A consultant should treat the
  applied DB state, not file order, as source of truth, and review whether all
  backfills have been applied to production.
- **Meta client tokens stored in a `text` column.** `meta_clients.token` is
  plaintext in the schema; both `001` and the README flag that **Supabase Vault**
  (or app-level encryption via `lib/crypto.ts`) should be used in production. A
  `lib/crypto.ts` helper exists but verify it is actually applied on this path.
- **Brand ↔ brief linkage is heuristic.** `ai-context.ts` matches a brief to a
  client by substring match on business name (`biz_name` ⊇ client name) when no
  explicit `brief_id` is given — fragile for similarly-named clients.
- **DDL is applied manually** (no automated migration runner wired); schema drift
  between environments is a standing risk. `scripts/db-drift-check.mjs` exists to
  help detect it.
- **Image generation depends on a Vertex AI service account.**
  `lib/vertex-ai.ts` requires `GOOGLE_SERVICE_ACCOUNT_JSON` (value `[REDACTED]`);
  without it, image generation throws at call time (text generation is
  unaffected).

---

*Prepared for external review. No secrets, keys, tokens, connection strings, or
real user/customer data are included; sensitive values are shown as `[REDACTED]`
and examples use dummy data.*
