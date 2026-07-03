---
name: diagnosis-reasoning
description: Expert failure-diagnosis craft for AdMaster's AI marketer — reasoning from the client's insight atoms to WHY a campaign/ad/funnel failed, isolating the failed link (hook/avatar/creative/funnel/offer), instead of metric-guessing. Use when analyzing underperformance, writing or reviewing diagnosis-engine prompts, interpreting content_performance data, deciding kill vs fix vs iterate, or attributing failure to specific atoms. Do NOT use for designing new tests (use creative-testing-discipline) or strategy design (use marketing-strategy).
---

# Diagnosis Reasoning — from insights to WHY, never metric superstition

The differentiator: a human marketer says "the campaign didn't work"; this system says **which link failed, why, citing the atoms — and what evidence would prove it.** A diagnosis without a causal claim tied to atoms is just a metrics readout.

## 0. The iron rules

1. **Metrics locate, atoms explain.** Metrics tell you WHERE in the chain conviction died. Only the client's atoms can tell you WHY. A diagnosis must contain both.
2. **Never diagnose below the sample floor.** Under ~1,000 impressions (CTR questions) or ~20 clicks (CVR questions), verdict = `inconclusive`. Diagnosing noise poisons the brain — a wrong atom-weakening is worse than no diagnosis.
3. **Check the boring causes first (§1) before any clever causal story.** LLM-style reasoning loves elegant explanations; most failures are plumbing.
4. **Every diagnosis names its confirming test** — the minimal change that, if the diagnosis is right, recovers the metric (counterfactual A/B on ONLY the accused link). An unconfirmable diagnosis is an opinion.
5. **One accused link per diagnosis.** If two links look guilty, the diagnosis is `inconclusive between X and Y` with a discriminating test — never "fix everything."

## 1. The pre-diagnosis checklist (plumbing before psychology)

Run BEFORE causal reasoning. Any hit here invalidates deeper diagnosis:

- [ ] **Delivery:** did it actually spend? Under-delivery = auction/bid/audience-size problem, not message.
- [ ] **Learning phase:** ad set still learning (<50 optimization events)? Metrics are unstable by design — wait, don't diagnose.
- [ ] **Tracking:** are conversion events firing? A "CVR collapse" is often a broken pixel/event, not a broken offer. Verify the event stream before accusing the funnel.
- [ ] **Exogenous shock:** did CPM/CTR move across *other* clients too (fleet check), or is there a calendar event (חג, מבצע בטחוני, elections)? Market-level shifts are NOT client failures — suppress the diagnosis, annotate the period.
- [ ] **Frequency:** frequency > ~3.5 with declining CTR on a previously-winning ad = fatigue, not wrongness (see §3.2).
- [ ] **Recent edits:** was the ad set edited mid-flight (resets learning)? Comparing across an edit boundary is invalid.

## 2. Link isolation — the metric signature table

The chain: **targeting(avatar) → hook → creative → funnel → offer.** Conviction flows left to right; find where it dies.

| Signature | Failed link | Reasoning from atoms |
|---|---|---|
| Impressions OK · CTR low · thumbstop low | **hook** | The promise didn't interrupt. Which desire/pain atom did the hook deploy? Was it low-confidence? Wrong awareness level for this audience? |
| Thumbstop OK · CTR low | **creative/message** | They stopped but didn't care to click — body/visual failed the promise the hook made. Check hook↔body pillar consistency. |
| CTR healthy · landing CVR low | **funnel or offer** | Interest existed, conviction died on the page. Discriminate: scent-mismatch (angle switch ad→landing) = funnel; scent OK but bounce at price/CTA = offer. |
| CVR OK · lead quality bad (owner marks לא רלוונטי) | **avatar/targeting** | Converting the wrong people. The sub_audience atom is off, or the angle attracts an adjacent-but-wrong segment. |
| Reach poor · CPM high vs baseline · relevance weak | **avatar/targeting** | Meta can't find receptive people — audience too narrow, or creative-audience mismatch signals low quality. |
| One avatar fails across MANY hooks/angles | **avatar (customers-layer atom)** | The insight about who they are is wrong — weaken/supersede the sub_audience atom, don't burn more hooks on it. |
| One angle fails across MANY avatars | **bridge atom (angle/translation)** | The translation business-value→customer-want is wrong. Weaken the bridge atom. |
| Everything mediocre, nothing sharply broken | **positioning/offer (strategy level)** | No link is broken because no link was strong. Escalate to strategy review (marketing-strategy skill §5) — do not micro-optimize a flat campaign. |

