---
name: creative-testing-discipline
description: Expert experiment-design craft for AdMaster's AI marketer — single-variable isolation, pre-registration of hypotheses, sample floors, early-stopping/kill rules, and explore/exploit budgeting for creative, audience, and offer tests. Use when designing any A/B or multi-arm test, writing hypothesis-ledger entries, deciding test budgets and durations, resolving test verdicts, or reviewing whether a "learning" is statistically real. Do NOT use for diagnosing why something failed (use diagnosis-reasoning) — this skill designs the tests that diagnosis requests.
---

# Creative Testing Discipline — information per shekel

A test exists to resolve a claim about an atom. If a test can't change what the brain believes or what the budget does next, don't run it. SMB budgets (₪50–150/day) cannot afford undisciplined testing — structure substitutes for spend.

## 1. Pre-registration — write the verdict conditions BEFORE launch

Every test enters the hypothesis ledger with ALL of these, immutable after launch:

```
CLAIM       the atom-level statement being tested
            ("angle atom #12 'emotional safety' beats angle atom #9 'price' for sub-audience #3")
PREDICTION  metric + direction + minimum effect ("CVR of arm A ≥ 1.3× arm B")
FLOOR       the sample each arm needs before ANY verdict (see §3)
HORIZON     max spend/days before forced resolution (a test that can't end is a leak)
VERDICTS    supported / refuted / inconclusive — with the exact conditions for each
KNOWLEDGE   which atoms move on each verdict, and by how much
```

Why immutable: post-hoc verdict criteria are how humans lie to themselves ("well, CTR improved even though CVR didn't"). The system's honesty is a feature — `inconclusive` is a valid, common, and *recorded* outcome. An inconclusive test moves NO atoms.

## 2. Single-variable isolation — the tag discipline

- **One variable per comparison.** Arms differ in exactly one tagged dimension (angle OR hook OR audience OR format OR offer-component OR landing element). Two simultaneous differences = zero attributable learnings.
- The variable under test must map to ONE atom (or one execution choice). "New creative direction" is not a variable; "angle atom #12 vs #9, same hook structure, same audience, same landing" is.
- **Hold the funnel constant.** Testing an ad variable while the landing also changed invalidates the read (scent interactions). Landing tests are their own tests.
- **Structure:** dedicated test campaign/ad sets so arms get comparable delivery; never test across campaigns with different objectives or bid strategies — Meta's optimizer becomes a confound.
- **Meta's A/B tool vs manual split:** for clean audience-level isolation use Meta's split test (prevents auction overlap); for creative arms inside one ad set, accept Meta's uneven delivery but require the floor per arm before reading (uneven spend ≠ verdict; it's the optimizer's opinion, which is itself weak evidence — log it, don't conclude from it).

## 3. Sample floors — when a number is allowed to mean something

Rules of thumb per arm (client-baseline-aware; these are minimums, not targets):

| Question | Floor per arm |
|---|---|
| CTR / thumbstop (hook, creative) | ≥ 1,000–2,000 impressions |
| CVR (funnel, offer, landing) | ≥ 100 clicks OR ≥ 8–10 conversions total across arms |
| CPA comparison | ≥ 10 conversions per arm (yes, really — below this CPA is a rumor) |
| Lead quality | ≥ 15 owner-marked leads per arm |

- **Small-budget corollary:** at ₪50/day you can afford ~1 CVR-grade test at a time, or 2–3 CTR-grade tests. Design the week's testing to the budget's information capacity — CTR-grade questions first (cheap), CVR-grade only for the highest-value open hypothesis.
- **The pooling escape hatch:** evidence pools along the atom graph. The same hook tested across 3 audiences resolves the *hook atom* on the combined sample; a pattern tested across clients resolves a *playbook prior* on the fleet. Pool before declaring a floor unreachable.
- Never compare across time windows (this week's arm A vs last week's arm B) — auctions drift. Arms run simultaneously or not at all.

## 4. Kill rules & early stopping — sunk-cost immunity, mechanized

- **Early kill (mercy rule):** an arm at ≥ 2× floor with performance < 50% of the leading arm → kill early, reallocate to survivors. Record as `refuted (early)`.
- **Catastrophic kill (reflex-tier):** spend ≥ 3× expected-cost-per-result with zero results → pause immediately regardless of floor; something is broken (see diagnosis-reasoning §1 plumbing first).
- **No zombie tests:** at HORIZON, force a verdict — usually `inconclusive`. An inconclusive test may be redesigned (bigger effect target, pooled, or dropped) but never silently extended: extension after peeking is p-hacking with extra steps.
- **No mid-test edits.** Editing an arm resets its meaning (and Meta's learning). If an arm must change, kill it and register a new one.
- **Kill decisions read evidence only.** The rule cannot see how long the creative took to make, whose idea it was, or how much was already spent. That blindness is the point.

## 5. Explore/exploit budgeting

- **Default split: 70–80% exploit / 20–30% explore**, modulated by brain maturity:
  - New client (few high-confidence bridge atoms): up to 50% explore — wide, cheap, CTR-grade tests across angles; each arm = a different atom.
  - Mature client (proven angles): 15–20% explore floor — NEVER zero. Zero exploration = fatigue cliff with no successor ready (the "one winning ad" death spiral every SMB knows).
- **Priority order for the explore budget** (information value per shekel):
  1. Hypotheses that unblock the most decisions (a sub_audience question gates every campaign aimed at it).
  2. Contested atoms (mid confidence, mixed evidence) — cheapest to resolve, highest belief-movement.
  3. Fatigue successors — new executions of proven angles (insurance, not discovery).
  4. Wild variants (cross-domain, owner ideas) — small fixed slot; genius insurance.
- **Winner graduation:** an arm that wins post-floor moves OUT of the test campaign into the exploit structure with its own budget — don't scale inside the test (distorts remaining arms).

## 6. Reading results — the honesty checklist

Before a verdict touches the brain:
- [ ] Floor met per arm? If not → inconclusive, no atom movement.
- [ ] Arms ran simultaneously, unedited, one variable apart?
- [ ] Plumbing clean (delivery, tracking, no exogenous shock during the window — check the fleet)?
- [ ] Effect ≥ the pre-registered minimum? (A 5% lift on a 1.3× prediction = inconclusive, not "directionally supported.")
- [ ] Verdict recorded with the evidence, atoms moved exactly as pre-registered, ledger closed?
- The forbidden sentence: **"the data suggests"** followed by anything not pre-registered. Post-hoc patterns are hypothesis *candidates* — register them, test them next; never act on them directly.

## 7. Test-design template (fill for every test)

```
HYPOTHESIS   H-{n}: {claim, atom ids}
WHY NOW      {what decision this unblocks / information value rank}
DESIGN       arms: [...], variable: {tag}, constant: {everything else},
             audience: {...}, placement: {...}, structure: {split test | in-adset}
BUDGET       {per arm/day} × {days} → projected {impressions/clicks} vs FLOOR {...}
             (if projection < floor → redesign or pool; do not launch)
PREDICTION   {metric, direction, min effect}
VERDICT MAP  supported → {atom moves}; refuted → {atom moves}; inconclusive → {no moves, next step}
KILL RULES   mercy: {…}, catastrophic: {…}, horizon: {date/spend}
```
