# AdMaster — AutoAds-Parity Improvement Plan (executable roadmap)

> Derived from the live deep-map in `docs/autoads-full-map.md` (gap table §7). This is the roadmap we execute from: pick the next unstarted item, ship it as a PR (branch → self-verify tsc+build+tests → merge when green), migrations applied via the documented flow before merge. Effort: **S** ≤1d · **M** 1–3d · **L** 3–7d (solo-dev, agent-assisted).
> **Cross-refs:** AdMaster current state from `system-overview.md` + this session's merges (#10–#32). AutoAds behavior cited from `autoads-full-map.md`.

## ✅ Where AdMaster is ALREADY AHEAD — do NOT rebuild
- **Marketing strategy depth** — AdMaster's `StrategyAnalysis` (#32: strategic summary + awareness-tagged sub-audience + platform/funnel + offer-stack, on `meta_clients.business_analysis`, read by `buildAiContext`) is **richer than anything AutoAds visibly exposes** (AutoAds = brief + per-ad framework tags + angle memory; no standalone analysis). Keep as-is.
- **Client ROI reporting** — AdMaster has `/report/<token>` share-link + insights sync + ROI framing (#23/#26/#27). AutoAds shows **no** reporting (its "ביצועים" is "בקרוב"). Net advantage; keep.
- **Avatar v2** (#30), **billing portal** (#15), **agency model / connect-link** (#10/#21), **client-core spine** (#17/#18/#19) — all present; not AutoAds gaps.

---

## PHASE A — Front door (contact-first client model) · **P0**

### A1. `/clients` = contact model `[IN PROGRESS — feat/clients-contact-model]`
- **AutoAds:** create form = name(req)+email+phone+company+notes; **no Meta**; dashboard "ניהול לקוחות הארגון"; initials-avatar cards showing contact info + brief-status + "לא מחובר" pill + בריפינג/פתח.
- **AdMaster today:** `/clients` titled "לקוחות Meta"; creation had a Meta-token field; name-only create hit a phantom-token OAuth error.
- **Build:** rewrite `app/(dashboard)/clients/page.tsx` (title "לקוחות", contact form name/phone/email/company, remove token field, contact-style cards) + `app/api/meta/clients/route.ts` (require only name; `if (token && token.trim())` guard; insert identity row `status:'new'`); add `email/phone/company` to `MetaClient` type; Meta = optional `ConnectFacebookButton` card in `ClientWorkspace`.
- **Migration:** **026** (`meta_clients.email/phone/company`, additive) — apply before merge.
- **Deps/order:** none. First. **Effort: M.**

---

## PHASE B — Guided per-client operation · **P1** (highest value after P0)

### B1. Angle memory (per-client, across campaigns) `[NEXT after P0 — user-requested first]`
- **AutoAds:** campaign builder shows "🧠 זיכרון זוויות פעיל - 10 זוויות מקמפיינים קודמים נלקחות בחשבון / מתוך 2 קמפיינים אחרונים" + toggle "אני רוצה זוויות חדשות לגמרי". Used angles persist per client so new campaigns don't repeat.
- **AdMaster today:** master-studio picks frameworks/marketers fresh each time; **no memory of previously-used angles** per client. `generated_content` stores outputs but nothing aggregates "angles used".
- **Build:** persist an angle/framework signature on each generation (extend `generated_content` write or a small `client_angles` table keyed by `client_id`); in `lib/master-studio/strategist.ts` + `app/api/ai/master` / `quick-campaign`, read recent angles for the active client and inject "avoid repeating these angles" into the prompt; add a "זוויות חדשות לגמרי" override flag in `/create` + campaign UI. Surface "N angles remembered from M campaigns".
- **Migration:** **027** — either `client_angles(client_id, angle, framework, created_at)` table, or a `used_angles jsonb` rollup on `meta_clients`. Recommend the table (queryable, append-only).
- **Deps/order:** after A1 (stable client). **Effort: M.**

### B2. Per-client workflow client-home (5-step strip)
- **AutoAds:** `/client-home` = header + **5-step strip** (בריף → יצירת מודעות → דף נחיתה → העלאה במרכז הבקרה → סדרות מסרים, each w/ status + CTA) + 10 quick actions + stat counters + Meta card + brief card.
- **AdMaster today:** generic dashboard + `FirstRunHero` (#20); no per-client guided home; journey state machine exists (`lib/journey.ts`) but isn't surfaced as this strip.
- **Build:** new `app/(dashboard)/clients/[id]/page.tsx` (or client workspace expansion): header (initials+name+company+Meta pill), a 5-step workflow strip driven by `client_journeys` state + brief status + counts, quick-action grid linking to existing generators with `?client=<id>`, the brief card (reuse), the Meta optional card. Reuse `journey.ts` Hebrew next-action labels.
- **Migration:** none (reads existing journey/brief/`generated_content` counts).
- **Deps/order:** after A1. Pairs well with B3. **Effort: L.**

### B3. Ad approval → upload pipeline (draft → send-for-approval → approved → upload)
- **AutoAds:** `ad-review` tabs טיוטה/נדחה/מאושר/מרכז-הבקרה; per-ad "שלח לאישור" (client portal) → approve/reject → "מרכז הבקרה" uploads approved ads to Meta.
- **AdMaster today:** has `approvals` + public `/approve/[token]` + autopilot gate, and a Meta launch chain that's deferred/404 on this branch (`autopilot/steps.ts`). Not wired as a per-ad draft→approve→upload board.
- **Build:** a per-client ad board (`generated_content` of type post/ad) with status draft/sent/approved/rejected; "שלח לאישור" mints an `approvals` row + share link (reuse approval portal); a "control center" view listing approved ads with an "upload to Meta" action calling the Meta launch route (needs the launch chain merged — see dependency). 
- **Migration:** likely **028** — add `status` + `approval_id` to the ad rows (or a `client_ads` view over `generated_content`); confirm at build.
- **Deps/order:** after A1; the upload leg depends on the Meta launch chain (`feat/meta-ads-launcher` #7) being reconciled/merged — flag as sub-dependency. **Effort: L.**

---

## PHASE C — Generation breadth · **P2**

### C1. Angle/template parity in ad generation
- **AutoAds:** 9 named templates — סיפור, אנחנו מול הם, PAS, AIDA, BAB, לוגיקה ישירה, הצעה ישירה וטכנית, TikTok/Reel, עסקים משעממים.
- **AdMaster today:** 8 frameworks (PAS, AIDA, BAB, FAB, 4Ps, QUEST, Story, AICPBSAWN) in `lib/frameworks.ts`.
- **Build:** add the missing angle templates as framework/angle presets: **אנחנו מול הם** (us-vs-them), **לוגיקה ישירה / הצעה ישירה וטכנית** (direct logic/offer), **TikTok/Reel** (video script), **עסקים משעממים** ("boring business" angle-finder). Extend `lib/frameworks.ts` + the `/create` template chips.
- **Migration:** none. **Deps/order:** independent; after A1. **Effort: S–M.**

### C2. One-click full campaign (copy + image + format)
- **AutoAds:** "צור קמפיין שלם" — headline+text+image in one click, N ads (≤10), formats 1:1/4:5/9:16, 3cr/ad.
- **AdMaster today:** master post (copy) + separate image pipeline + quick-campaign; not a single "full campaign with image + format choice" producer.
- **Build:** a `/create` (or campaign) mode that chains master-studio copy → image pipeline per variation with an aspect-ratio selector (1:1/4:5/9:16), producing N complete ads; reuse `runImagePipeline` + `runMasterPipeline`. Credit cost = copy+image.
- **Migration:** none. **Deps/order:** after A1; complements B2. **Effort: M.**

### C3. Copy/label pass to contact-centric Hebrew
- **AutoAds:** client/contact-centric wording throughout.
- **AdMaster today:** Meta-centric labels in places ("לקוחות Meta" fixed in A1; audit the rest).
- **Build:** sweep dashboard/nav/labels to client-centric Hebrew; align nav grouping (כלי יצירה / הגדרות וניהול).
- **Migration:** none. **Deps/order:** after A1. **Effort: S.**

---

## PHASE D — Nice-to-have · **P3**

### D1. "המעבדה" (the Lab) — free remix
- **AutoAds:** mix existing texts+images into new ad combinations, **0 tokens** (Basic+).
- **AdMaster today:** none.
- **Build:** a remix surface pairing saved `generated_content` copy with `generated_images` into new ad combos, no AI call (no credits).
- **Migration:** none. **Effort: M.**

### D2. Messaging-series hub parity
- **AutoAds:** מייל/וואטסאפ/SMS follow-up series hub.
- **AdMaster today:** messages + series exist (`/messages`, `/series`).
- **Build:** parity audit vs AutoAds messaging-hub; ensure per-client scoping + brief grounding. **Migration:** none. **Effort: S–M.**

---

## Dependency / ordering summary
```
A1 (/clients contact, mig 026)  ── done now ──┐
                                              ├─► B1 angle memory (mig 027)         ← NEXT
                                              ├─► B2 client-home workflow strip
                                              ├─► B3 approval→upload (mig 028; needs #7 launch chain)
C1 templates · C2 full-campaign · C3 copy ─ after A1, parallelizable
D1 Lab · D2 messaging parity ─ last
```
- Migrations queue (apply in order, human-applied): **026** (A1, ready) → **027** (B1) → **028** (B3).
- AHEAD items (strategy #32, ROI #26/#27) are explicitly out of scope — keep.

## ▶ Next 3 to build after P0 (A1) merges
1. **B1 — Angle memory** (mig 027) — user-requested first; concrete AutoAds feature we lack; **M**.
2. **B2 — Per-client workflow client-home** (5-step strip) — the guided operating surface; **L**.
3. **B3 — Ad approval → upload pipeline** — closes the loop to publish; **L** (sub-dep: reconcile `feat/meta-ads-launcher` #7 for the upload leg).

*Docs only — no code changed by this plan. Execution happens per-item as PRs.*
