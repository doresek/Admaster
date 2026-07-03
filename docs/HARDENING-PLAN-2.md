# AdMaster Pro — Hardening Plan #2 (capability layer)

> Remediation for `docs/SECURITY-AUDIT-2.md`, critical-first, disjoint folders for parallel agents. Additive/idempotent migrations shown as SQL then applied; no destructive ops; money gate untouched.

## Collision map
```
HIGH (fix now — Part 1)
 H-A  app/api/voc/route.ts · app/api/competitor-watch/route.ts · lib/competitor-watch/{run-watch,fetcher}.ts   → F1, F2
 H-B  supabase/migrations/045_heartbeat_claim_uniq.sql(new) · lib/heartbeat/ledger.ts                          → HB-1 (=Part2 #4)
 H-C  lib/voc/ingest.ts · lib/voc/pii.ts · supabase/migrations/046_voc_pii.sql(new)                            → PII-1, PII-2

MED/LOW (follow-up)
 M-D  lib/voc/reconcile.ts (require corroboration before atom-erasure)                                          → F4
 M-E  lib/episodic/store.ts (tenant-scope upsert key) · match_episodes k-floor                                  → EP-2, EP-3
 L-F  require-owned-client + inline checks add .eq('owner_user_id') · constant-time CRON compare · vercel.json  → L-owner, HB-2/3/4, L2
```

## Wave H (HIGH — Part 1, disjoint)
### H-A — Cost/DoS gates on the new LLM routes (F1, F2)
Owns: `app/api/voc/route.ts`, `app/api/competitor-watch/route.ts`, `lib/competitor-watch/run-watch.ts`, `lib/competitor-watch/fetcher.ts`.
- Add `checkRateLimitDurable` (per-user) + `deductCredits` (refund on failure) to both POST routes, matching `app/api/ai/master/route.ts`.
- Cap ads-per-paste: `MAX_ADS_PER_RUN` (e.g. 40) in `runWatch`/`parsePastedAds`, `log()` the dropped count. Bounds the fan-out regardless of the credit gate.

### H-B — Heartbeat claim unique index (HB-1)
Owns: `supabase/migrations/045_heartbeat_claim_uniq.sql` (+ down), `lib/heartbeat/ledger.ts`.
- Migration (additive): add `period_key text` (backfill from existing period fields) + `create unique index ... on heartbeat_runs(client_id, tick_type, period_key) where status in ('claimed','running','succeeded')`. Preflight for existing dupes.
- `claimTick`: set `period_key`, make the INSERT the arbiter — on `23505` return null (lost the claim) instead of check-then-insert.

### H-C — VoC PII at rest (PII-1, PII-2)
Owns: `lib/voc/ingest.ts`, `lib/voc/pii.ts`, `supabase/migrations/046_voc_pii.sql` (+ down).
- Store the **stripped** text in `voc_documents.raw_text` (keep `raw_hash` for dedup); do not persist un-stripped PII.
- Migration: scrub/null existing `raw_text` on any current rows (data-altering UPDATE — **show SQL first**). If prod `voc_documents` is empty, it's a no-op.
- PII-2: broaden name redaction beyond the caller list (regex for common name/contact patterns) as best-effort.

## Wave M/L (follow-up — after Part 1)
- **M-D** F4: in `reconcile.ts`, require ≥2 corroborating signals (or a non-`brief`/`voc` decisive source) before a VoC quote can refute+remove an active atom.
- **M-E** EP-3: tenant-scope the episode upsert conflict key (`client_id, source_kind, source_id`); EP-2: add a k≥N floor to fleet-scope `match_episodes` before any tenant-facing fleet caller is wired.
- **L-F**: add `.eq('owner_user_id', user.id)` to the client-ownership checks; constant-time `CRON_SECRET` compare (`timingSafeEqual`); confirm `CRON_SECRET` set in Vercel Production + add a `crons` entry to `vercel.json`; drop the dead `anon` grant on `match_episodes`.

## Gates
Migrations 045 (additive/idempotent) → apply after showing SQL. 046 contains a data-altering UPDATE (scrub existing `raw_text`) → **show SQL first, apply only on OK**. Money gate untouched by every task.
