# AI Marketer — Deep Vision (strategy + architecture ideation)

> **Purpose.** Thinking beyond `AI-MARKETER-MASTERPLAN.md`. The masterplan built the *stack* (brain → decision → execution → diagnosis, all green in dry-run). This doc answers: what turns the stack into a **marketer** — an entity that runs the marketing week after week — and how do we build, sell, and scale it. Design/strategy only; no code implied by this doc.
>
> **The vision, restated as the test for every proposal here:** a business owner pays a fraction of an agency retainer and gets a system that *does the marketing* — plans, publishes, spends, watches, diagnoses, improves, and reports — where every one of those verbs is driven by the accumulating 3-layer understanding (business / customers / bridge), and every failure is explained by *reasoning from insights*, not metric superstition. The brain is the moat; insight-grounded action + diagnosis is the differentiator no raw LLM or dashboard tool has.

---

## 1. What makes it a real MARKETER (not a tool)

### 1.1 What an excellent human marketer actually does

Decompose the agency retainer into the jobs it buys. For each: what we have, what's missing, and how the brain drives it.

| # | Marketer job | We have | Missing | How the brain drives it |
|---|---|---|---|---|
| J1 | **Forms a point of view** on the business — strategy, positioning, audience thesis | ✅ brain + `client_strategy` synthesis | — (deepen over time) | IS the brain |
| J2 | **Shows up uninvited** — arrives Monday with a plan; doesn't wait to be asked | ❌ everything today is request-triggered | **The Heartbeat (§1.2)** — the single biggest tool→marketer gap | weekly plan = projection of active atoms onto a calendar |
| J3 | **Runs a portfolio, not a campaign** — allocates budget across funnel stages, campaigns, channels; holds reserves | partial (`decide()` is per-decision) | portfolio allocator (§2.2) | insight confidence = prior on expected value per bet |
| J4 | **Watches daily and reacts** — pauses losers, scales winners, catches anomalies | partial (ingest + diagnose exist, nothing schedules them) | daily watchdog tick + guardrailed actions (§1.2) | reactions justified by atoms, never metrics alone |
| J5 | **Experiments deliberately** — keeps a hypothesis backlog, tests one variable, records what was learned | implicit (A/B in auto-improve) | **hypothesis ledger (§3.1)** — make experiments first-class | every test is a falsifiable claim about an atom |
| J6 | **Communicates** — "here's what we did, why, what happened, what's next" | `report_shares` (static ROI report) | weekly narrated digest, written FROM the decision ledger (§1.3) | the report cites `grounded_in` + rationale verbatim — no other product can write this report |
| J7 | **Pushes back on the business** — "your offer is the problem, not the ads" | ❌ | **advisory surface (§2.7)** | recurring objection atoms + offer-link diagnoses → a business recommendation, not an ad tweak |
| J8 | **Is accountable to business outcomes** — leads/sales, not CTR | partial (ROAS framing in reports) | outcome anchoring + lead-quality feedback loop (§3.4) | outcome misses weaken the atoms that predicted them |
| J9 | **Remembers everything** across months and campaigns | ✅ the moat (insights + lifecycle + events) | angle memory formalization (§2.1) | — |
| J10 | **Has craft** — knows what a good Israeli Meta ad looks like | ✅ frameworks, Hebrew-native gen | video craft (for TikTok/YT later) | frameworks selected per awareness-level atom |
| J11 | **Knows the calendar** — chagim, seasonality, day-of-week | ❌ | timing layer (§2.5) | seasonality captured AS insights (`kind: seasonality`) |
| J12 | **Earns trust gradually** — new marketer proposes, veteran acts | ❌ (binary MONEY gate) | **autonomy ladder (§1.4)** | rationale quality is what makes L1 approvals fast → graduation to L2 |

**The honest gap assessment:** we built a marketer's *skills* (strategy, creation, execution, diagnosis) but not a marketer's *behavior* — initiative, rhythm, portfolio ownership, communication, and earned trust. All five are buildable on the existing stack; none require new intelligence, only new *orchestration and surfaces*. J2 (heartbeat) unlocks J3, J4, J6; J12 (autonomy ladder) makes J2 safe to ship.

### 1.2 The Marketing Heartbeat — the core proposal of this doc

A per-client scheduled agent loop. This is the difference between "a tool that can run a campaign" and "a marketer that runs your marketing."

```
DAILY tick (cheap, mostly mechanical, small model)
  ingest performance (T10) → compute verdicts vs client baselines
  → anomaly scan (spend spike, delivery drop, CTR collapse)
  → guardrailed actions within autonomy level: pause clear losers,
    shift budget within caps, queue diagnosis for underperformers
  → append every action/observation to the decision ledger

WEEKLY tick (the "Monday morning plan", big model)
  read: active atoms + hypothesis backlog + last week's diagnoses + calendar
  → produce WeeklyPlan: campaign mix, content calendar (organic cadence),
    budget allocation across funnel stages, 1–3 experiments to run,
    each item grounded_in[] + rationale
  → execute what autonomy allows; queue the rest as proposals
  → send the owner digest (§1.3)

MONTHLY tick (strategy review)
  re-synthesize client_strategy if atoms drifted materially
  → portfolio retrospective: which atoms gained/lost confidence and why
  → strategic proposals (channel expansion, offer advisory, budget change)
  → client-facing monthly report (agency-replacement artifact)
```

Implementation shape (design): a `heartbeat_runs` ledger table (client_id, tick_type, status, actions jsonb, started/finished) + Vercel Cron fan-out over active clients with per-client locks and jitter (§6.2). Every heartbeat action writes a `campaign_decisions` row — the heartbeat has no side channel; it acts *through* the existing decision engine, so the WHY-trail stays intact.

**Why this is the moat applied, not just a cron job:** the weekly plan is literally a projection of the brain onto a calendar. Two clients with identical budgets get different plans because their atoms differ — one gets TOFU emotional-safety video because its audience is problem-unaware; the other gets BOFU WhatsApp follow-up because its objection atoms say price is the blocker. An LLM-with-a-brief regenerates a generic plan each time; the heartbeat's plan *drifts with the accumulating understanding*.

### 1.3 The weekly digest — the felt product of "a marketer works for me"

Generated from the decision ledger + diagnoses + performance, in Hebrew, sent via WhatsApp (InforU — dogfooding the channel) with a link to the full report:

> "השבוע: הרצנו 2 קמפיינים. זווית 'ביטחון רגשי' (מבוססת על התובנה שהלקוחות קונים ביטחון, לא טיפול — ביטחון 0.85) הביאה 14 לידים ב-₪27 לליד — 32% מתחת ליעד. זווית המחיר נכשלה בשלב ההצעה, לא בקריאייטיב — התנגדות המחיר עדיין לא מטופלת בדף הנחיתה; ניסחנו מחדש את ההצעה והרצנו A/B. שבוע הבא: מרחיבים את קהל הביטחון-הרגשי ללוקאלייק 3%, ומקפיאים את זווית המחיר עד שההצעה תשתפר."

Nothing here is generated "creatively" — every clause is a read from `campaign_decisions.rationale`, `diagnoses.rationale`, and atom states. That's why it can't be hallucinated and why no competitor can fake it: **the report is the audit trail, narrated.** This artifact alone justifies the subscription to a business owner who today gets a monthly PDF of vanity metrics from their agency.

### 1.4 The autonomy ladder — how a marketer earns trust

Replace the binary MONEY gate with a per-client autonomy level (the gate remains the floor):

| Level | Behavior | Money |
|---|---|---|
| **L0 Draft** | generates + plans; publishes nothing | none |
| **L1 Propose** (default) | executes organic; paid campaigns fully built, PAUSED; owner approves each unpause from the digest/command center (one tap) | owner unpauses |
| **L2 Act-within-caps** | unpauses/pauses/reallocates within daily+monthly caps and per-change delta limits; notifies after | capped autonomy |
| **L3 Autonomous** | full portfolio control within monthly budget; owner sets budget + goals only | budget-bounded |

