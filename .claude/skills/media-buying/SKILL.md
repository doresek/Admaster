---
name: media-buying
description: Expert Meta media-buying craft for AdMaster's AI marketer — campaign structure, learning-phase management, budgets, bidding, audiences, placements, frequency, and scaling, expressed as checkable heuristics with WHY, tuned for Israeli SMB budgets (₪50–300/day). Use when structuring campaigns/ad sets, setting or changing budgets, choosing objectives/bids/placements, deciding when edits are safe, scaling winners, or reviewing buying decisions for policy violations of these heuristics. Do NOT use for what to say (copywriting-craft) or what to test (creative-testing-discipline).
---

# Media Buying — checkable heuristics with reasons

Buying is where good strategy gets executed or executed-upon. Every heuristic below is written to be CHECKABLE (a policy the runner can enforce or a reviewer can grep a plan against) and carries its WHY — because half of folk buying-wisdom is cargo cult, and heuristics with reasons can be re-tested as playbook hypotheses.

## 1. Objective & optimization-event selection

- **B1. Optimize for the deepest event with ≥ ~30–50 occurrences/month.** Deeper events (purchase > lead > landing view > click) give Meta better signal — but starving the algorithm below ~30/month keeps it permanently confused. SMB reality: most start on Leads/WhatsApp-message optimization, NOT purchases. Graduate deeper as volume grows.
- **B2. Never optimize for clicks/traffic when a conversion event exists.** Click-optimized delivery finds clickers, not buyers — the cheap-traffic trap that makes SMB owners think "פייסבוק לא עובד".
- **B3. WhatsApp-message campaigns are a first-class Israeli objective** — for service SMBs, message-optimized often beats lead-form on lead *quality* (conversation self-qualifies). Pair with fast owner response (funnel node!).
- **B4. One objective per campaign.** Mixed intents inside a campaign confuse budget allocation and make results unreadable.

## 2. Structure — simplicity is a performance feature

- **B5. Default structure: 1 campaign per funnel-stage-objective, 1–3 ad sets (one per sub_audience atom), 2–4 ads each.** Every extra ad set fragments the learning data. Complex structures are for spend levels Israeli SMBs don't have.
- **B6. CBO (Advantage campaign budget) when ad sets ≥ 2 and spend is small** — let Meta allocate across audiences; override with min/max only when a strategic floor exists (e.g., funnel-coverage floor from the allocator). ABO when a test needs guaranteed per-arm spend (creative-testing-discipline §2).
- **B7. Never duplicate an ad set to "restart" it without a reason** — duplication resets learning AND competes with the original in the auction (self-inflicted overlap). Duplicate only for true structural changes.
- **B8. Test campaigns are quarantined from exploit campaigns** (separate campaign) so a test can't drain the winner's budget mid-flight.

## 3. Learning phase — the most violated rules in SMB buying

- **B9. No edits during learning** (until ~50 optimization events/ad set/week). Every significant edit (budget ±>20–30%, targeting, creative swap, bid) RESETS learning. The #1 SMB self-harm pattern is daily fiddling — the account never exits learning, performance never stabilizes.
- **B10. Budget changes obey the ±20–30%/day step rule** (bigger jumps reset learning). Scaling plan: +25% every 2–3 days while performance holds, not 2× overnight.
- **B11. If an ad set can't mathematically exit learning** (daily budget × 7 < 50 × expected CPA-event cost), don't launch it that way — consolidate audiences or optimize for a shallower event. Launching un-exitable ad sets is buying permanent instability.
- **B12. Judge nothing during learning** (diagnosis-reasoning §1). Verdicts start after exit + floor.

## 4. Audiences & targeting

