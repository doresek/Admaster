# AdMaster Pro — Master Plan

> **Grounding:** every major claim below is sourced to a doc already in this repo or to verified code/PR/migration state. No new research; no invention. Sources cited inline as `[strategy-brief]`, `[connection-model]`, `[core-spine]`, `[attribution]`, `[autoads-flow]`, `[audit]` (the 7-blocker launch-readiness audit), and `[code]` / `[gh]` for inspected repo state.
> **Inspected state (this pass):** open PRs #10/#11/#12 (+#7, #5); migrations across all worktrees; the two design docs in full.
> **Scope:** planning only — no code touched.

---

## 1. Vision & Positioning

**What AdMaster is** `[strategy-brief §2]`
> A Hebrew-native performance-marketing platform for **Israeli digital agencies and freelance marketers who run Meta ads for several SMB clients** — it turns a client brief into ads, publishes them, and proves the ROI back to the client, one client workspace at a time.

**The buyer is the agency/freelancer, not the SMB owner** `[strategy-brief §1 Verdict C]` — confidence *medium*: direction resolved (a dense, confirmed IL agency/freelancer layer with retainer-based, multi-client Meta management whose pains — per-client manual multiplication, multi-account access handoff, manual reporting — map onto a per-client tool), magnitude unproven (every "% of SMBs who outsource" stat was **refuted**; do not cite one). SMB-owner self-serve is a possible *second* motion, not the wedge.

**The 3 winning pains to own** `[strategy-brief §1]`
1. **Client reporting & ROI proof** — highest-sourced pain; the agency's retention lever (70% rate reporting "extremely important" for retention).
2. **Hebrew-native ad *execution* across multiple client accounts** — generic Hebrew content is taken (Kolbo.AI, Poly); dedicated Hebrew ad-ops is open.
3. **Ease-of-use + billing trust** — counter-positioning vs GoHighLevel overwhelm and AdCreative.ai billing distrust.

**Why this matters for the plan:** the buyer verdict **clears the §0 gate** in `[connection-model]` ("do not build until the buyer-identity verdict confirms the agency model"). The agency model is now the target — the `meta_connections` split and the session-less client-connect link are in-scope, not speculative.

---

## 2. Current State — Honest Inventory

### ✅ Built / working `[code, attribution]`
- **Client identity + brief + manual avatar + AI grounding spine.** `meta_clients` is the client entity; `briefs` link by `client_id` (`014`); `buildAiContext()` grounds generators in active client + latest brief + avatar text `[core-spine §0]`.
- **Generators** for posts, campaigns, emails/SMS/WhatsApp, landing pages, images — all read `buildAiContext()` `[core-spine §3.2]`.
- **Per-client analytics table** `ad_performance` (`002`), populated mandatorily, client+date scoped `[attribution]`.
- **Token encryption** (`003`, AES-256-GCM via `lib/crypto`) + backfill script `[connection-model §1]`.

### 🟡 Half-built — three open PRs (all `MERGEABLE`) `[gh]`
| PR | Branch | State | What it does | Builds toward |
|---|---|---|---|---|
| **#12** | `feat/create-uses-brief` | open, +322/−5 | `/create` generates from stored client brief + avatar via `buildAiContext` | Pain #2; is the base the core-spine generalizes `[core-spine §4]` |
| **#11** | `feat/brief-magic-link` | open, +647/−219 | brief sharing via 64-hex crypto token (`018_brief_code_token`) | The reusable magic-link pattern the connect-link copies `[connection-model §3]` |
| **#10** | `feat/meta-oauth` | **DRAFT**, +532/−0 | per-client Meta OAuth connect; writes token onto `meta_clients` | Pain #2 execution; **needs re-pointing to `meta_connections` before merge** `[connection-model §4]` |

