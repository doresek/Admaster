---
name: voc-mining
description: Expert voice-of-customer mining craft for AdMaster's AI marketer — extracting customer language, pains, desires, objections, and buying triggers from reviews (Google/Facebook), comments on the client's own running ads, competitor reviews, and community threads, and converting them into 3-layer insight atoms with evidence. Use when enriching a client's customers-layer atoms, harvesting hook/copy raw material in authentic customer words, processing ad comments, analyzing review corpora, or designing VoC ingestion prompts/pipelines. Hebrew/Israeli source-material aware.
---

# VoC Mining — the customers layer, fed by actual customers

The brief is the *seed* of the customers layer, not its ceiling. Real customer language beats any persona: customers tell you their pains, objections, comparison sets, and the exact words that would have sold them — you just have to mine it. The best marketers read reviews for hours; this system does it continuously.

## 1. Source hierarchy (signal quality, best first)

| Source | Signal | What it uniquely yields |
|---|---|---|
| **Comments on the client's OWN running ads** | Highest — live, targeted, free | Objections *to this exact offer* ("כמה זה עולה?", "יש סניף בצפון?"), skepticism patterns, unexpected desire signals. Also an ops duty: unanswered objections poison the ad's social proof |
| **Client's reviews (Google/Facebook)** | High — verified buyers | Why they REALLY bought (often ≠ the brief's claim), the before-state ("אחרי שנים של…"), trust triggers, the exact praise vocabulary |
| **Competitor reviews — especially 2–3★** | High — the market's unmet middle | What the alternative fails at = uncontested positioning lanes; what buyers wish existed = offer components |
| **Community threads** (FB groups, local forums) where people ask for recommendations | Medium — pre-purchase state | The words of someone who doesn't know the category yet (unaware/problem-aware language — TOFU gold), the questions they ask before buying |
| **Sales conversations / WhatsApp threads** (when the owner shares them) | Very high but sparse | The last objection before yes; the phrasing that closed |

**1–2★ own reviews:** mine separately — they're churn/expectation data (offer + funnel atoms), and each one needs an owner alert anyway.

## 2. What to extract — the seven extractables

For every source document, hunt these, verbatim:

1. **Pain language** — the words for the before-state. Keep tense and person ("הייתי מתביישת לחייך" — not "בעיות ביטחון עצמי"). The customer's phrasing IS the hook.
2. **Desire/outcome language** — what they say the result gave them. Note: it's often emotional/social while the brief says functional ("סוף סוף יש לי שקט" vs "טיפול יעיל").
3. **Objections & hesitations** — "כמעט לא באתי כי…", "פחדתי ש…", price flinches, distance/time excuses, trust doubts. Every one is an offer-coverage requirement (marketing-strategy §3).
4. **The comparison set** — what they almost did instead ("אחרי שניסיתי X", "במקום ללכת ל…"). This populates `alternative` atoms — the raw material of positioning.
5. **Buying triggers** — the moment that flipped them ("אחרי החתונה של…", "כשהילד אמר לי…"). Triggers = campaign timing + angle hooks.
6. **Trust markers** — what made them believe (a specific person's name, "בלי לחץ", "ענו לי תוך דקה"). These become proof atoms and BOFU copy.
7. **Identity phrases** — how they describe themselves ("אמא של שלושה", "בן אדם של בוקר"). Feeds sub_audience personas in *their* words.

## 3. Extraction discipline — from quotes to atoms

- **Quote first, abstraction second.** Every extracted item = `{verbatim_quote, source_ref, extractable_type}` → then rolled up. An atom without quotes attached is opinion; with 5 quotes it's evidence.
- **Frequency = confidence fuel.** One review saying "פחדתי שיכאב" is an anecdote (seed atom at ~0.3–0.4). Twelve across sources = a load-bearing objection atom (0.7+, `evidence_count` = quote count). Recurrence across *independent sources* (reviews + ad comments + groups) weighs more than recurrence within one.
- **Map to atom kinds:** pain→`pain`, desire→`desire`/`aspiration`, unstated-but-implied→`unspoken_want`, objection→`objection`, comparison→`alternative`, trigger→`structured.trigger` on the relevant atom, trust marker→`proof`, identity→`sub_audience`/persona enrichment. Source is always `voc` with the quote bundle in `source_ref`.
- **Reconcile, never blind-add:** new VoC evidence corroborates or contradicts existing atoms through the normal lifecycle (evidence_count++, weaken, supersede). VoC contradicting the brief is a *feature* — the owner's self-image losing to customer reality is exactly the depth the brain promises. Surface such contradictions to the owner as insight, gently.
- **Segment-tag every quote** when discernible (age markers, gender, role, geography) — an objection held only by one sub-audience is targeting information, not a global truth.

## 4. Hebrew/Israeli source specifics

- **Dugri is data:** Israeli reviewers are blunt — "אל תלכו" and "שווה כל שקל" are clean polar signals. Mine superlatives with suspicion though: "מדהים!!! ממליצה!!!" with no specifics carries near-zero information; the informative review is the one that tells a story.
- **The "ממליצים על…?" group post** is the single richest Israeli VoC format: the asker reveals the trigger and the objections; the comments reveal the comparison set and trust markers (who gets tagged, and what's said about them — including about the client and competitors).
- **Read gendered language:** Hebrew grammar reveals the speaker's gender — audience composition data for free across a review corpus.
- **Sarcasm and irony** ("ברור, כי יש לי כסף לזרוק") invert polarity — flag low-confidence rather than misread.
- **Emoji/punctuation register** signals audience age/culture — feeds copy register decisions (copywriting-craft).
- **Names and PII in quotes:** strip person names/phones from stored quotes; keep the language pattern, drop the identity.

## 5. Ad-comment operations (the live wire)

Beyond mining, comments demand a response policy — comments are public funnel surface:
- **Question comments** ("מחיר?", "איפה אתם?") = hot leads decaying by the hour → answer fast in brand voice, move to DM/WhatsApp ("שלחנו לך הודעה 🙂"), and log the question as objection/friction evidence (if many ask the price, the ad or landing is hiding it — funnel finding).
- **Objection comments** = answer publicly (everyone reads it — it's free BOFU copy), log as objection atom evidence.
- **Praise comments** = engage briefly (boosts distribution), harvest as proof quotes (ask permission before quoting in ads).
- **Toxic/troll** = hide (don't delete — deletion provokes screenshots), never argue. Repeated topical attacks (not random trolling) may still be market data — log the theme.
- Every comment thread read feeds §2 extraction — one pipeline, two products (ops + intelligence).

## 6. Output contract (what a VoC run must produce)

1. **Quote bank delta:** new verbatim quotes, typed and source-refed.
2. **Atom actions:** corroborations (atom id + new evidence_count), new candidate atoms (with starting confidence per §3), contradictions raised (atom id + the conflicting quotes).
3. **Copy ammunition:** the 5–10 strongest verbatim phrases, tagged by funnel stage fit (pain phrases → TOFU hooks; trust markers → BOFU proof).
4. **Coverage flags:** objections with no offer component (→ marketing-strategy §3 matrix), questions the funnel fails to answer (→ funnel fix), praise themes the messaging doesn't use (→ unused pillars).
5. **Owner surfacings:** brief-vs-customers contradictions, 1–2★ alerts, permission asks for quotable praise.
