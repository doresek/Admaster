# CLAUDE.md — AdMaster Pro working rules

Repo: AI-marketing SaaS (Next.js 15 + React 19, Vercel + Supabase `racywcnflunsdyxbmlms`). Hebrew-first RTL. Free-tier Supabase auto-pauses (NXDOMAIN/HTTP 521 = wake it, not a bug).

## Hard safety rules
- **Money gate:** nothing spends, publishes live, or unpauses without the explicit gates (`LIVE_PUBLISH_ENABLED`, autonomy policy, dry_run). Every campaign path defaults `dry_run=true`, Meta objects `PAUSED`.
- **Self-campaign** (client `62dce105-…`) stays **PAUSED** — never touch it.
- **Migrations:** additive → apply + self-verify; destructive → show the owner first. Never renumber.
- **Verify before push:** tsc + tests + build before every push. Never push red.

## Token-efficiency rules (STANDING — apply in every session and every sub-agent)
1. **Docs are the source of truth.** Read the spec/task/status docs (`docs/EXECUTION-STATUS.md`, `docs/ORGANIC-MARKETING-SPEC.md`, `docs/ORGANIC-TASKS.md`, `docs/CLIENT-UX-PLAN.md`, `docs/AI-MARKETER-MASTERPLAN.md`) — not a full repo exploration. If the docs answer it, don't re-derive it from code.
2. **Sharp task briefs for sub-agents:** exact goal, exact folders owned, the actual contracts/interfaces pasted into the prompt, definition of done, what NOT to touch. An agent should never have to explore the repo to understand its task.
3. **Plan before code:** short design first (data flow, files, edge cases), build once. No build-fail-rebuild as discovery.
4. **Targeted reads:** grep/search to the exact spot; read only the relevant section of big files; never re-read what the docs already summarize.
5. **Don't rebuild what exists:** check the task file + `lib/` for existing utilities first (e.g. `lib/meta-publish`, `lib/ai-context`, `lib/campaigns/store`, `lib/intelligence`). Reuse > rewrite.
6. **Lean output:** short factual reports (status-table style); code goes in commits, not chat; no long recaps.
7. **One verification gate per unit:** full gate (tsc + suite + build) at integration points only; targeted test runs while iterating.
8. **Update status docs immediately on completion** (task file status column, EXECUTION-STATUS session entry) — that's what saves future sessions from re-investigating.

## Organic track working rule
Before ANY organic-marketing task: read `docs/ORGANIC-MARKETING-SPEC.md` + `docs/ORGANIC-TASKS.md` first, work only from the task file, and update its status column on completion. The task file is the single source of truth for that track — no re-discovering context.

## Conventions
- Active client: `ClientProvider` / `useActiveClient()` is the single source of truth; no per-screen client pickers (see `docs/CLIENT-UX-PLAN.md` §client-context propagation).
- Campaign lifecycle: `lib/campaigns/state.ts` is the only status vocabulary (10 states). Every campaign/decision row carries `grounded_in` atom ids + a Hebrew `rationale`.
- Long LLM routes: `export const runtime='nodejs'; export const maxDuration=300;` (prevents retry-duplication).
- Next 15: `cookies()`/`params` are async; `createClient()` (supabase server) is async.
- npm installs need `--legacy-peer-deps` (lucide-react peer range under React 19).
