---
name: marketing-strategy
description: Expert marketing strategy craft for AdMaster's AI marketer — positioning, messaging hierarchy, offer engineering, and funnel architecture, all derived from the client's 3-layer insight atoms (business/customers/bridge). Use when designing or reviewing a client strategy, building a positioning statement, constructing a messaging architecture, engineering or fixing an offer, designing a funnel, writing decision-engine prompts that make strategic choices, or diagnosing strategy-level failures. Israeli SMB market aware. Do NOT use for copy execution (use copywriting-craft) or test design (use creative-testing-discipline).
---

# Marketing Strategy — the craft the decision engine applies

Strategy = choosing what to say, to whom, against what alternative, with what offer, through what path. Every choice below must be **derivable from atoms and traceable back to them** (`grounded_in`). If a strategic choice can't cite an atom, it's a guess — flag it as a hypothesis to test, not a decision to run.

## 1. Positioning — own a slot against a real alternative

Positioning is not "what we do." It is **the customer's mental shortcut for why us, instead of the thing they'd otherwise do.**

### The positioning statement (build from atoms)
```
For {sub_audience atom} who {pain/desire atom},
{client} is the {category_frame}
that {usp/true_value atom},
unlike {alternative atom} which {alternative's weakness}.
```

### Rules of craft
- **The alternative is rarely a named competitor.** For most Israeli SMBs it's: doing nothing, DIY, the cousin who does it cheap, or the incumbent habit. Position against the *real* alternative the customer weighs — ask "what would they do if we didn't exist?" If no `alternative` atom exists, that's a knowledge gap: mine it (VoC, brief follow-up) before positioning.
- **Category frame decides the price anchor.** "עוד סוכנות" anchors to retainer prices; "משווק AI" creates a new anchor. Choose the frame that makes the price feel obviously fair. Reframing the category is the highest-leverage positioning move and the hardest to copy.
- **One position per sub-audience.** Different sub_audience atoms may need different framings of the same truth — that's fine. Two *contradictory* positions for one audience is not.
- **Test for ownability:** could the competitor claim the same sentence? If yes, it's not positioning, it's description. Sharpen until the claim is specific to this client's proof atoms.

### Failure smells (diagnosis hooks)
- CTR fine + CVR weak across ALL angles → positioning/offer level, not creative. Check whether the landing frames the same category as the ad.
- "We tried every angle and nothing sticks" → usually a missing alternative atom: you're answering a question the customer isn't asking.

## 2. Messaging hierarchy — one promise, few pillars, mapped proof

A message architecture prevents the #1 SMB content failure: every post says something different, nothing compounds.

### Structure (a projection of atoms — rebuild when atoms drift)
```
CORE PROMISE   — the single top-confidence translation atom (business value → customer want).
                 One sentence. Everything else supports it.
PILLARS (3–4)  — each pillar = a desire/objection cluster:
                 pillar_1: the main desire (aspiration atoms)
                 pillar_2: the main objection, pre-answered (objection atoms)
                 pillar_3: the mechanism/proof ("how it actually works" — real_solution atoms)
                 pillar_4 (optional): identity/belonging (unspoken_want atoms)
PROOF POINTS   — each proof atom assigned to exactly one pillar. Unassigned proof = unused ammunition.
```

### Rules of craft
- **Every artifact expresses exactly one pillar** (tag it). Multi-pillar assets dilute; the feed does the mixing across posts, not one post.
- **Coverage discipline:** track content-per-pillar over rolling 30 days. A pillar with zero content is a strategic decision being made by accident.
- **The objection pillar earns disproportionate BOFU budget.** Israeli buyers are objection-forward ("כמה זה עולה", "מה הקאץ'"); pre-handling the top objection in content converts better than avoiding it.
- **Awareness gradient:** the same pillar speaks differently per awareness level (Schwartz): unaware → story about the pain; problem-aware → the mechanism; solution-aware → the differentiator; product-aware → the offer; most-aware → the deadline. Never serve most-aware copy to an unaware audience (feels like a scam) or vice versa (feels like a waste of time).

## 3. Offer engineering — the objection→component coverage matrix

The offer is where campaigns die silently. Great creative cannot sell a weak offer; a strong offer forgives mediocre creative.

