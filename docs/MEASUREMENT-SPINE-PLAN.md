# MEASUREMENT SPINE — the plan (for owner approval before building)

> **What this is.** The build plan for Track #1 — attribution + full-funnel tracking + unit economics. The dashboards (`DASHBOARD-ARCHITECTURE.md`) SIT ON this: a dashboard can only show what we measure. Research basis: the 2026 attribution sweep (cited in `PERFECT-MARKETER-ROADMAP.md` D8) — key verdicts: cross-channel MTA is dead; the working 2026 pattern is **honest click-attribution + CRM ground truth + periodic experiments** ("triangulation-lite"); Meta CAPI is free/one-click since 4/2026; `ctwa_clid` is the only thing that makes WhatsApp-first funnels attributable; GA4 DDA silently degrades to last-click at SMB volumes.

## 1. The attribution model (decided by what's technically real in 2026)
**Model: labeled last-click attribution over captured click IDs, reconciled against CRM truth, calibrated by experiments.** Explicitly NOT multi-touch (unbuildable honestly — only ~30–60% of journeys are observable), NOT MMM (needs $100k+/yr multi-channel), NOT trusting platform numbers (Meta over-reports ~15–20% vs CRM).
- Every conversion carries its **source chain**: ad→click ID→LP→lead→stages→sale.
- Every number in the UI is **labeled**: "מבוסס קליקים" — honesty is the differentiator vs tools selling certainty.
- Platform-claimed vs our-truth divergence is itself a tracked metric (the reconciliation ratio, per channel; alert >2× = broken dedup).

## 2. What it tracks end-to-end (the funnel spine)
```
impression/spend (platform APIs — H4 flip)          [gated: live ads]
  → click (fbclid/gclid/utm_content=item_id)        [buildable NOW]
  → LP visit (visit row: ids, referrer, page)        [NOW — /lp middleware]
  → lead (leads row + lead_touchpoints: ALL ids,     [NOW]
     incl. Meta lead_id for instant forms,
     ctwa_clid from the WABA referral webhook)       [ctwa_clid gated: C2/Cloud API]
  → stages (lead→qualified→meeting→closed±value)     [NOW — owner one-tap marks
     via command center + digest + WhatsApp reply]
  → sale value → unit economics                      [NOW — needs owner inputs]
  → feedback to platforms (CAPI offline events;      [gated: live + volumes;
     Conversion Leads Optimization at ≥200/mo]        CLO ≥200 leads/mo]
```
**Campaign linkage:** `utm_content={campaign_item_id}` (already the LP-scent design) keys every visit/lead to the exact ad + its atoms — attribution reaches the BRAIN, not just the channel.

## 3. Schema (additive; numbers coordinated with the security session at build)
- `lead_touchpoints` — lead_id FK, {fbclid, gclid, ctwa_clid, meta_lead_id, utm_*, landing_path, referrer, first_seen}; RLS owner-only.
- `lead_stages` — append-only events: lead_id, stage (new|qualified|meeting|closed_won|closed_lost|irrelevant), value, marked_via (ui|digest|whatsapp), created_at. (Absorbs/extends the C-13 `lead_outcomes` spec — one table, not two.)
- `client_economics` — client_id unique: contribution_margin_pct, avg_deal_value, close_rate (seeded by owner, updated from actual closed data), payback_target_months (default 6), currency. → break-even ROAS = 1/CM computed, never asked.
- `channel_reconciliation` — client_id, channel, period, platform_claimed, crm_truth, ratio.
- Existing tables carry the rest (`leads`, `content_performance`, `campaign_items`).

## 4. How it feeds everything
- **Dashboards:** every number the 3 dashboards show comes from this spine (leads by source with real cost, margin-aware ROAS vs break-even, funnel-stage drop-offs, reconciliation honesty note).
- **Learning loop:** closed_won/lost/irrelevant = E5/E3-grade signals (BRAIN-DEEPENING U2) onto the audience/angle atoms behind the lead's source item — the loop finally reaches money. Verdicts (C-01) can use CVR-to-SALE, not just to-lead.
- **Budget allocation:** C-11 allocator + heartbeat proposals gain `valueWeight` from economics (LTV-ish per audience) + the 4:1 / ≤6-month payback gates; the digest reports "מעל/מתחת לנקודת האיזון" instead of naked ROAS.
- **Platform feedback (when gated items clear):** stage events → CAPI offline/CLO → Meta optimizes toward QUALITY leads (≈15% cheaper quality leads at ≥200/mo).

## 5. Buildable NOW vs gated
| NOW (no external dependency) | Gated (on what) |
|---|---|
| L0 click-ID capture middleware (/lp + site + forms), lead_touchpoints | live impressions/spend (H4 flip) |
| lead_stages + one-tap marks (command center, digest, WhatsApp-reply parsing design) | ctwa_clid capture (C2 — WABA Cloud API webhook) |
| client_economics + break-even/payback engine (pure functions + owner onboarding Qs) | CAPI live events + EMQ monitoring (needs live pixel traffic) |
| reconciliation math + honest labeling | CLO (≥200 leads/mo/client) · incrementality reads (~1,000 conv/window) |
| GA4 utm channel conventions; digest wiring | value-based platform feedback (needs closed-won history) |

## 6. First build steps (on approval — own branch, disjoint from the security session)
1. Migration (touchpoints, stages, economics, reconciliation) — additive, applied+verified per house rule.
2. Capture layer: /lp + site-form middleware persisting IDs; `utm_content` conventions enforced in the runner/scent engine.
3. `lib/economics` pure core (break-even ROAS, value-per-lead, payback, gates) + owner onboarding inputs (3 questions in Hebrew).
4. Stage-marking surfaces: command-center lead list one-tap + digest approvals-style marks; WhatsApp reply parsing specced for C2.
5. Reconciliation job (heartbeat monthly) + honest labels in every consumer.
6. Wire to brain (U2-graded signals) + allocator + digest. Full gate discipline throughout (tsc/tests/build; branch always green).
**Estimated effort: steps 1–3 ≈ one wave (M); 4–6 ≈ one wave (M).** Nothing here touches the security session's folders (its cluster = approvals/publish/create/series UI + master-studio; ours = lib/economics, lib/measurement, /lp middleware, migrations).

*Plan only — build starts on your approval.*