Graduation is *earned and visible*: "המערכת פעלה 3 שבועות ב-L1 עם 92% אישורים — לשדרג ל-L2?" Approval-rate as the trust metric. This is simultaneously a safety mechanism, a UX (the approve-tap in the digest IS the engagement loop), and a pricing axis (§5). Anomaly kill-switch at every level: spend/metric anomalies auto-pause + alert regardless of autonomy.

---

## 2. The understanding-driven engine — decisions the brain should drive that we haven't designed

### 2.1 Creative iteration strategy (explore/exploit over the bridge layer)

Today: `decide()` picks an angle; auto-improve regenerates a failed link. Missing: the *policy* for what to try next across a client's lifetime.

- **Angle portfolio.** Formalize angle memory (already queued in EXECUTION-STATUS) as a per-client portfolio over `bridge/angle` atoms: each angle carries its atom confidence, cumulative spend, performance record, and a **fatigue score** (frequency-weighted CTR decay on a *proven* angle).
- **The exploration policy is a function of brain state**, not a fixed variant count:
  - bridge layer has few/low-confidence atoms → **explore wide**: each variant tests a *different* angle atom (variants are hypotheses, §3.1), small budget each.
  - a high-confidence angle exists → **exploit**: format/hook variations *within* the proven angle; exploration budget shrinks to a reserved ~15–20%.
- **Fatigue vs wrongness — a distinction only the brain can make:** declining CTR on an angle whose atom is still corroborated = creative wear-out → refresh executions, keep the angle, *don't* weaken the atom. Declining CTR + refuting signals = the angle is wrong → weaken the atom, rotate to the next angle. A metric optimizer can't tell these apart; an insight-lifecycle system can. Encode as a rule in the diagnosis engine: performance-loss signals on high-`evidence_count` angle atoms with recent creative age > N days route to "fatigue" not "refute".

### 2.2 Budget reallocation as insight-weighted portfolio allocation

Treat every active campaign/ad-set as a bet; allocate like a portfolio manager with priors:

- **Prior = grounding confidence.** A campaign grounded in 0.9-confidence atoms starts with a higher expected-value prior than an exploratory one. Thompson-sampling-style allocation where the prior comes from the brain, updated by observed CPA/ROAS.
- **Constraints (the marketer's judgment, encoded):** minimum viable spend per ad-set (respect Meta learning phase — never starve a test below significance); **funnel-coverage floor** (never zero TOFU just because BOFU converts — TOFU feeds next month's BOFU); exploration reserve (15–20%); client cap; max daily delta (±25% at L2) to avoid thrash.
- Every reallocation = a `campaign_decisions` row: *"הוזז ₪30/יום מזווית המחיר לזווית הביטחון: התובנה המבססת של המחיר נחלשה ל-0.4 אחרי אבחון כשל-הצעה; הביטחון מקורבת פעמיים השבוע."*
- Start with a **daily reallocation step at the heartbeat daily tick**, not continuous — matches SMB data volumes (§7 risk R4) and keeps decisions reviewable.

### 2.3 Audience expansion / narrowing from the customers layer

- The `sub_audience` atoms ARE the audience portfolio. Performance flows back per sub-audience (targeting spec is derived from the atom, so attribution is native).
- **Expansion trigger:** a sub-audience atom crosses high confidence with performance corroboration → propose lookalike widening (1%→3%) or an adjacent segment *predicted by the atoms* (e.g. persona says "parents of teens" → adjacent "parents of preteens"), queued as a hypothesis.
- **Narrowing trigger:** poor relevance/delivery + diagnosis says avatar-link failure → split the audience and test sub-segments; a CPA split between segments **spawns a new `sub_audience` atom** (segmentation *discovery* — performance data teaching the brain who the customers really are, the reverse direction of the loop).
- Meta's own broad/Advantage+ targeting is a *competitor hypothesis*, not a default: periodically test broad against insight-derived targeting; if broad wins for a client, that's itself an insight ("this product self-selects; creative does the targeting") stored as an atom.

### 2.4 Channel-mix decisions

- Give each channel a **role assignment** derived from atoms: awareness-level distribution + funnel_fit atoms → e.g. problem-unaware majority → organic + TOFU paid on Meta; objection-heavy BOFU → WhatsApp sequences; community/deal-seeking audience → Telegram channel. The decision engine's `platform` output generalizes to a **mix with roles**, not a single pick.
- **Channel-fit score** per client per channel (from brief: where do customers live; later from cross-client playbook priors §2.6). Proposing a *new* channel is a monthly-tick strategic proposal with expected-value reasoning, not a silent expansion.

### 2.5 Timing

- **Israeli calendar as a first-class input:** chagim/erev-chag/Shabbat/bein-hazmanim in the decision context (static data + per-client relevance — a kosher restaurant vs a B2B SaaS weight these differently, and the *weighting itself* comes from business atoms).
- **Seasonality as insights:** `kind: seasonality` atoms ("גני ילדים — רישום שיא בפברואר-מרץ") sourced from brief or discovered from performance history; the weekly planner reads them like any atom.
- Day/hour heat from accumulated performance → organic scheduling + dayparting proposals. Low priority for paid (Meta optimizes delivery); high value for organic + WhatsApp send-times.

### 2.6 Cross-client learning without leaking — the Playbook layer

The compounding moat. Two-tier memory:

```
client_insights   — private, per-client, verbatim (exists)
playbook_insights — global, ABSTRACTED patterns; NO client FK, no names, no verbatim copy
  pattern      e.g. "vertical=clinics, audience=parents → safety-framing angles
                outperform price-framing on CVR"
  scope        {vertical, audience_type, funnel_stage, channel}
  support      {clients: k, experiments: n, effect_size}
  status       candidate | active | retired
```

- **Promotion pipeline:** a candidate pattern is published only when supported by ≥k distinct clients (k=3 to start) and passes an abstraction check (no identifying detail; structural claim only). Until then it's a candidate visible to no tenant.
- **Consumption:** playbook atoms act as **priors for new clients** — day-1 `decide()` for a new dental clinic already leans toward safety-framing at moderate confidence, *labeled as playbook-sourced* (`source: playbook`) so per-client evidence can override it. Cold-start solved, and every client makes the next client's first week smarter.
- **Privacy stance (also GTM copy):** "הידע על העסק שלך פרטי; רק דפוסים אנונימיים חוצי-לקוחות משותפים." Agencies will demand this in writing.

### 2.7 Offer & business advisory (the marketer who pushes back)

When objection atoms recur across diagnoses and the failed link is repeatedly **offer** — the ads aren't the problem. Monthly tick emits a business recommendation: restructure the offer (installments, guarantee, bonus stack), grounded in the specific objection atoms and the diagnosis evidence. Surfaced in the command center + monthly report as **"המלצה עסקית"**, clearly separated from marketing actions (we never change the client's pricing; we advise). This is J7 — the single most agency-differentiating behavior, and it falls out of data we already collect.

---

## 3. The diagnosis / learning loop — genuinely better than metric optimization

### 3.1 The hypothesis ledger — every decision is a falsifiable experiment

The masterplan's diagnosis reasons *backward* from failure. Add the forward half: at decision time, the engine writes down what it *expects* and why.

```
hypotheses
  id, client_id, insight_ids[]        -- the atoms this bet rests on
  claim        "העלאת זווית ביטחון-רגשי תנצח זווית מחיר אצל קהל ההורים"
  prediction   {metric: cvr, comparator: ">=", delta: 0.2, vs: "price-angle arm"}
  test_refs    campaign_item ids (the arms)
  status       open | supported | refuted | inconclusive
  resolution   {observed, verdict_reason}
```

