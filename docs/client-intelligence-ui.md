# Client Intelligence UI — making the living brain visible (design)

> **Why:** the brain runs automatically on brief-submit (orchestrator → 3-layer atoms → synthesis → snapshot, no manual step), but a real user sees **none** of it. This screen turns the hidden IP into the felt product: *"an AI that actually learns your client — and shows you what it knows, why, and gets smarter as you teach it."*
> **Design only.** No code. Data already exists: `client_insights` (+ `insight_events`), `client_strategy`, `content_artifacts`, `learning_signals`.

## 0. Where it lives
The per-client page **`/clients/[id]`** (today a near-empty workspace) becomes the **Client Intelligence home**. Structure as a vertical scroll (or tabs): **Identity → 🧠 Living Knowledge → 🎯 Strategy → ✍️ What we made from it → 🔄 Teach the system → ⚙️ Meta connect (optional)**.

## 1. The auto-run is made *visible* (build-in-progress state)
The single biggest fix: the user must **watch the brain build**, not wonder if anything happened.
- Right after brief-submit, the client page shows a live state: **"🧠 המערכת לומדת את הלקוח…"** with a 3-step ticker — *קוראת את הבריף → מחלצת תובנות (עסק / לקוחות / גשר) → מסנתזת אסטרטגיה* — driven by polling `client_strategy.core_generated_at` (and an atom count).
- On completion (~60–90s) it **reveals** the knowledge with a subtle "נבנו N תובנות" flourish. The brief→knowledge moment is the product's "wow."
- Re-submit / "רענן" shows the same, framed as *update* ("המערכת מעדכנת מה שהיא יודעת").

## 2. 🧠 Living Knowledge — the 3-layer card wall (the centerpiece)
Three labeled columns, each a stack of **insight cards** sorted by confidence:

| Column | From `client_insights.layer` | Card kinds shown |
|---|---|---|
| **🏢 העסק** | `business` | real_solution, real_usp, true_value, pain_solved, core_offer, goal, constraint |
| **👥 הלקוחות** | `customers` | pain, desire, aspiration, dream, **unspoken_want** (highlighted), objection, awareness_level, persona |
| **🌉 הגשר** | `bridge` | value_translation, angle, hook, platform, funnel_fit |

**Each insight card shows:**
- The insight **content** in plain Hebrew (the headline).
- A **confidence meter** (0–100 bar + label "ביטחון גבוה / בינוני / נמוך"; color-coded). Confidence is first-class — it's how "the AI is sure-ish vs. guessing" becomes felt.
- A **source chip** with icon: 📋 מהבריף · ✓ ממשוב "עבד" · 📊 מביצועים (Phase B) · 🤖 מהסקה. (`client_insights.source`.)
- A **freshness** line ("נוצר לפני יומיים", "עודכן היום").
- A **"למה?" affordance** → opens the card's **history timeline** (see §3).
- Per-card **✓ / ✗** micro-actions (teach directly on a knowledge atom — §5).
- `unspoken_want` cards get a special "💡 מה שהם לא אומרים" treatment — this is the differentiator insight type.

Header strip above the wall: **"N תובנות פעילות · ביטחון ממוצע X% · עודכן <date>"** + a small confidence-by-layer summary, so accumulation is visible at a glance.

## 3. "It's LIVING" — accumulation, provenance, supersession
This is what separates it from a static "AI summary." Convey it three ways:

1. **Per-insight history timeline** (from `insight_events`): "נוצר מהבריף (0.70) → חוזק ע״י משוב 'עבד' על פוסט (0.85) → ...". The plain-language causal line: **"המערכת מאמינה ש‘הלקוח קונה ביטחון, לא טיפול’ כי: הופיע בבריף, וחוזק פעמיים ממשוב על תוכן שעבד."**
2. **"מה השתנה" activity feed** (client-wide `insight_events`, newest first): a teachable-moment log — *"✓ חיזקת תובנה: ... → ביטחון 0.72→0.85"*, *"↪︎ ידע עודכן: 'X' הוחלף ב-'Y' כי סימנת 'לא נכון'"*, *"➕ תובנה חדשה מהבריף המעודכן"*. This is the "the system is alive" surface.
3. **"ידע קודם (הוחלף)" archive** — superseded/refuted insights are **struck-through and collapsed**, never gone, each with its `superseded_reason` and a **"שחזר"** action (recoverable). Shows the system marks-not-deletes — trustworthy memory.
- Subtle ↑/↓ deltas on confidence since last visit reinforce motion.