- **B13. Targeting comes from atoms, not Meta suggestions:** sub_audience atom → interests/demo/geo spec (the decision engine's mapping). Meta's suggested interests are contested, expensive defaults.
- **B14. Audience size sanity band:** for ₪50–150/day think ~200k–2M (IL scale). Too narrow → CPM punishment + fast fatigue; too broad on small budget → the algorithm explores forever on someone else's shekel.
- **B15. Broad/Advantage+ is a hypothesis, not a default** — test it against atom-derived targeting once creative is proven (broad works when the creative does the targeting). If broad wins, record the insight ("creative self-selects — audience atoms matter less here for delivery, still matter for message").
- **B16. Exclusions are mandatory hygiene:** exclude converters from acquisition (waste + annoyance), exclude existing page engagers/customers where the offer is new-customer-only. Retargeting pools get their own ad sets with BOFU copy — never mix cold and warm in one ad set (unreadable results, wrong copy for someone).
- **B17. Lookalikes need a seed ≥ ~100 quality events** (ideally 1000). Below that, a LAL is noise wearing a suit. Start 1%, widen (3%, 5%) only after the atom + performance corroborate the seed's quality.
- **B18. Geo for local businesses: radius + drive-time reality, minus dead zones** (a Tel-Aviv clinic ad shown in Haifa is pure waste; Israeli willingness-to-travel is low). City-name in copy must match geo-targeting (scent).

## 5. Placements, frequency, creative-account hygiene

- **B19. Advantage+ placements ON by default at SMB spend** — manual placement exclusion is a spend-level luxury; the exception is placement-inappropriate creative (long text on Stories). Fix the creative before fighting the placement.
- **B20. Frequency bands (cold audiences): healthy < 2.5; watch 2.5–3.5; act > 3.5** with declining CTR → fatigue protocol (fresh execution of the proven angle — diagnosis-reasoning §3.2, NOT an angle change). Retargeting tolerates 4–6 with sequenced messages.
- **B21. Account quality is a shared resource:** policy strikes, high negative feedback (hide/report rates), and rejected ads damage the whole ad account's auction standing. The comment-ops loop (voc-mining §5) and policy-safe copy (copywriting-craft §7) are buying concerns, not just brand concerns.
- **B22. Don't delete — pause.** Deleted objects lose their history; history is the brain's food.

## 6. Bidding & cost control

- **B23. Lowest-cost (no cap) is the SMB default.** Cost caps at small spend usually mean under-delivery (the auction just skips you); use them only with real CPA statistics (≥ 50 conversions of history) and a true unit-economics ceiling.
- **B24. CPM is a market thermometer, not a KPI:** rising CPM across the fleet/vertical = auction event (elections, chagim, Q4) — judge buying by cost-per-outcome, and annotate the period (exogenous shock; protects diagnoses).
- **B25. Every campaign carries spend caps** (daily cap + monthly cap in the runner) and every new/edited paid object starts PAUSED until the autonomy gate passes. Non-negotiable system policy.

## 7. Israeli calendar & auction rhythms

- **B26. Chagim inflate CPMs (Rosh-Hashana/Pesach retail waves) and מבצע/war news cycles crater attention** — the fleet mood-switch pauses upbeat creative; plan conversion pushes AWAY from national-distraction windows; TOFU/brand content tolerates them better.
- **B27. Friday-afternoon → Saturday: delivery shifts, response ops die.** For message/lead objectives with human follow-up, schedule sends where the owner can answer (response latency is a conversion variable in IL — a WhatsApp lead answered after 3 hours is cold).
- **B28. Summer (יולי-אוגוסט) and חגי תשרי weeks scramble B2B; Sunday is a workday.** Weekly plans respect the Israeli week, not the American one.

## 8. Scaling & kill execution (the buying side of decisions)

- **B29. Scale winners by budget steps (B10), THEN by horizontal duplication into new audiences (new sub_audience atoms), THEN by new creative on the winning angle.** Vertical-only scaling hits audience saturation; horizontal-only fragments learning. Alternate.
- **B30. Kill execution ≠ kill decision:** the decision comes from diagnosis/testing rules; the buying execution is: pause (not delete), harvest engaged audiences into retargeting pools before the pixel pool decays, record final metrics into the ledger.
- **B31. The portfolio allocator's constraints are buying law:** learning-phase floors (B11), funnel-coverage floor, exploration reserve, max daily reallocation delta (±25%). Reallocations that violate a floor need a human-visible override reason.

## 9. Plan-review checklist (grep a media plan against this)

- [ ] Objective = deepest event with ≥30/month volume (B1); no traffic-optimization with a conversion event available (B2).
- [ ] Structure ≤ 3 ad sets/campaign, each mapped to a named sub_audience atom (B5, B13).
- [ ] Every ad set mathematically exits learning at its budget (B11).
- [ ] No planned mid-learning edits; scaling steps ≤ 30%/day (B9, B10).
- [ ] Exclusions defined (converters, warm-from-cold) (B16); LAL seeds ≥ 100 events (B17); geo matches copy (B18).
- [ ] Frequency monitoring + fatigue protocol assigned (B20); spend caps + PAUSED-start present (B25).
- [ ] Calendar checked (chagim/news windows, response-ops coverage) (B26–B28).