**Cohort logic is the power move:** single-ad metrics are noisy; comparisons across tagged artifacts (same hook different audiences; same audience different angles) isolate the variable. Always prefer a cohort read over a single-ad read.

## 3. Reasoning from atoms — the WHY layer

After locating the link, explain it from the client's knowledge:

### 3.1 The atom cross-examination
- Which atoms grounded the failed artifact (`grounded_in`)? For each: is the failure *consistent with the atom being wrong*, or with the atom being right but *executed wrong*?
  - Example: angle hit "physical pain relief" but the high-confidence atom says customers buy "emotional safety" → the artifact contradicted the brain; execution error, atoms intact, regenerate on the right atom.
  - Example: angle correctly deployed the 0.55-confidence "price is the blocker" atom and BOFU still died → evidence against the atom; weaken it, and surface the rival hypothesis (e.g., trust, not price).
- **Contradiction between artifact and brain is diagnosis gold:** if the artifact ignored a high-confidence objection atom (price objection unhandled on the landing), the diagnosis writes itself — and the fix is regeneration, not atom changes.

### 3.2 Fatigue vs wrongness (only an atom system can tell these apart)
- Angle atom high-confidence + historically winning + CTR decaying + frequency climbing + creative age > ~3 weeks → **fatigue**: refresh executions, KEEP the angle, do NOT weaken the atom.
- Angle atom weak/contested + losing across fresh creatives and audiences → **wrongness**: weaken the atom, rotate angle.
- Writing "fatigue" when it's wrongness wastes budget; writing "wrongness" when it's fatigue destroys a true atom. When unsure: one fresh execution of the same angle is the discriminating test.

### 3.3 Evidence weight discipline
- One ad's performance = weak evidence (weight ~0.2) — moves confidence, never flips status.
- Repeated, cross-cohort, post-floor losses attributable to one atom = decisive — supersede with a corrected atom, citing the evidence trail.
- An owner's explicit signal (✗ לא נכון) outweighs single-ad metrics. A confirmed counterfactual test outweighs both.

## 4. The diagnosis output contract

Every diagnosis must contain, in this order:
1. **Plumbing cleared:** checklist §1 passed (state which items were checked).
2. **Location:** the failed link + the metric signature that points there (cohort compared to what baseline).
3. **Cause:** the atom-level WHY — accused atom(s) by id, or "execution contradicted atom X".
4. **Confidence:** high (signature clean + cohort agrees + atoms consistent) / medium / low (flag for human).
5. **Confirming test:** the single-variable change that proves it, with its expected effect if right.
6. **Knowledge action:** corroborate / weaken / supersede which atoms — or "no atom change" (execution error).

## 5. Kill vs fix vs double-down

- **Fix** when: one link accused with medium+ confidence AND the grounding atoms survive. Regenerate ONLY that link; A/B against original.
- **Kill** when: the grounding atom got superseded/refuted (the bet's premise died), OR two fix cycles failed the confirming test, OR opportunity cost — the budget's expected value is clearly higher on an open hypothesis. Killing is a positive act: it resolves a hypothesis and frees budget. Record what was learned; never "pause and forget."
- **Double-down** when: post-floor outperformance vs client baseline + the grounding atoms corroborated by the win + frequency headroom. Scale in steps (≤ +25–50%/day; big jumps reset learning), and *say which atom the win corroborates* — a win that corroborates nothing is a lottery ticket, investigate before scaling.
- **Never kill on metrics alone.** Diagnosis precedes execution — the whole point of the system.

## 6. Worked micro-example (the canonical shape)

> Campaign X, ad set "הורים 35–50": 14k impressions, CTR 2.1% (baseline 1.6%), 210 clicks, 2 leads (CVR 0.95% vs baseline 4%).
> Plumbing: spend normal, events firing (test lead traced), no fleet CPM shift, frequency 1.8, learning done.
> **Location:** CTR above baseline + CVR collapse → funnel/offer link.
> Scent check: ad angle = "ביטחון רגשי" (atom #12, conf 0.85); landing headline = price-led "20% הנחה" → **angle switch ad→landing = funnel scent break**, AND objection atom #7 ("פחד מתוצאה לא טבעית", conf 0.7) is unaddressed on the page.
> **Cause:** funnel link; execution contradicted atoms #12/#7 — atoms intact, no weakening.
> **Confidence:** high. **Confirming test:** landing variant with emotional-safety headline + objection-#7 answer above the fold; expect CVR recovery toward ≥2.5% at same traffic.
> **Knowledge action:** none to atoms; log execution-gap pattern "landing not regenerated when angle changed" for the runner.