## 4. 🎯 Strategy — the synthesized snapshot in plain language (passive, free)
Render `client_strategy.business_analysis` (the StrategyAnalysis projection) as a **readable narrative**, NOT a 2-credit generate action (that's the current `/analyze-brief` flaw):
- **סיכום אסטרטגי** (goal · core offer · USP · constraints), **הקהל המומלץ** (sub-audience + awareness tag + persona), **פלטפורמה ומשפך** (each reasoned), **הערכת הצעה**.
- Labeled **"מסונתז מ-N תובנות פעילות · עודכן <date>"** with a **"רענן אסטרטגיה"** action (re-run, costs credits) — but the view itself is free and always current. Deprecate `/analyze-brief` as the primary strategy view.

## 5. 🔄 Teach the system — the signal loop, made the point
- The ✓ עבד / ✗ לא נכון control appears **on every generated artifact AND on every insight card** (`learning_signals` → lifecycle engine). Copy: **"כל סימון מלמד את המערכת ומעדכן מה שהיא יודעת על הלקוח."**
- After a signal, show the **immediate effect inline**: "👍 חיזקת — ביטחון עלה ל-0.85" or "✗ סומן כשגוי — המערכת תעדכן את ההבנה" (and the atom moves to the archive / a corrected atom appears). The loop closing is **visible**, so teaching feels consequential.
- A "✗ לא נכון" on an insight prompts an optional one-liner ("מה הנכון?") → seeds the corrected atom.

## 6. ✍️ What we made from it — content ↔ insights traceability
A list of the client's `content_artifacts` (posts/ads/images/…), each row:
- Content snippet + **tags** (framework / angle / funnel_stage).
- **"מבוסס על:"** chips for each `insight_ids` atom that grounded it → click a chip to jump to that insight card. This is the literal answer to "which insights produced this post."
- The ✓/✗ signal control (feeds §5).
- (Phase B) a performance row + the **diagnosis** ("הוק חלש → ...") once Meta data exists — the failed-link isolation surfaced here.

## 7. How the "AI that learns" feeling is engineered (cross-cutting)
- **Confidence everywhere** (bars/labels) → "sure vs. guessing."
- **Provenance per atom** (📋/✓/📊/🤖) → "it knows *because*."
- **Freshness/recency** (timestamps, "עודכן") → "it's current/alive."
- **Accumulation visible** (counts, history timelines, growing activity feed) → "it remembers and grows."
- **Causality in words** ("מאמין ש-X כי Y") → "it reasons."
- **Visible loop** (signal → confidence move → next post grounded differently) → "it learns from me."
- **Marks-not-deletes archive** → "trustworthy memory."

## 8. Phased build order (UI)
1. **Read-only Living-Knowledge wall** (§2) + **Strategy snapshot view** (§4) on `/clients/[id]` — passive reads of `client_insights` + `client_strategy`. Highest value, lowest risk.
2. **Build-in-progress state** (§1) — poll `core_generated_at`; the brief→knowledge reveal.
3. **Signal loop on insights + immediate effect** (§5) — wire ✓/✗ on cards to `/api/intelligence/signal`, show the confidence move.
4. **History timeline + activity feed + superseded archive** (§3) — read `insight_events`.
5. **Content↔insights traceability** (§6) — `content_artifacts.insight_ids` chips.
6. **(Phase B)** performance + diagnosis rows (needs Meta).

> Net: §1–§3 alone convert the invisible brain into "holy-cow, it understood my client" — that's the product. The rest deepens the "it learns" loop. New API surface is light (read endpoints for insights/events/artifacts; the signal POST already exists). No schema changes.

*Design only. No code. On review we build in the §8 order.*
