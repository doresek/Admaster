# AdMaster Pro — Security Audit #2 (capability layer PR #44/#45)

> **Scope.** Adversarial audit of everything shipped in PR #44 + #45 on `main` @ `b569c3d`: capabilities C-01/02/03/06/07/08/10, the Marketing Heartbeat, the 3 autonomy modes, digest, competitor watch, shock detection, experiment portfolio, VoC, episodic memory, fleet — and migrations 034–044. Four parallel auditors on disjoint areas (RLS/IDOR · heartbeat/autonomy/money · prompt-injection/cost · integrity/PII/races).
> **Method.** Deep static review + read-only prod-schema/RLS probes via psql (no prod mutation) + proof reasoning. `npm run type-check` clean; migrations 034–044 confirmed applied to prod.
> **Date:** 2026-07-04. **Status:** all CRITICAL+HIGH fixed (see `docs/HARDENING-PLAN-2.md`).

---

## 0. Headline

**The new layer is well-built and tenant-safe.** RLS is owner-only on all 13 new tables (verified against applied prod state); prompt injection is properly fenced + output-gated on all three new LLM paths; and — most importantly — **the autonomy/money gate holds**.

### 💰 AUTONOMY / MONEY-GATE VERDICT — holds
No cron / heartbeat / autonomy path can spend real ad money or flip a Meta object ACTIVE. Five independent gates, any one sufficient: (1) the only heartbeat "execute" leaf is `create_paid_paused → runCampaign`, hard-coded `dryRun=true` (`lib/campaigns/runner.ts:220`); (2) no unpause/activate method exists in `lib/meta-ads/**`; (3) PAUSED-always in `publish.ts`; (4) `LIVE_PUBLISH_ENABLED` gates the sole live caller (an owner route, not heartbeat-reachable); (5) autonomy routing — Modes 1/2 never yield `execute` for money kinds, and config-drift/audit-loss both fail toward *proposing*. Cron trigger is `CRON_SECRET`-gated, fail-closed. **No CRITICAL and no HIGH in the money path.**

**No CRITICAL findings. 4 HIGH (cost/DoS + privacy + a pre-live race). MED/LOW below.**

---

## 1. Findings

| # | Sev | Area | Finding | Location |
|---|-----|------|---------|----------|
| **F1** | 🟠 HIGH | Cost/DoS | competitor-watch `paste` fans out **unbounded** LLM decode calls — a 30k paste of many tiny ads → ~350 Sonnet calls in one POST, loopable, no cap | `lib/competitor-watch/fetcher.ts:102`, `lib/competitor-watch/run-watch.ts:130` |
| **F2** | 🟠 HIGH | Cost/DoS | `/api/voc` POST and `/api/competitor-watch` paste call Anthropic with **no `deductCredits` and no rate limit** (the S6 pattern repeated) | `app/api/voc/route.ts`, `app/api/competitor-watch/route.ts` |
| **HB-1** | 🟠 HIGH | Race | Heartbeat `claimTick` is check-then-insert with **no unique constraint** on `(client_id, tick_type, period)` → two concurrent triggers double-run a tick (dup hypotheses/proposals, corrupt ledger; a double-action vector the moment any live producer + concurrency coexist) | `lib/heartbeat/ledger.ts:99-171` (insert `:157`); mig 039 |
| **PII-1** | 🟠 HIGH | Privacy | VoC persists the **un-stripped** original document (phones/emails/names in plaintext) in `voc_documents.raw_text`; stripping only protects LLM input + stored quotes. Israeli-privacy exposure at rest | `lib/voc/ingest.ts:95` |
| **F4** | 🟡 MED | Integrity | Steered VoC classification: attacker-authored review text drives `polarity`/`target_hint`; a decisive negative quote can **refute+remove** a legit atom (within-tenant) | `lib/voc/reconcile.ts:263-274` |
| **PII-2** | 🟡 MED | Privacy | VoC name redaction is **caller-list-only** — third-party names not in `piiNames` reach the LLM and persist in `voc_quotes.quote` | `lib/voc/pii.ts:44-56` |
| **HB-2** | 🟡 MED | Money (latent) | Heartbeat ticks pass hard-zeroed `spendContext` → if a real spend producer is later added without accumulating spend, daily/monthly caps become per-action instead of per-day | `lib/heartbeat/*` route-and-log |
| **EP-2** | 🟡 MED | Privacy (latent) | Fleet-scope episodic recall (`match_episodes` fleet scope) has **no k-anonymity floor** — could return a single other client's abstracted episode; no tenant-facing `scope:'fleet'` caller wired yet | mig 035:46-67, `lib/episodic/compose.ts:282-300` |
| **EP-3** | 🟡 MED | Integrity (latent) | Episode upsert conflict key `(source_kind, source_id)` is **global, not tenant-scoped** — safe only while source IDs are globally-unique UUIDs; a cross-tenant overwrite trap for future source kinds | `lib/episodic/store.ts:120` |
| **L-owner** | 🟢 LOW | AuthZ | `requireOwnedClient` + competitor-watch/digest/voc inline checks query `clients` by `id` only (no explicit owner filter) — rely solely on `clients` RLS; would fail open if that RLS were dropped | `lib/**/require-owned-client.ts:32`, `digest/route.ts:113`, `voc/route.ts:73` |
| **HB-3** | 🟢 LOW | Auth | Heartbeat `CRON_SECRET` compared with `!==` (non-constant-time) | heartbeat route |
| **HB-4** | 🟢 LOW | Ops | No `crons` key in `vercel.json` — confirm `CRON_SECRET` is set (Production) or the heartbeat can never trigger | `vercel.json` |
| **F3** | 🟢 LOW | Injection | Fence delimiter `>>>` not neutralized in the 3 LLM paths (same as S7) — breakout *attemptable* but output gates make forging impossible | voc/competitor/brand-lint |
| **F5** | 🟢 INFO | XSS (future) | When competitor-watch UI lands, pass paste-derived `landing_url` through `lib/safe-url.ts` (a `javascript:` URI would be clickable XSS) | — |
| **L2** | 🟢 LOW | Hygiene | `match_episodes` has a dead `anon:EXECUTE` grant (harmless: INVOKER + RLS) | mig 035 |

