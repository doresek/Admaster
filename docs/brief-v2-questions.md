# Brief v2 — owner-first questions (design)

> **Goal:** stop empty-brief submits, and feed the 3-layer brain (`client_insights`) with answers a **business owner** can actually give — while keeping every existing professional question as OPTIONAL depth.
> **Design only** — no code. Builds on the Phase-A brain (analysis → atoms). On approval we wire it into the brief form + the deep-analysis prompt.

## 1. Principle: required core, optional depth
- **Today:** a brief can submit completely empty → the analyzer has nothing → weak/empty insights.
- **v2:** **Group A (owner) is REQUIRED** (submit blocked until answered); **Group B (professional) is OPTIONAL**. The brain works from A alone, and gets richer when B is filled.

## 2. UI structure
1. **Group A — "שאלות לבעל העסק"** shown FIRST, all required (submit disabled until each has content). Plain owner language, generous textareas, friendly helper text.
2. **Group B — "שאלות מקצועיות (אופציונלי)"** — a **collapsible** section below ("פתח שאלות מתקדמות"), all current questions, all optional. Pre-filled/answered briefs keep working.
3. A small progress hint ("ענית על X מתוך Y שאלות חובה").

## 3. GROUP A — owner questions (REQUIRED) + brain mapping

Each Group-A answer feeds the deep-analysis prompt and seeds `client_insights` atoms in the mapped **layer / kind**. (The analyzer still infers *beneath* the words — these are the raw material.)

| # | id | Question (Hebrew, owner language) | Feeds layer | Primary insight kind(s) |
|---|---|---|---|---|
| A1 | `own_about` | **ספר על העסק שלך כאילו אתה מספר לחבר** — מה אתה עושה, ולמי? | business | `real_solution`, `true_value` |
| A2 | `own_differative` | **מה אתה עושה שאחרים בתחום שלך לא עושים?** | business | `usp` |
| A3 | `own_cost_of_no` | **אם לקוח היה בוחר לא לקנות ממך — מה הוא היה מפסיד?** | business → bridge | `pain_solved` (business) + `translation` (bridge: value↔loss/cost-of-inaction) |
| A4 | `own_happy_customer` | **מי הלקוח הכי מרוצה שלך — ומה הוא קיבל ממך?** | customers | `sub_audience`, `desire`, `aspiration` |
| A5 | `own_unspoken_need` | **מה לקוחות שלך צריכים — אבל לא יודעים לבקש?** | customers | `unspoken_want`, `pain` |

**Bridge layer:** mostly **inferred** by the analyzer by combining A1–A2 (business value) with A4–A5 (customer wants) into `translation`/`angle` atoms; A3 explicitly seeds a bridge `translation` (the cost-of-inaction framing). No separate required owner question for bridge — it's synthesized.

**Required validation:** each A-field needs non-trivial content (e.g. ≥ ~10 chars, not whitespace). Submit button disabled until A1–A5 pass.

## 4. GROUP B — professional questions (OPTIONAL, unchanged)
Keep **all** current brief fields exactly as they are, just marked optional and moved into the collapsible section. From the existing brief (`lib/ai-context.ts` FIELD_LABELS_HE):
- **Business/offer:** `biz_name`, `biz_what`, `biz_result`, `biz_time`, `biz_price`, `biz_usp`, `offer_anchor`, `offer_price`, `offer_bonuses`, `offer_guarantee`, `offer_urgency`, `offer_cta`
- **Customer/psychology:** `cust_who`, `cust_income`, `pain_main`, `pain_internal`, `desire_dream`, `obj_main`, `obj_tried`, `obj_fear`, `mkt_awareness`
(Plus the presence/links + extras sections if present in the current form.) When filled, these map to the same layers at higher confidence (they're already structured for the marketer): offer_* → business/bridge, pain_*/desire_* → customers, mkt_awareness → customers `awareness_level`.

## 5. How it flows into the brain
- On submit, `briefs.values` carries A (required) + any B (optional).
- `analyzeToInsights(briefValues, existingActiveInsights)` reads BOTH groups; Group A is the guaranteed-present core (so insights are never empty), Group B raises confidence/coverage where present.
- Atoms get `source='brief'`; re-submits reconcile (corroborate/supersede) per the lifecycle engine.
- `synthesizeStrategy` projects active atoms → `client_strategy`; `buildAiContext` grounds generation.

## 6. Open choices for your review
1. **Exact required threshold** (min length / "don't know" allowed?) — recommend ≥10 non-space chars, with an explicit "לא בטוח" escape that still counts as answered but is flagged low-confidence.
2. **Group A count** — 5 feels right (owner won't abandon). Add a 6th business/proof question (`own_proof`: "ספר על מקרה שבו עזרת ללקוח") only if you want stronger `proof`/`true_value` atoms.
3. Whether to **pre-map** Group-A answers directly into atoms on submit, or let the analyzer derive everything (recommend: analyzer derives — keeps one path, richer inference).

*Design only. No code. On approval: wire Group A required + Group B collapsible into the brief form, and tune the analysis prompt to consume the owner-language fields.*