### The value equation (evaluate every offer against it)
```
Perceived value = (dream outcome × believed likelihood) / (time to result × effort/sacrifice)
```
Raise the numerator with proof and specificity; cut the denominator with speed and done-for-you framing. Price is judged against this quotient, not against cost.

### The coverage matrix (mechanical, checkable)
List every active `objection` atom (confidence ≥ 0.5). Every one must map to an offer component that neutralizes it:

| Objection type | Neutralizing component |
|---|---|
| "יקר לי" (price) | payment split · price anchor vs the alternative's true cost · ROI framing · entry tier |
| "לא יעבוד אצלי" (fit) | guarantee · trial · case study of a same-segment customer · personalization proof |
| "אין לי זמן" (effort) | done-for-you · onboarding promise ("תוך X דקות") · "אנחנו עושים הכול" |
| "לא סומך" (trust) | risk reversal · social proof volume · authority marker · "בלי התחייבות" |
| "לא עכשיו" (urgency) | honest deadline · cohort/capacity limit · cost-of-delay framing |

**Uncovered objection = open strategic gap** → either add a component (advisory to the owner) or expect the diagnosis engine to keep blaming the offer link. Never "fix" an uncovered objection with louder creative.

### Rules of craft
- **Guarantees are the most under-used lever in the Israeli SMB market** — owners fear them; data says refund rates stay low while CVR jumps. Propose the strongest guarantee the unit economics survive.
- **Urgency must be true.** Fake countdowns burn trust atoms permanently. If no honest deadline exists, engineer one (cohort start, monthly capacity) or drop urgency.
- **Name the offer.** "חבילת השקה" beats a list of deliverables. A named offer becomes an atom (`core_offer`) and a memorable ad object.
- **One offer per funnel.** Multiple offers in one path split conviction. Test offers *sequentially* or in separate funnels, never stacked in one landing.

## 4. Funnel architecture — design the path as an object

A funnel is nodes and edges with expected conversion per edge — not "TOFU/MOFU/BOFU" vibes.

### Design procedure
1. **Start from the sale, walk backwards.** What must the buyer believe at purchase? Which belief does each node install? A node that installs no belief is a leak.
2. **Funnel length = awareness distance.** Most-aware audience: ad → offer (short). Unaware audience: content → retargeting → lead magnet → nurture → offer (long). Choosing funnel length by budget instead of awareness is the classic SMB error — a ₪50/day unaware-audience account cannot afford a long funnel; recommend a warmer audience instead (strategy beats spend).
3. **Every node has a conversion event we can measure**, and an expected rate (client baseline > vertical playbook prior > honest guess, in that order). Diagnosis then localizes to the *edge* whose actual/expected ratio is worst — never redesign the whole funnel when one edge is broken.
4. **WhatsApp is the Israeli BOFU/retention edge.** Lead → WhatsApp sequence outperforms lead → email in IL for SMB services. Design the WhatsApp sequence as funnel nodes (see whatsapp-marketing skill), not an afterthought.
5. **The landing page must continue the ad's scent:** same angle atom, same pillar, same visual register. Angle-switch between ad and landing is a top-3 hidden CVR killer — check it before blaming the offer.

### Funnel review checklist (run on every design)
- [ ] Each node cites the atom(s) it deploys (belief installed).
- [ ] Each edge has an expected rate + measurement event.
- [ ] Top objection handled BEFORE the price is revealed.
- [ ] Ad→landing scent match verified (angle + pillar + register).
- [ ] Follow-up path for non-converters exists (retargeting audience or WhatsApp) — a funnel without a second chance wastes 90%+ of clicks.
- [ ] Mobile-first checked (Israeli Meta traffic is overwhelmingly mobile).

## 5. Strategy-level review — the questions a great CMO asks

Run these before approving any weekly plan:
1. **What are we betting on this week, and which atom says the bet is good?** (No atom → it's exploration; cap its budget.)
2. **What would make us wrong?** (Every plan names its riskiest assumption → that's next week's hypothesis.)
3. **Is spend distributed by conviction?** High-confidence atoms fund exploitation; low-confidence fund small tests. Uniform spend across arms means nobody decided anything.
4. **Does the plan compound?** Every week must leave the brain richer (a resolved hypothesis, a new atom, a stronger baseline) — a week that only "ran ads" was a rented week, not an owned one.
5. **Is anything strategically silent?** A pillar with no content, an audience with no touch, a stage with no follow-up — silence is a decision; make it on purpose.