*(Also open: #7 `feat/meta-ads-launcher`, #5 `design/visual-refresh` — not on the critical path; fold #5 into "polish".)*

### 🔴 Broken / incomplete — the 7 launch blockers `[audit]`
Email/SMTP · password reset · Stripe · post-signup UX · Meta OAuth wiring · create-post 502 · polish. Plus two concrete warts found in code: **billing deduct-before-validate with no refund** on two `/api/tools` paths `[attribution §3]`, and **attribution dropped at persistence** for images/posts-via-`/api/ai`/leads `[attribution §1]`.

### ⚫ Missing entirely
- **Client ROI / reporting (Pain #1) — ZERO product coverage** `[strategy-brief §4]`. The schema actively can't support it yet `[attribution]`: `ad_performance` is **account+date level, no `ad_id`**; posts/images/leads attribution is null-in-practice ("resolve client → feed AI → drop at persistence"); no client-facing report surface exists.
- **`meta_connections` agency model** — design complete, **no code/migrations written** `[connection-model §0]`.
- **Client core spine** (analysis + structured avatar on the client) — design complete, not built `[core-spine]`.
- **WhatsApp-aware funnel, Meta-account monitoring layer, Hebrew/RTL quality bar** — strategy-implied, not in any audit `[strategy-brief §4]`.

---

## 3. Gaps → Phased Backlog

Effort key: **S** ≤1d · **M** 1–3d · **L** 3–7d · **XL** 1–2wk (solo-dev scale, design-doc-assisted).

### Phase 0 — Land what's already done
| Item | What | Why (pain / money) | Effort | Deps | Source |
|---|---|---|---|---|---|
| 0.1 Merge #12 | `/create` from stored brief+avatar | Pain #2; makes `buildAiContext` the merged shared loader the spine extends | S | — | `[core-spine §4]` |
| 0.2 Merge #11 | brief magic-link | Unlocks the connect-link pattern reuse | S | — | `[connection-model §3]` |

### Phase 1 — Charge money (revenue gate) `[audit]`
| Item | What | Why | Effort | Deps | Source |
|---|---|---|---|---|---|
| 1.1 Email/SMTP | transactional email | Blocks signup confirm + password reset + report delivery | M | — | `[audit]` |
| 1.2 Password reset | full reset flow | Auth completeness | S | 1.1 | `[audit]` |
| 1.3 Post-signup UX | first-run onboarding | Pain #3 (anti-overwhelm); agency-led "add your first client" | M | — | `[audit][strategy-brief §4]` |
| 1.4 Stripe + **transparent billing** | subscribe/cancel/downgrade, obvious self-serve cancel | Money gate **and** Pain #3 trust (anti-AdCreative). Also fix deduct-before-validate refund wart | L | 1.1 | `[audit][strategy-brief §3][attribution §3]` |
| 1.5 create-post 502 fix | stop the 502 on create | Pain #2 — a broken "close the loop" kills the value prop | S–M | — | `[audit][strategy-brief §4]` |

### Phase 2 — The differentiator: execution + proof
| Item | What | Why | Effort | Deps | Source |
|---|---|---|---|---|---|
| 2.1 `meta_connections` split | `019` table+RLS+backfill, `020` connect-token | Agency model spine; one client → 0..n connections | L | gate clear ✅, migration # | `[connection-model §2]` |
| 2.2 Re-point #10 → `meta_connections` | callback INSERT into connections, not UPDATE `meta_clients`; then un-draft + merge | Pain #2; avoids merge-then-migrate | M | 2.1 | `[connection-model §4]` |
| 2.3 Session-less client-connect link | `/connect/<token>` mirrors brief magic-link; client authorizes own Meta | Agency buyer: client connects own account, agency never holds FB password | L | 2.1, 0.2 | `[connection-model §3][autoads-flow]` |
| 2.4 Client core spine | `021_client_core` (analysis+avatar JSONB on client); post-brief orchestrator; extend `buildAiContext` | Pain #2 quality — durable per-client core every generator reads | XL | 0.1, migration # | `[core-spine §1–3]` |
| 2.5 **Client ROI / reporting (Pain #1)** | per-client report surface + fix attribution capture (persist `client_id` on posts/images/leads); decide `ad_id` modeling | **#1 winning pain, zero coverage today**; the agency's deliverable-to-client | XL | 2.1, schema work | `[strategy-brief §4][attribution §1–2]` |

### Phase 3 — Strategy-implied, not yet in any audit `[strategy-brief §4]`
| Item | What | Why | Effort | Source |
|---|---|---|---|---|
| 3.1 Hebrew/RTL quality bar | enforce Hebrew output quality (esp. text-in-image) | Pain #2 defensibility vs English-first tools | M | `[strategy-brief §1 B]` |
| 3.2 WhatsApp-aware funnel | WhatsApp as share/funnel channel (reuse `whatsappShareLink`) | ~99% IL penetration; the business channel | M–L | `[strategy-brief §1][connection-model §3]` |
| 3.3 Meta-account monitoring layer | proactive policy pre-checks / multi-account status | Meta wedge — **value-add, not ban-recovery** (outside our control) | L | `[strategy-brief §1 A]` |

### Phase 4 — Polish `[audit]`
Visual refresh (#5), UI consistency, perf, the remaining "polish" blocker. Hygiene; raises ease-of-use *feel* (Pain #3) but not a differentiator alone.

---

## 4. Sequenced Roadmap

Ordered by dependency then value. **Migration collisions resolved** (see box).

```
P0  Land #12, #11 ───────────────────────────────► (unblocks loader + magic-link pattern)
P1  💰 CHARGE-MONEY GATE                            │
    SMTP → password-reset → post-signup UX         │  ← nothing monetizable ships until
    → Stripe+transparent-billing → 502 fix         │     this phase is done
P2  ⭐ DIFFERENTIATOR                                │
    019/020 meta_connections (+backfill)           │
    → re-point & merge #10                          │  ← builds Pains #1 + #2
    → connect-link → 021 client-core spine          │
    → client ROI/reporting (+ attribution fix)      │
P3  Hebrew quality bar · WhatsApp · Meta monitoring │  ← strategy-implied moat
P4  🎨 Polish (#5 visual refresh, perf)             │  ← hygiene last
```

**What each phase unlocks (explicit):**
- **Unblocks CHARGING money:** Phase 1 — specifically **Stripe (1.4) + signup/SMTP (1.1, 1.3)**. Until these land there is no compliant paid funnel `[audit]`.
- **Builds the DIFFERENTIATOR:** Phase 2 — the **client-core spine (2.4)** + **client ROI/reporting (2.5)** are what let AdMaster *own* Pains #1 and #2. This is where the product stops being "another generator" `[strategy-brief §1, §4]`.
- **Polish:** Phase 4 — defer; do not let it block revenue or differentiator.

> ### 🔢 Migration-number resolution (confirmed against all worktrees `[code]`)
> Highest committed integer anywhere = **`018_brief_code_token`** `[code]`. `019`/`020` are **reserved but NOT on disk** for `meta_connections` `[connection-model §2]`; `021` is recommended for client-core `[core-spine §1.1]`. History shows real parallel collisions (multiple `003/004/008`), so **confirm the integer with the human before writing each file** (project rule: cross-branch migration coordination).
> - `019_meta_connections.sql` (table+RLS+backfill) — Phase 2.1
> - `020_meta_client_connect_token.sql` (connect token) — Phase 2.1
> - `021_client_core.sql` (analysis+avatar JSONB) — Phase 2.4
> - **Avatar v2 (`feat/avatar-quality-v2`) carries colliding `004/005/006`** — on merge, renumber **above** 021 (→ `022/023/024`) and retarget its generator to write `meta_clients.avatar` `[core-spine §2.4, §4]`. Avatar v2 is a Phase-2.4 fast-follow, not a blocker (spine ships on Avatar v1 first).

---

## 5. Value-Based Pricing Ladder

**Principle:** price rises as value ships — charge for what the product can actually *prove*, not its potential. `[strategy-brief §3]` Today's **₪49 / ₪99 / ₪249** was a **directional floor anchored on an invoicing tool (Morning/Green Invoice), with no real Israel marketing-SaaS WTP data** — treat as the entry floor, not the ceiling. Benchmark ceiling: **GoHighLevel $97–$497/mo** `[strategy-brief §1, §3]`. Tier by **number of client workspaces** (matches how the agency buyer earns).

| Stage (gated on) | What the product justifies | Starter | Pro | Agency | What must ship to charge it |
|---|---|---|---|---|---|
| **Launch** (Phase 1 done) | Hebrew generation + publish, billable | ₪49 (1–3 clients) | ₪99 (~10) | ₪249 (scale) | Stripe + signup + 502 fix |
| **Execution** (Phase 2.1–2.4) | Multi-client connections + durable per-client core + connect-link | ₪69 | ₪149 | ₪349 | `meta_connections`, connect-link, core spine |
| **Proof** (Phase 2.5) | **Client-facing ROI reports** — the agency's retention deliverable | ₪99 | ₪199 | ₪449 (white-label reports) | ROI/reporting + attribution fix |
| **Moat** (Phase 3) | WhatsApp funnel + Meta monitoring + Hebrew quality bar | ₪119 | ₪249 | ₪499+ | Phase 3 items |

**Model:** hybrid **base + per-client/usage** (client workspaces + AI/ad-spend volume) — AI margins (50–60%) make flat fees risky; per-client billing mirrors the agency's own revenue, lowering switch friction `[strategy-brief §3]`. **Each price step must be earned by a shipped capability** — raising price before Phase 2.5 charges for a promise, which is exactly the "soft-ROI copilot" trap flagged in `[strategy-brief §3]`.

> ⚠️ All ILS numbers are directional — **validate with real price tests against the agency buyer** before committing. No audited Israel WTP data exists `[strategy-brief §5]`.

---

## 6. Risks & Open Questions

**Risks**
- **Buyer verdict is medium-confidence, magnitude unproven** `[strategy-brief §1 C, §5]`. If the SMB-owner motion turns out larger than the agency layer, the per-client/agency data model (Phase 2) is over-built. Mitigation: the core spine and `meta_clients` identity work for both; only the connect-link (2.3) is strictly agency-specific.
- **ROI reporting depends on a schema that can't represent it yet** `[attribution §1–2]` — no `ad_id`, account-level metrics only, attribution dropped at write. Phase 2.5 is XL partly *because* it must first fix capture. Underestimating this re-creates "Pain #1 has zero coverage."
- **Migration collisions across 9 worktrees** `[code]` — a wrong integer corrupts ordering. Always confirm before writing (box in §4).
- **Re-pointing #10 after merge instead of before** would ship a schema we immediately deprecate `[connection-model §4.2]`. Re-point first.
- **Competitive:** Kolbo.AI / Poly could add ad management; GoHighLevel could simplify onboarding; AdCreative could fix billing trust `[strategy-brief §5]`.
- **Pricing ahead of value** — raising tiers before Phase 2.5 charges for unproven ROI `[strategy-brief §3]`.
- **Don't market Meta ban-recovery** — outside a software vendor's control; monitoring is a value-add only `[strategy-brief §1 A]`.

**Open questions (carried from research; not invented)**
1. In-house vs outsource **split** for Israeli SMBs — refuted/unknown; sizes the second motion `[strategy-brief §5]`.
2. Real **Israel WTP** in ILS for the agency buyer — no audited data `[strategy-brief §3, §5]`.
3. `ad_id` modeling decision — introduce a specific-ad entity, or report at account+date level only? `[attribution §2]`
4. Avatar v2 merge timing — fast-follow vs prerequisite for the spine `[core-spine §2.4]`.
5. WhatsApp depth — share-link only (cheap) vs deeper funnel integration? `[strategy-brief §4]`

---

### Source documents (all in-repo)
`docs/strategy-brief.md` · `docs/client-connection-model.md` · `docs/client-core-spine.md` · `docs/client-attribution.md` · `docs/autoads-meta-flow.md` · the 7-blocker launch-readiness audit · verified PR state (#10/#11/#12, #7, #5) and migration audit across all worktrees.

*Planning artifact only. No code or migrations were created or executed.*