- **Why this changes the game:** when results arrive, they resolve a *claim about an atom*, not just an ad's fate. Supported → corroborate the atoms (existing lifecycle). Refuted → weaken them *with the experiment as evidence* in `insight_events`. Inconclusive (didn't reach sample floor) → no atom update — **statistical humility built in**, protecting the brain from noise (§7 R4).
- The hypothesis backlog (open + proposed-but-not-run) is the marketer's "ideas list" — the weekly planner draws experiments from it, prioritized by information value (which atom, if resolved, unblocks the most decisions?).
- Prevents re-testing: refuted hypotheses are memory. "כבר ניסינו זווית מחיר לקהל הזה פעמיים — נכשל בשלב ההצעה" is exactly what a veteran marketer knows and a tool forgets.

### 3.2 Diagnosis as causal reasoning with a confirmation step

Layer on the existing heuristic isolation (§4.2 of client-intelligence.md):

1. **Heuristic pass** (exists): cohort comparison over tags → candidate failed link.
2. **Reasoning pass** (LLM): takes the artifact + tags + metrics + the *active atoms that grounded it* + open hypotheses → produces a causal narrative naming which atom is implicated, with confidence. The two passes **agreeing** → high-confidence diagnosis, auto-improve proceeds. **Disagreeing** → low-confidence, flagged in command center for the owner ("שתי אבחנות אפשריות — מה דעתך?" — the owner's answer is a high-weight `learning_signal`).
3. **Counterfactual confirmation** (the step that makes it science): every diagnosis auto-queues the *minimal test that would confirm it* — "אם האבחנה נכונה, שינוי מסגור ההצעה בלבד אמור להחזיר את ה-CVR" → an A/B changing ONLY the accused link (auto-improve already does the regeneration; this makes the A/B *also resolve the diagnosis*). Confirmed diagnoses strengthen the diagnostic patterns themselves.

### 3.3 Compounding per-client

- **Per-client baselines** (CPA/CTR/CVR per funnel stage, rolling): verdicts are client-relative, not global thresholds — a ₪45 CPA is a win for one client and a disaster for another. Store alongside `content_performance` computation.
- **Creative genome:** artifacts already carry framework/angle/hook tags; accumulate per-client "what works here" stats (framework win-rates, hook styles, image styles) → generation priors. The client's 50th ad is measurably better-informed than its 1st — *demonstrably*, which becomes retention copy ("המערכת שלך כבר למדה מ-47 מודעות").
- **The already-tried ledger** = resolved hypotheses (§3.1).

### 3.4 Outcome anchoring — learning from business results, not platform metrics

- Leads already flow (attribution capture, W5.1a). Add **lead-quality feedback**: owner marks leads (רלוונטי / לא רלוונטי / נסגר) in the command center or via a WhatsApp reply — each mark is a `learning_signal` on the artifact AND the audience atom behind it. Cheap-CPL-bad-leads campaigns get caught by the brain ("קהל רחב מביא לידים זולים אבל לא רלוונטיים" → sub_audience atom weakened) where a metric optimizer would scale the failure.
- This is also the WhatsApp channel earning its keep beyond BOFU: the owner's reply-loop lives where Israeli SMB owners actually live.

### 3.5 Cross-client learning quality

Playbook promotion (§2.6) requires *resolved hypotheses*, not raw correlations — patterns enter the playbook only via experiments that reached significance in ≥k clients. The playbook is a library of reproduced findings, not scraped averages. This is what makes "our AI knows Israeli SMB marketing" a true claim with receipts.

---

## 4. Platform roadmap beyond Meta + WhatsApp

**Prime architectural move first:** define a `ChannelAdapter` contract now — `capabilities()` (formats, targeting, budget model, metrics granularity), `publish()`, `fetchPerformance()`, dry-run mode — mirroring how `lib/meta-ads`/`lib/meta-publish`/`lib/whatsapp` are already shaped. The decision engine stays channel-agnostic: it emits a decision with a channel role (§2.4); adapters translate. Each new platform then costs its API quirks + approval process, not engine surgery. The real cost driver across this table is **creative format** (video) and **approval friction**, not code.

| Platform | Integration requirements | Approval hurdles | Effort | How the brain drives it |
|---|---|---|---|---|
| **Telegram** | Bot API — free, instant token, channel posting trivial; no ads (Telegram Ads is €-M minimums via resellers — skip) | **None** | **S** (days) | Community/nurture role: deal-seeking + community-audience atoms route here; channel content = bridge-layer messages at MOFU cadence. Huge in the Israeli deal/affiliate scene — directly serves the affiliate GTM path (§5) |
| **Taboola / Outbrain** | REST APIs (campaigns, items, reporting) — technically simple, same creative motion as Meta (image + headline + landing) | API access typically tied to a managed/self-serve account + spend minimums; Taboola is Israeli — local support and SMB self-serve exist; realistically weeks of BD, no app review | **M** (API S; commercial M) | Native = advertorial: pure bridge-layer storytelling for problem-UNaware audiences — the awareness-level atom literally selects this channel; advertorial body is the angle atom expanded to long-form. No video needed — reuses the entire existing creative stack |
| **TikTok** | Business API (ads) + Content Posting API (organic); ads API app review ~weeks; organic posting audited | Medium — app review, stricter policies | **L** (gated on video, §7 R7) | Hook-first short video scripted from hook/angle atoms; awareness level dictates format (POV/UGC vs demo). Younger IL audience atoms route here |
| **YouTube** | Google Ads API (developer token: basic→standard approval, weeks) + YouTube Data API (upload quotas) | Highest — Google Ads API approval is the strictest of the set | **XL** | Search intent = problem-aware/solution-aware atoms (a *new use* of awareness data: intent capture vs interruption); long-form = proof/authority atoms |

**Recommended order:**

1. **WhatsApp** (in flight, C2) — BOFU/retention + owner reply-loop (§3.4).
2. **Telegram** — near-zero cost, zero approvals, native to the affiliate self-use path; ships a second *organic* channel that proves the multi-channel brain quickly.
3. **Taboola/Outbrain** — the highest leverage-per-effort *paid* expansion: reuses image+copy+landing end-to-end, Israeli market strength, opens the advertorial motion that Meta can't do; start the BD conversation early since it's the long pole.
4. **TikTok** — when video generation lands (script → stock/slideshow/AI-video pipeline; script quality is already our strength since scripts come from atoms).
5. **YouTube** — last; heaviest approval + heaviest creative; by then the portfolio allocator makes a 5-channel mix manageable.

Google Search ads are deliberately out of this list's scope but are the natural #6 — same Google Ads API investment as YouTube, and search-intent capture is the one funnel role nothing above covers.

---

## 5. Business model & go-to-market

### 5.1 What the client is paying for

Not credits, not content — **"שיווק שמנוהל בשבילך"**: a weekly plan, execution, spend management, a Hebrew digest that explains itself, and a brain that gets smarter about *their* business every week. Anchor against the agency retainer (₪3,500–₪15,000/mo for Israeli SMB): we are 5–10% of the retainer.

### 5.2 Pricing tiers (proposal)

| Tier | ₪/mo | Clients | Autonomy | Includes |
|---|---|---|---|---|
| **Starter** | **390** | 1 (self) | L1 | brain, heartbeat weekly, organic auto-publish, paid up to ₪3k/mo managed spend, weekly digest, generous gen quota |
| **Pro** | **890** | 3 | up to L2 | daily heartbeat, full paid management, WhatsApp channel, hypothesis engine, priority |
| **Agency** | **2,490** | 15 | up to L3 per client | white-label reports + digests, brief magic links (built), connect links (built), playbook-informed cold starts, team seats later |

- **Flat, not % of ad spend**, at launch: % of spend re-creates agency incentive distrust and is hostile to tiny SMB budgets; revisit a spend-based Enterprise lane later. Ad spend is always the client's own (their ad account via OAuth — already the model; we never touch their money).
- Existing credits system folds in as included quotas + top-ups for heavy generation — keeps the Stripe plumbing (H3) intact.
- **The autonomy ladder is a natural upgrade path**: you graduate to L2/L3 by results, and L2/L3 live in higher tiers — trust and revenue climb together.

### 5.3 Two GTM paths, one sequence

- **Path A — affiliate self-use (the founder's own path):** we are customer #0. Run real affiliate promotions (Meta + Telegram) through the system with a small money gate (₪50–100/day). This produces: live validation of the whole loop, the first playbook atoms, and a *numbers-attached case study* — all without selling anything. **This is also why Telegram is platform #2.**
- **Path B — freelance marketers & micro-agencies (the beachhead ICP):** the agency features already built (brief magic links with `agency_name`, session-less connect links, shared reports) were built for exactly this buyer. One agency = 5–15 client brains = 5–15× the data flywheel per sale, and they churn less (the brains ARE their client knowledge — switching cost compounds). They buy *leverage*: manage 15 retainers with the effort of 3.
- **Sequence:** A first (weeks 1–4, results in hand) → recruit 3–5 Path-B design partners from the Israeli FB-marketing community at a founder price (₪290/mo, white-glove, feedback contract) → public launch with case studies. **The share-link report is the viral loop** — every end-client of a design partner sees the branded weekly report.

### 5.4 Onboarding flow (time-to-wow < 5 minutes)

1. Sign up → create client (name only — already shipped in #31) → brief (self-fill or magic link to the end-client).
2. **Watch the brain build** (client-intelligence-ui §1 — the reveal IS the aha; make it the demo).
3. Strategy snapshot + first proposed weekly plan appear (L0 — value before any connection).
4. Connect Meta (OAuth, built) → plan becomes executable → first campaign built PAUSED (L1).
5. One-tap approve in the digest → live. First weekly digest arrives → subscription justified.

Steps 1–3 need zero external accounts — the wow is credential-free, which makes trials and demos frictionless.

### 5.5 Fastest concrete path to the first paying customer

Week 1–2: H4 + C2 land → live on founder's own affiliate campaigns (money gate, small). Week 3–4: results + tuned loop → the case study. Week 4+: 5 design-partner conversations in the Israeli marketing groups (warm network) — the demo is the brain-build reveal on *their real client's brief*, live in the meeting, followed by "והנה הדוח השבועי שהלקוח שלך יקבל". First paid conversion target: a freelancer managing 5+ SMB clients who replaces 10 hours/week of manual work with approvals. **Prerequisite checklist is short and already known: H4, C2, H2 (SMTP), H3 (Stripe prices) — plus the heartbeat MVP (weekly tick + digest), which is the only *new* build on the critical path to charging money.**

---

## 6. Architecture for scale

### 6.1 Multi-tenancy

- Current RLS owner-only model scales fine to hundreds of tenants; no change now.
- **Agency = the sharp edge:** today "agency" is one user owning many clients. Team seats need an org layer (`orgs`, `org_members(role)`, `clients.org_id` alongside owner) — additive migration, RLS on org membership. **Defer until a design partner asks; design FKs now** so nothing assumes user==org (the `owner_user_id` denormalization everywhere makes this an add-a-column job, not a rewrite).
- Playbook isolation per §2.6: separate table, no client FK, promotion pipeline — never computed inline from cross-tenant queries at request time.

### 6.2 Heartbeat at scale (the main new infra)

- **Vercel Cron → fan-out over active clients → per-client job rows** in a `heartbeat_runs` ledger; a worker route claims jobs (`status='claimed'` with lease timeout — idempotent, crash-safe); jitter spreads Meta API calls. Vercel Queues when volume justifies (it's in beta; a jobs table is boring and sufficient to ~1k clients).
- Ticks are **resumable and idempotent**: each step checks the ledger before acting (same discipline as the campaign state machine).
- Backpressure: daily ticks for paying tiers; free/trial clients get weekly only — cost control and an upgrade incentive in one.

### 6.3 LLM cost control

- **Model tiering:** daily tick = small model (classification, anomaly flags, verdicts — mostly mechanical); weekly plan + diagnosis reasoning + monthly synthesis = frontier model. Estimated steady-state: daily 31×~20k small-model tokens + weekly 4×~80k + monthly 1×~150k frontier ≈ **single-digit $/client/month** — comfortable inside ₪390.
- **Prompt caching:** the brain context (`buildAiContext`) is a stable per-client prefix — structure prompts as [cached brain context | volatile tick data] to cut input cost on every heartbeat call.
- **Synthesis only on material drift** (already designed) — heartbeats read the snapshot; they don't re-derive it.
- **Per-client token ledger** (tokens per run in `heartbeat_runs`) → tier budgets enforced, anomalies (runaway loops) alerted. Cost observability from day one, not retrofitted.

### 6.4 Ad-API scale

- Meta limits are per-ad-account, and every client brings their own account/token → rate limits shard naturally with tenancy. Batch insight reads; daily granularity for small spenders (their data is too sparse for hourly to mean anything — aligned with §3.1's statistical humility).
- Token health is a heartbeat concern: `meta_connections.status` + expiry checks in the daily tick → proactive "reconnect" WhatsApp nudges before campaigns silently stall (a classic agency failure we can beat).

### 6.5 Safety rails at scale

Per-client spend caps enforced in code (exists) + a global daily spend anomaly monitor across all tenants (one bad deploy must not scale a bug across every client's budget — cap the *fleet's* aggregate delta per day). All L2+ actions rate-limited per client per day. The decision ledger doubles as the incident-forensics log.

---

## 7. Risks, open questions, decisions needed

### 7.1 Risks — honest

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Meta App Review** (ads_management, pages/IG publishing advanced access) rejects or drags for weeks — the single biggest external threat to the whole plan | HIGH | Start submission NOW (it parallelizes with everything); operate design partners as app testers/dev-mode meanwhile; agency BM system-user tokens as a bridge; the organic+Telegram+WhatsApp loop works even if paid publishing approval lags |
| R2 | **Autonomous spend goes wrong once** and trust is dead — one runaway campaign at a design partner ends the relationship | HIGH | Autonomy ladder default L1; hard caps + delta limits + anomaly kill-switch at every level; PAUSED-by-default already enforced; fleet-level cap (§6.5) |
| R3 | **Diagnosis is plausible-but-wrong** — LLMs are excellent at confident causal stories; a wrong diagnosis that *sounds* right is worse than none | HIGH | §3.2 three-layer design: heuristic+LLM agreement gate, counterfactual confirmation A/B, disagreement → human. Never auto-weaken an atom on an unconfirmed diagnosis |
| R4 | **SMB data is statistically tiny** (₪50–100/day → tens of clicks) — most "learnings" at this scale are noise | HIGH | Sample floors before verdicts (§3.1 inconclusive state); weight schedule already designed (single-ad perf = 0.2); lean on user signals + lead-quality marks which are high-signal at any spend; playbook priors carry the load early |
| R5 | **Playbook cold-start chicken-and-egg** — the cross-client moat needs clients | MED | Founder's own campaigns + design partners seed it; the *per-client* brain is already differentiating at n=1, playbook is compounding upside not a launch dependency |
| R6 | **"AI marketer" gets crowded** — every content tool will claim it in 2026 | MED | The moat is the accumulated brains + resolved-hypothesis playbook + the WHY-trail report; ship the behaviors (heartbeat, digest, diagnosis) that require the data layer competitors don't have; speed to real client brains matters more than features |
| R7 | **No video ⇒ no TikTok/YT**, and video-native competitors frame us as "static ads only" | MED | Sequence chosen so the next two channels (Telegram, native) don't need video; invest in script→video pipeline only after paid traction (script quality from atoms is the differentiated part anyway) |
| R8 | **Solo-founder ops** — agencies expect support; heartbeats run 24/7 | MED | Autonomy defaults conservative; ops dashboards from the ledgers (§6.3); design-partner cohort kept ≤5 until self-serve is boring |
| R9 | **WhatsApp/InforU deliverability + template approvals** constrain the digest channel | LOW | Email digest fallback (needs H2); digest content is identical across channels |

### 7.2 Open questions (thinking still unsettled)

- **Where does the landing page live in the loop?** Diagnosis can blame the funnel link, and `landing_pages` exist — but do we auto-iterate landing copy (same A/B machinery) or only advise? Auto-iteration is the consistent answer, but it needs hosting/analytics wiring decisions.
- **How does the owner's own knowledge get in continuously?** Brief + signals exist, but a marketer *interviews* the client monthly. A WhatsApp conversational check-in ("איך היו הלידים החודש? משהו השתנה בעסק?") parsed into signals/atoms may be the cheapest high-signal input we're not capturing.
- **Attribution beyond Meta pixels** for service businesses that close on the phone — do we ask owners to mark closed deals (lead-quality loop §3.4 may be enough) or integrate with Israeli CRMs later?
- **When does `decide()` become `decideMix()`?** §2.4 generalizes platform choice to a role-based mix. Timing: at Telegram integration (2 channels + WhatsApp forces it) — flagging now so T-shaped work isn't wasted on single-channel assumptions.

### 7.3 Decisions I need from you

| # | Decision | My recommendation |
|---|---|---|
| D1 | **Autonomy default** for new clients | L1 (propose+approve via digest), earn L2 after 2 green weeks — trust is the product early |
| D2 | **Pricing model** | Flat tiers (390/890/2,490), no % of spend at launch; credits fold into quotas |
| D3 | **GTM sequence** | Self-affiliate first (weeks 1–4) → 3–5 design-partner agencies at founder price → public launch with case studies |
| D4 | **Playbook layer timing** | Author the schema + start *capturing* candidates now (cheap); build promotion/consumption after ≥3 real clients |
| D5 | **Heartbeat infra** | Vercel Cron + `heartbeat_runs` jobs-table ledger (boring, idempotent); Queues later if needed |
| D6 | **Platform #3** (after WhatsApp) | Telegram — days of effort, zero approvals, serves the affiliate path; Taboola BD starts in parallel because it's the long pole |
| D7 | **Meta App Review** | Submit for advanced access NOW — longest external lead time; everything else parallelizes around it |
| D8 | **Video investment** | Defer until after paid traction; unlocks TikTok/YT as wave 2 of platforms |
| D9 | **Digest channel** | WhatsApp-first (dogfoods InforU, meets Israeli owners where they are), email fallback once H2 lands |

### 7.4 What the next build wave looks like (if this doc is approved)

Not a plan (that's the masterplan's format) — the shape: **Wave 3 = the behaviors.** Heartbeat MVP (weekly tick + WhatsApp digest + one-tap approve) → autonomy ladder → hypothesis ledger → lead-quality loop → advisory surface. Everything rides on tables and engines that already exist; the new schema footprint is small (`heartbeat_runs`, `hypotheses`, `playbook_insights`, autonomy fields). The heartbeat MVP + H4/C2/H2/H3 is the full critical path to the first shekel of recurring revenue.

---

## 8. Beyond Human — the superhuman marketer

> §§1–7 answered "how does the system behave like a *good* marketer." This section raises the target to the real one: **the best marketer in the world** — everything the world's best do, plus everything they *can't*, because a human is bounded by time, attention, memory, energy, ego, emotion, and hours in a day. The bounds are not incidental — they are why the agency model underdelivers, why small clients get the intern, why knowledge walks out the door, and why most "learnings" are never actually verified. Breaking those bounds is the product.

### 8.1 The full craft — what the best human marketers do, audited against the stack

The complete discipline, each capability scored: ✅ have · 🟡 partial · ❌ missing — with the concrete mechanism and how the living understanding drives it.

| Craft | Status | Mechanism (concrete) | How the brain drives it |
|---|---|---|---|
| **Positioning** (owning a slot in the mind *vs alternatives*) | ❌ | New atom kinds: `competitor`, `alternative`, `category_frame`. Positioning statement as a versioned synthesis in `client_strategy`: *"for {segment atom} who {pain atom}, unlike {alternative atom}, we {claim atom}"*. Requires competitor input (see Competitor analysis row) — positioning without knowing the alternatives customers actually compare against is guessing | positioning IS a bridge-layer projection; when an alternative atom changes (competitor pivots), positioning re-synthesizes |
| **Messaging hierarchy** (one core promise → 3–4 pillars → proof points; every asset expresses one pillar) | ❌ | `message_architecture` projection from atoms: core promise = top-confidence USP/translation atom; pillars mapped to desire/objection clusters; proof atoms attached per pillar. Every artifact tagged `pillar_ref` → **coverage becomes measurable** ("pillar 2 has had zero content for 3 weeks") and consistency becomes checkable | the hierarchy is derived from atoms, so it *drifts with the brain* instead of rotting in a strategy PDF like agencies' do |
| **Offer engineering** (value equation, risk reversal, urgency, guarantees, bonus stacks) | 🟡 (§2.7 advisory) | Elevate offers to first-class tested artifacts: offer = components[]; build an **objection→component coverage matrix** — every high-confidence objection atom must be neutralized by some offer component or flagged as an open gap. Offer variants ride the same hypothesis machinery as creative | objection atoms are literally the spec for the offer; a diagnosis blaming the offer link points at the exact uncovered objection |
| **Funnel architecture** (designing the path, not filling stages) | 🟡 (stage tags only) | `funnel` as a designed object: nodes (ad → landing → lead form → WhatsApp sequence → sale), expected conversion per edge (playbook priors), actual per edge. Diagnosis then localizes to a *node*, not just "funnel link failed" | node design derives from awareness-level distribution: unaware audiences get longer funnels; each node's message = the atom appropriate to that awareness stage |
| **Creative testing discipline** (isolate one variable; test matrix) | ✅ mostly | Tags + counterfactual A/Bs (§3.2) already enforce single-variable isolation; formalize as a test-design policy in the hypothesis ledger | — |
| **Audience research** (voice-of-customer: reviews, forums, comments, sales calls) | ❌ **big gap, big prize** | **VoC ingestion pipeline:** mine the client's Google/Facebook reviews, competitor reviews, and — highest signal, zero cost — **comments on our own running ads** into customer-layer atoms (`source: voc`). Exact customer language becomes hook/copy raw material; recurring phrases become desire/objection atoms with real quotes as evidence | today the customers layer is fed only by the brief + performance; VoC makes it fed by *actual customers' words*, continuously — the brief becomes the seed, not the ceiling |
| **Competitor analysis** | ❌ | **Competitor watch:** periodic pull of competitors' active ads from the Meta Ad Library; **ad longevity as a win proxy** (an ad running 4+ months is paying for itself). Mined into atoms: "competitor X leads with price → the emotional-safety lane is uncontested." Feeds positioning + angle selection | competitor moves are just more evidence flowing into bridge atoms; the decision engine naturally routes toward uncontested angles |
| **Brand consistency** | 🟡 | `brand_voice` atoms (tone, register, taboo words, visual style) + a **generation-time lint pass**: every artifact scored against brand atoms pre-publish; violations block or flag | brand is atoms like everything else — editable, teachable via signals, enforced mechanically at 100% coverage (humans spot-check) |
| **Copywriting mastery** | ✅ improving | Frameworks exist; mastery = the creative genome (§3.3) making copy measurably better per client + a network **swipe file**: winning copy patterns abstracted (structure, not verbatim) into playbook atoms with effect sizes | — |
| **Media buying skill** (learning-phase management, bids, placements, exclusions, frequency) | 🟡 | Encode buyer heuristics as a **checkable policy library** (min budget per ad set, don't edit during learning phase, frequency caps, placement rules); playbook learns which heuristics actually hold per vertical — most human "buyer wisdom" is unverified folklore we can test | policies are hypotheses too; the system is the first buyer whose rules-of-thumb carry measured effect sizes |
| **Retention / LTV thinking** (optimize LTV:CAC, not CPL) | ❌ | Post-purchase WhatsApp sequences (channel exists), repeat-purchase tracking, **LTV-per-audience atoms** → the allocator (§2.2) optimizes on LTV-weighted value, not lead cost. Needs client sales data (§7.2 open question — the lead-quality loop §3.4 is the bridge) | "which audience produces customers who *stay*" becomes a customers-layer atom that reshapes acquisition |
| **Seasonality / timing** | ✅ designed (§2.5) | — | — |
| **PR / organic / community** | 🟡 | Telegram community role (§4) + **review-generation loops** (post-purchase WhatsApp asking happy customers for reviews — which also feeds VoC) + UGC solicitation | community content = bridge atoms at nurture cadence; review asks target customers whose signals were positive |
| **Partnerships / collabs** | ❌ (and see §8.2.5 — this one goes *superhuman*) | Cross-promotion **discovery**: compute audience-atom overlap between non-competing clients in the network → propose collabs, opt-in, both sides consent before any exposure | a human agency stumbles into partnerships; a network computes them |

**Reading of the audit:** the two highest-value missing crafts are **audience research (VoC)** and **competitor watch** — both are *input* pipelines that make the brain dramatically richer at near-zero marginal cost, and both are things human marketers do badly not because they can't but because it's tedious. Which is exactly the §8.2 point.

### 8.2 The superhuman layer — what no human marketer can do

The core of the section. For each limit-break: the capability, the concrete mechanism, and the data/infra it needs.

#### 8.2.1 Never sleeps — the three-tier nervous system

A human checks campaigns once a day at best; the median agency, twice a week. Money burns in the gaps.

```
REFLEX    (minutes)   rule-based, no LLM, whitelisted actions only:
                      pause an ad whose spend spikes with zero conversions,
                      cap runaway budgets, catch delivery collapse,
                      alert (or hide per policy) toxic ad comments
TACTICAL  (daily)     the heartbeat daily tick (§1.2) — verdicts, reallocation, diagnosis queue
STRATEGIC (weekly+)   plans, synthesis, advisory (§1.2)
```

- **Reflex mechanism:** poll Meta insights every ~15 min for *active spending* campaigns (rate limits shard per client ad account — §6.4); maintain `metric_snapshots` with EWMA bands per metric; band-breach → whitelisted reflex action + ledger row + notification. Statistical anomaly detection, deliberately **not** LLM — reflexes must be fast, cheap, and boring. The whitelist at L1/L2 is protective-only (pause/cap/alert — never scale-up).
- **Comment watch** is part of reflex: a negative comment sitting on an ad for 6 hours poisons its social proof; humans check daily at best. We detect in minutes, draft a reply from brand-voice atoms, auto-post or queue per autonomy level. (Comments also flow to VoC mining — one pipeline, two products.)
- **Infra:** `metric_snapshots` table + reflex rules engine + the cron cadence. Effort M. This is the single most *demo-able* superhuman feature: "המערכת שמה לב תוך 12 דקות; הסוכנות שלך הייתה רואה את זה ביום שלישי."

#### 8.2.2 Infinite attention — every client gets the senior marketer

An agency's economics force triage: the ₪50k/day client gets the senior strategist, the ₪50/day client gets the intern and a template. Our marginal cost of rigor is ~flat (§6.3), so **every client gets the full pipeline** — full brain, full diagnosis, full weekly plan.

- Sharper than "everyone gets the same": an **attention scheduler** that allocates *extra* compute by **information value, not revenue** — rank clients each tick by (anomaly score, value of open hypotheses, staleness of atoms, upcoming calendar events). A tiny client on the verge of resolving a high-leverage hypothesis gets more attention today than a big quiet one. No human org can allocate attention this way; incentives forbid it.
- **Infra:** a scoring function over existing ledgers; the heartbeat fan-out consumes the ranking. Effort S. The tier system caps *frequency* (daily vs weekly ticks), never *rigor*.

#### 8.2.3 Perfect memory → episodic recall at decision time

We already never forget (atoms + events + resolved hypotheses). The superhuman step is **total recall at the moment of decision**:

- Embed artifacts, insights, diagnoses, and resolved hypotheses (pgvector on existing tables). Before any material decision, `decide()` retrieves the **k most similar past situations and their outcomes** — this client's *and* (abstracted) the network's: *"לפני 8 חודשים ניסינו מסגור דחיפות ללקוח הזה — נכשל ב-BOFU, היפותזה #12 הופרכה"* enters the context verbatim.
- This is case-based reasoning on top of the atom graph: atoms carry *beliefs*, episodes carry *precedents*. The best human marketer has maybe 200 campaigns of fading, unindexed memory; the system has all of them, indexed, with verdicts.
- **Infra:** pgvector + embedding writes on artifact/diagnosis/hypothesis creation + a retrieval step in the decision context builder. Effort S–M, entirely on existing tables. **Highest leverage-per-effort item in this section.**

#### 8.2.4 Massively parallel experimentation — an experiment portfolio manager

A human tracks 5–10 tests before losing the thread. Our constraint is *budget and statistics*, never attention. So the ceiling becomes: **maximize information per shekel**.

- **Experiment portfolio manager** over the hypothesis ledger: sequential testing with early stopping (bandit-style — kill clear losers before full budget), power floors before launch (never start a test the budget can't resolve — at ₪50/day that's a real discipline humans skip), and **hierarchical pooling through the atom graph**: a hook losing across 3 audiences resolves *the hook atom once*, not three isolated tests — evidence flows along the graph, multiplying effective sample size. Small clients get statistics through structure, not spend.
- Cross-client pooling (abstracted, §2.6) makes the network the sample: a pattern needing 10k impressions per client resolves across 20 clients in days.
- **Infra:** test-design module (power calc, arm allocation) + pooled resolution in the lifecycle engine. Effort L — but it sits entirely on the §3.1 ledger.

#### 8.2.5 Cross-client meta-learning — the network as one marketer

§2.6 designed the playbook. The superhuman extensions:

- **Live vertical benchmarks:** "what does a dental lead cost in Israel *this month*" — computed continuously from the fleet, where every human marketer guesses from stale blog posts. Feeds verdicts (client-relative AND market-relative) and sales copy.
- **Exogenous-shock detection — the biggest misdiagnosis-killer in the doc:** when CPM spikes across *many clients simultaneously*, it's an auction-level event (election cycle, war news cycle, iOS change, chag), not fifty clients' creative all failing at once. A solo marketer misattributes this *constantly* — "your ads got worse" when the market moved. Fleet view makes it trivially detectable: daily fleet-level factor check; on shock, diagnoses are suppressed/reframed ("שוק, לא אתה") and atoms are protected from false weakening. **No human marketer, however brilliant, has this instrument — it requires being many marketers at once.** Effort S once ≥10 clients exist.
- **Partnership discovery (§8.1):** audience-overlap computation across consenting, non-competing clients → proposed cross-promotions. The network isn't just learning together; it can *act* together.

#### 8.2.6 Zero ego, zero fatigue, zero bias — as mechanisms, not virtues

Each cognitive failure of human marketers, mechanically deleted:

| Human failure | Mechanical deletion |
|---|---|
| Sunk cost ("I spent 3 weeks on this creative") | Kill rules read *evidence only*; the decision engine has no record of effort invested, so it literally cannot weigh it |
| Confirmation bias (reading results to fit the thesis) | **Pre-registration:** hypothesis resolution criteria are written *before launch* (§3.1); the verdict is computed against the registered prediction, not narrated after |
| Recency bias (last week looms largest) | Lifecycle math weights the whole evidence history; decay is a tuned constant, not a mood |
| Pet ideas (the founder's favorite angle) | Every idea — including the owner's (§8.4) — enters the same test policy with the same floors |
| Fatigue/burnout (client #14 on a Friday) | Client #400 at 3am gets a bit-identical process |
| **Uncalibrated confidence** (no human tracks their own hit rate) | **Calibration tracking:** score every resolved hypothesis prediction (Brier score); the system *knows* whether its 0.8 confidence means 80% — and per-domain calibration feeds back into confidence math. A marketer that measures its own judgment is unprecedented. Effort S on the ledger |

#### 8.2.7 Instant synthesis — every decision made with everything in view

A human holds ~7 things in working memory; a weekly report takes an analyst hours to compile and is stale on arrival. Every `decide()` call already reads the brain; the superhuman completion is the **full-context decision**: atoms + snapshot + episodic precedents (§8.2.3) + open hypotheses + calendar + fleet context (benchmarks, shocks) + live metrics — composed in seconds, for *every* decision, *every* time, with prompt caching making it economical (§6.3). Nothing to invent here; it's the discipline of wiring every §8.2 stream into one context builder — which is why the context builder is architecture, not plumbing.

#### 8.2.8 Iteration in minutes, not weeks

The human agency loop: weekly meeting → brief the designer → 3 days of production → traffic it → read it next meeting. **Two weeks per iteration, ~2 iterations/month.** Ours: reflex detects (minutes) → diagnose (minutes) → regenerate the failed link (minutes) → publish → Meta ad review (~15min–24h, now *the* bottleneck — not us) → reading gated only by statistics floors. Net: **10–30× more iteration cycles per shekel per month**, each one pre-registered and remembered. Compounding beats brilliance: a mediocre-but-honest learner iterating 25×/month outruns a genius iterating twice.

### 8.3 What's genuinely new — capabilities marketing has never had

Not "better at the old job" — categorically new objects:

1. **The immortal client brain.** Agency knowledge lives in employees' heads; average account-manager tenure is ~18 months, and the knowledge walks out the door with them. The brain never resigns, never gets reassigned, and compounds for the life of the business. Switching agencies resets a client to zero; switching *to* us is the last reset they ever do. (This is also the retention moat stated honestly: leaving means abandoning your brain.)
2. **Falsifiable marketing, at scale.** Marketing "knowledge" has always been folklore — courses, threads, gurus, unverified. The hypothesis ledger + pre-registration + network pooling produce the first **library of reproduced marketing findings with effect sizes**. "What works" stops being an opinion.
3. **Fully traceable causality.** Every shekel traces insight → decision → artifact → outcome → learning, machine-readable end to end. "Explainable marketing" as a category: an auditable answer to *why did we spend this and what did we learn* — which no agency, and no human, can produce for even one campaign.
4. **Network-scale learning (the Waze effect).** Every campaign anywhere makes every client's marketing smarter — knowledge transfers as verified quantified priors in hours, not as blog posts over years. A human's experience is capped by one career; the system's grows with the fleet.
5. **The instant 10,000-campaign veteran.** Day-1, a new client gets a marketer with the network's entire verified experience *and* a rapidly deepening understanding of their specific business. That combination — maximal breadth AND maximal per-client depth, simultaneously — is structurally impossible for a human, who trades one for the other.
6. **A marketer that measures its own judgment.** Calibration tracking (§8.2.6) makes the system's confidence *mean something* and improve. No human marketer has ever known their own hit rate.

### 8.4 The honest limits — where a human still wins, and the closing strategy

| Human advantage | Honest assessment | Close / complement |
|---|---|---|
| **Novel creative leaps** (the "Just Do It" lateral jump) | Real. LLMs interpolate brilliantly; true lateral leaps are rarer | Reserve explicit **wild-variant slots** in the exploration budget (high-temperature, cross-domain analogy prompts); more importantly, build the **human-idea injection surface**: the owner/marketer drops in a raw idea, the system gives it a fair pre-registered test. *Human creativity as an input, machine discipline as the filter* — the combination beats either alone |
| **Relationships & trust** (lunch, reputation, the handshake) | We don't do lunch. Ever | Don't fight it — the Agency tier makes the human *with* the relationship superhuman. The design partner is the relationship layer; the system is their leverage |
| **Brand intuition / long-horizon brand building** | Direct-response is measurable in weeks; brand builds in years and our loop is tuned to weeks | Be honest: we are DR-first. Brand-voice atoms + lint (§8.1) prevent damage; add slow brand metrics (branded search volume, direct traffic, returning reach) to the monthly tick later. Don't claim brand mastery yet |
| **Strategic judgment on the business itself** ("your real problem is the product") | We advise from marketing evidence (§2.7); a great consultant reads rooms, founders, and cap tables we never see | The monthly conversational check-in (§7.2) narrows the input gap; position advisory as evidence-backed input to the owner's judgment, not a replacement |
| **Cultural / crisis judgment** (Israeli context: politics, security situation, religious sensitivity) | Genuinely dangerous terrain for automation | Sensitivity guardrails + human escalation, plus one **partially superhuman** move: a fleet-level "national mood" switch (e.g. Home-Front-Command state, major-news detection) that pauses upbeat creative across all clients within minutes of a מצב — faster than any agency juggling 40 clients on a terrible morning |
| **Physical world** (shoots, events, influencer handshakes) | Out of scope | The system *briefs* the humans who do it (shot lists and scripts from atoms) — it directs; it doesn't attend |

The pattern across all six: **complement, then absorb.** Every gap is closed either by making a human's contribution a first-class *input* to the machine's discipline, or by narrowing the input gap over time. None of them undermines the core loop.

### 8.5 The capability ladder — leverage vs effort, ordered

`[stack]` = enabled by what's already built, thin new code · `[build]` = genuinely new construction · effort S/M/L.

**Rung 1 — superhuman on the current stack (build first: highest leverage-per-effort)**
1. **Episodic memory retrieval** (§8.2.3) — pgvector over existing tables + retrieval in `decide()` context. `[stack]` S–M
2. **Pre-registration + kill rules** (§8.2.6) — resolution criteria at hypothesis creation; evidence-only kill policy. Rides §3.1. `[stack]` S
3. **Calibration tracking** (§8.2.6) — Brier scoring over resolved hypotheses. `[stack]` S
4. **Exogenous-shock detection** (§8.2.5) — fleet-level factor check; needs ≥10 clients but is trivial math. `[stack]` S (waiting on fleet size, not code)

**Rung 2 — the always-on layer**
5. **Reflex tier + comment watch** (§8.2.1) — `metric_snapshots`, EWMA rules engine, whitelisted actions. `[build]` M — *the most demo-able superhuman feature; sales-critical*
6. **Attention scheduler** (§8.2.2) — information-value ranking over existing ledgers. `[stack]` S
7. **Brand-voice atoms + generation lint** (§8.1) — mechanical 100% brand coverage. `[build]` M

**Rung 3 — the input engines (make the brain superhumanly fed)**
8. **VoC ingestion** (§8.1) — reviews + own-ad comments → customer atoms with real quotes. `[build]` M
9. **Competitor watch** (§8.1) — Ad Library longevity mining → bridge/positioning atoms. `[build]` M
10. **Messaging architecture + funnel-as-object** (§8.1) — projections over atoms; coverage measurability. `[build]` M

**Rung 4 — the scale organs (need fleet and/or sales data)**
11. **Experiment portfolio manager with hierarchical pooling** (§8.2.4). `[build]` L
12. **Live vertical benchmarks + playbook consumption** (§8.2.5, §2.6). `[build]` M code, long data runway
13. **LTV loop** (§8.1) — needs client sales/lead-outcome data. `[build]` M
14. **Partnership discovery** (§8.2.5) — needs fleet + consent flows. `[build]` M

**Sequencing logic:** Rung 1 is nearly free and immediately sharpens every decision the heartbeat makes — build alongside the Wave-3 heartbeat MVP. Rung 2 is the *visible* superhuman layer (reflex speed is what a prospect can feel in a demo). Rung 3 makes the brain's inputs superhuman, widening the moat per client. Rung 4 is where the network itself becomes the marketer — the endgame that no single-client tool can ever copy.

---

## 9. The self-marketing test — AdMaster markets AdMaster

> **The validating milestone.** The day the system runs a real, owner-approved, real-spend campaign whose client is AdMaster itself — full loop: brief → brain → decision → publish → spend → measure → diagnose → improve → digest — is the day we *know* whether this is the best marketer in the world, or exactly where it isn't yet. This is the first paying-grade client, campaign #1, and it is us.

### 9.1 Why it's the right first campaign

1. **The ultimate dogfood.** Every weakness surfaces when it's our own money and our own leads: a generic angle, a lazy diagnosis, a wrong reallocation — we feel it immediately and fix the *system*, not the campaign. No design partner should see the loop before it has run on us.
2. **It produces the case study no competitor can write:** "המערכת הזאת שיווקה את עצמה — הנה המספרים, הנה כל החלטה ולמה." The weekly digest of the self-campaign, published nearly verbatim, IS the launch content — every claim carries its causal trace (§8.3.3).
3. **It directly serves GTM (§5.3 Path A upgraded):** the campaign's output is real leads for the design-partner funnel. Validation, case study, and pipeline are the same spend.
4. **It's the honest benchmark:** if the system can't market a product whose brain we can seed perfectly, the vision needs revision before anyone pays us.

### 9.2 The brief — AdMaster as client (seeding the 3 layers)

Filled through the real flow (`/clients` → brief → orchestrator), not hand-inserted — the intake pipeline is part of what's under test. What the brief must convey, by layer:

**business** — real_solution: "לא כלי תוכן — משווק שעובד בשבילך: מתכנן, מפרסם, מנהל תקציב, מאבחן ומדווח"; usp: "מוח חי שלומד את העסק שלך ומסביר כל החלטה"; true_value: "שיווק ברמת סוכנות ב-5–10% מהריטיינר"; proof: the self-campaign itself + live metrics.

**customers** — two sub_audiences: (a) Israeli SMB owners paying ₪3.5k–15k/mo retainers; (b) freelance marketers / micro-agencies juggling 5–15 clients. pains: retainer cost; opacity ("על מה אני משלם?"); slow agency iteration; being the small client who gets the intern; (for marketers) drowning in manual work. unspoken_want: "שמישהו פשוט יטפל בזה — בלי שאצטרך להבין שיווק"; (marketers) "להכפיל לקוחות בלי להכפיל שעות". objections: "תוכן AI זה גנרי"; "לא סומך על אוטומציה עם תקציב הפרסום שלי"; "עוד כלי שאני צריך לתפעל"; "העסק שלי מיוחד, AI לא יבין אותו".

**bridge** — seeded angles the system will *test, not trust*: **retainer-math** (cost anchor); **transparency** ("סוכנות ששולחת לך כל שבוע למה היא עשתה כל דבר"); **it-learns-you** (the brain-reveal, answers "העסק שלי מיוחד"); and the meta-angle — **"המודעה הזאת נכתבה, פורסמה ומנוהלת ע״י המשווק-AI שהיא מפרסמת"** — self-referential proof, unavailable to any other advertiser on earth. Each objection atom must map to funnel content (autonomy ladder ↔ budget-trust objection; brain demo ↔ generic-AI objection) — the §8.1 coverage matrix, exercised for real.

### 9.3 The campaign the system should generate and run

- **Structure (the engine decides; this is the expected shape, and deviations are informative):** 3–4 angle arms as pre-registered hypotheses (§3.1) — e.g. "transparency beats retainer-math on CVR for SMB owners; meta-angle wins CTR for marketers" — Meta paid (₪100–150/day total, learning floors respected per §2.2) + organic posts on AdMaster's own page + the founder's warm-network distribution.
- **Funnel:** ad → landing (brief-teaser + the brain-build demo §5.4 as the hero — the wow is credential-free) → lead → **WhatsApp sequence** (InforU, dogfooding C2) handling the objection atoms → demo/founder-price offer for design partners.
- **The loop must run itself:** weekly heartbeat plans it, reflex/daily ticks watch it, every underperformance gets a diagnosis with a counterfactual A/B, every diagnosis regenerates only the failed link, the digest lands each week — **the founder acts as an L1 client (approve/reject via digest), not as the operator.** Manual intervention beyond approvals = a logged system-gap finding.
- **Duration:** 4–6 weeks — enough for ≥2 full diagnose→improve cycles and atom drift worth reading.

### 9.4 Success criteria — what proves it worked

| Dimension | Criterion |
|---|---|
| **Business** | ≥20 qualified leads; ≥3 design-partner conversations; CAC trending under ~2 months of Starter revenue (≤₪800) by week 4 — *direction matters more than the absolute at this spend* |
| **Loop (the real test)** | ≥3 hypotheses resolved with pre-registered verdicts; ≥1 full diagnosis→auto-improve cycle with measurable recovery on the accused link; ≥5 atom lifecycle events driven by performance/VoC (not manual edits); week-4 plan demonstrably different from week-1 *because of* accumulated atoms — with the `insight_events` trail proving it |
| **Marketer behavior** | founder stayed an L1 client — zero operator interventions beyond approvals; every action in the ledger carries grounded_in + rationale; ≥1 useful advisory/proposal we didn't ask for |
| **Artifact** | 4–6 weekly digests publishable as the case study with ≤ light redaction |

**Failure is also success:** every criterion missed becomes a precise, prioritized Wave-3+ work item. The self-campaign is the system's own diagnosis loop applied to the system.

### 9.5 What must be true first — the exact dependency list

| # | Dependency | Status ref |
|---|---|---|
| P1 | Parallel-session **security audit fixes** merged; branch green (tsc + tests + build) | in flight (other session) |
| P2 | **H4** — Meta App ID/secret, scopes, redirect URIs; OAuth connect verified on AdMaster's own page + ad account. **Note: own-account = dev-mode works — the self-campaign does NOT wait for App Review (defangs R1 for this milestone)** | EXECUTION-STATUS H4 |
| P3 | **Image wiring for live paid creatives** — master-studio stores a prompt, not a URL (the known deferred item); live ads need real image URLs end-to-end | EXECUTION-STATUS Wave-2 deferred |
| P4 | **Money gate** — owner-approved budget (₪100–150/day cap), spend caps enforced, unpause flow via digest/command-center | MONEY gate |
| P5 | **Heartbeat MVP** — weekly tick + digest + one-tap approve (§1.2/§7.4); without it this is a tool demo, not a marketer test | Wave 3 (new build) |
| P6 | **AdMaster landing + lead capture** wired to attribution (exists: landing_pages + attribution capture) | mostly built |
| P7 | *(enhancer, not blocker)* **C2** InforU creds → WhatsApp funnel live; email fallback (H2) otherwise | C2/H2 |

Everything above is already on the map — **this milestone adds no new scope; it sequences existing scope toward a single validating event.** When P1–P6 are true, the first real campaign is AdMaster marketing AdMaster: the system proving, with its own money and its own causal trail, that the first AI marketer exists — or handing us the exact, pre-registered list of why not yet.

---

*Ideation/design only. No code, no schema changes implied until reviewed. Companion to `AI-MARKETER-MASTERPLAN.md` (execution SoT: `EXECUTION-STATUS.md`).*