**Counts:** 0 CRITICAL · 4 HIGH · 5 MED · 6 LOW/INFO.

---

## 2. HIGH detail + fix

- **F1 — unbounded competitor-watch fan-out.** `rawText` is capped at 30k chars but `parsePastedAds` splits into an unbounded number of ads and `runWatch` decodes them in batches of 20 with no cap on batch count. `MAX_ACTIVE_ENTITIES=5` caps competitors, not ads-per-paste. **Fix:** cap ads-per-paste (e.g. `MAX_ADS_PER_RUN=40`) with a `log()` of what was dropped; and gate the route (F2).
- **F2 — ungated LLM routes.** `/api/voc` + `/api/competitor-watch` spend Anthropic on user input with no credit deduction and no rate limit — a free-tier user can loop them. **Fix:** add `deductCredits` (refund on failure) + `checkRateLimitDurable`, matching `ai/master`.
- **HB-1 — heartbeat claim TOCTOU.** `claimTick` reads the period then inserts with no unique constraint (prod `heartbeat_runs` has only pkey + non-unique indexes). Two concurrent `runHeartbeat` both claim+run. Blast radius today = duplicate hypotheses/proposals + corrupt ledger; a double-action/double-LLM vector the moment a live producer or concurrency exists (every tick is a designed LLM insertion point). **Fix:** add a `period_key` column + partial unique index on `(client_id, tick_type, period_key) where status in ('claimed','running','succeeded')`, and make the INSERT the arbiter (return null on `23505`). *(This is also Part-2 bug #4.)*
- **PII-1 — raw PII at rest.** `voc_documents.raw_text` stores the original un-stripped document; `raw_hash` already exists for dedup, so `raw_text` isn't needed beyond it. Phones/emails/names retained in plaintext (Israeli privacy). **Fix:** store the **stripped** text in `raw_text` (or stop persisting it and keep only `raw_hash` + stripped quotes). Backfill/scrub existing rows if any.

---

## 3. Verified SAFE (no action)
RLS owner-only + enabled on all 13 new tables (prod-verified: each one policy, `qual`+`with_check` = `auth.uid()=owner_user_id`); `fleet_daily_factors` RLS-on/0-policies = service-role-only, no tenant columns → no leak; `match_episodes` SECURITY INVOKER → RLS applies. Every admin-client query re-scopes by `owner_user_id`; no route trusts a body/query userId. `hypotheses/[id]`, `digest` approve, `autonomy/approve` all owner-scoped (no cross-tenant read/write/approve). Prompt injection fenced + output-gated on all 3 LLM paths; tenant isolation holds (client_id from server, never LLM). Idempotency PASS on: VoC doc ingest, episode upsert, digest (unique + CAS), hypothesis resolution (CAS + at-most-once signal), competitor ads, fleet factors. Type-check clean; migrations 034–044 applied, columns/FKs/cascades correct. No signup-fingerprinting code exists (planned-not-built). No PII in logs.

*Fragments: `scratchpad/audit2/01-04`. Remediation: `docs/HARDENING-PLAN-2.md`.*
