---
name: competitor-analysis
description: Expert competitive-intelligence craft for AdMaster's AI marketer — mining the Meta Ad Library (longevity as win-proxy), competitor reviews, positioning maps, and uncontested-angle detection, converted into bridge/positioning atoms. Use when researching a client's competitors, deciding which angles are contested vs open, building alternative/competitor atoms, running a periodic competitor watch, or informing positioning decisions. Israeli-market aware. Do NOT use for extracting customer language from reviews (use voc-mining — competitor reviews feed both).
---

# Competitor Analysis — find the uncontested lane

The purpose is NOT to copy competitors. It is to learn (a) what the market has already **paid to validate**, (b) which angles are **saturated** and which are **open**, and (c) what the real **alternative** in the customer's head is — so positioning and angle selection are moves on a real board, not solitaire.

## 1. Define the competitor set (most people get this wrong)

Three rings — analyze all three, weight by the customer's view (not the owner's ego):
1. **Direct:** same offer, same audience, same geography. The owner names these (brief), but verify with the customer's comparison set from VoC ("אחרי שבדקתי גם את…") — customers often compare across categories the owner ignores.
2. **Category alternative:** a different offer solving the same pain (private clinic vs קופת חולים; done-for-you vs a course).
3. **The non-consumption alternative:** doing nothing, DIY, postponing. For most Israeli SMBs THIS is the biggest competitor — and it's beatable with urgency/cost-of-delay angles, not features.

Cap active tracking at ~3–5 entities; more is noise. Revisit the set quarterly or when VoC surfaces a new name.

## 2. Meta Ad Library mining — the longevity method

The Ad Library (facebook.com/ads/library) shows every active ad per page — a free window into what competitors are *currently* paying to run.

### The core inference: **longevity ≈ profitability**
An ad running 3+ months is almost certainly paying for itself — nobody funds a loser for a quarter. Ad age is the closest thing to seeing a competitor's conversion data.

### Per-competitor read (repeat monthly)
1. **Inventory:** number of active ads, launch dates (the Library shows start date), formats (image/video/carousel), platforms.
2. **The veterans** (running > 8–12 weeks): decode each — what angle, what hook structure, what offer, what awareness level? These are the market's **validated angles**. Tag each with the angle taxonomy used for our own artifacts.
3. **The churn** (ads that appeared and vanished within ~2–4 weeks): failed tests. What angles do they keep *trying and dropping*? A repeatedly-attempted-and-dropped angle is market evidence of a hard sell — treat any plan to run it as a low-prior hypothesis.
4. **Volume moves:** sudden burst of new ads = a push (new offer, funding, season); total silence = budget off (opportunity: cheaper auctions, orphaned demand).
5. **Landing pages:** click through — offer structure, price display, funnel length, scent handling. The landing tells you their economics better than the ad.

### What we can and can't see
- CAN'T see: spend, targeting, performance (except EU-shown ads with reach data, and political ads). Everything is inference — label the confidence accordingly.
- CAN see: creative, copy, start date, active/inactive, platform spread, all their landing funnels. That's plenty.

## 3. The angle-coverage map → uncontested-lane detection

Build a market map: rows = angles present in the market (from all competitors' veteran ads), columns = competitors, cells = who runs what and how hard.

```
                comp A   comp B   comp C   → market weight
price/deal        ██       ██       █        SATURATED
speed/convenience ██       —        █        contested
authority/expert  —        ██       —        thin
emotional-safety  —        —        —        OPEN  ← the lane
identity/belonging—        —        —        OPEN
```

**Decision logic (feeds the decision engine):**
- **Open lane + supporting customer atom** (e.g., an emotional-safety desire atom with decent confidence) = the highest-value strategic bet available. Prioritize it.
- **Open lane + NO supporting atom** = either an untapped opportunity or an empty lane *because it doesn't work*. It's a hypothesis — test small before betting the positioning. Check competitor churn (§2.3): if others tried-and-dropped it, prior drops further.
- **Saturated lane:** enter only with a structurally better offer or proof — otherwise you're paying premium CPMs to be ignored. If the client's current angle sits in a saturated lane, that's a strategy-level diagnosis finding.
- Store the map's conclusions as atoms: `alternative` (kind, per competitor with their weakness), bridge-layer angle atoms annotated `structured.contested: true/false`, and `category_frame` observations. The map itself is re-derivable; the atoms are the durable knowledge.

## 4. Competitor reviews — their weakness is your positioning

Send competitor review corpora through voc-mining with a different extraction goal:
- **2–3★ reviews are the gold tier:** engaged-but-disappointed customers state the unmet expectation precisely ("הטיפול טוב אבל חיכיתי שעה", "מקצועיים אבל מרגישים כמו מספר"). Recurring themes = the market's open wounds → each is a candidate differentiator IF the client genuinely doesn't share the weakness (verify against the client's own reviews first — claiming a differentiator you don't have is a churn machine).
- **5★ competitor reviews** tell you their actual strength — the thing NOT to attack head-on (positioning judo: concede their strength, own a different axis).
- Output: `alternative` atoms with `structured.weaknesses[]` + `structured.strengths[]`, each carrying quote evidence.

## 5. Israeli-market specifics

- **The recommendation-group economy:** local FB groups ("המלצות על…", neighborhood groups) largely decide SMB reputations. Watch who gets organically tagged when someone asks — *that* ranking is the true competitive standing, regardless of ad spend. A competitor with heavy ads but no organic tags is buying what they can't earn (weak retention — attackable); one with strong tags and no ads is sleeping (their awareness gap is your TOFU opportunity).
- **Price transparency norms:** in many Israeli verticals competitors hide prices ("שלחו הודעה"). If the map shows universal price-hiding, *showing* the price (or a clear range) is itself an uncontested trust angle — repeatedly validated pattern.
- **Hebrew search the market like a customer:** "X מומלץ", "X מחיר", "X ביקורות" — what surfaces (ads, reviews, forum threads) is the actual consideration journey. Google's autocomplete on the client's category is a free objection/desire list.
- Watch competitor activity around **chagim windows** — who pushes before Rosh-Hashana/Pesach reveals their seasonal playbook; plan counter-programming or avoidance.

## 6. The watch cadence + output contract

**Cadence:** full map rebuild quarterly; light pass monthly (new ads, killed ads, volume moves); event-triggered on VoC naming a new competitor or a fleet-level anomaly in the client's vertical.

**Every watch run must produce:**
1. **Delta report:** new veteran ads (validated angles), newly killed campaigns, volume moves, new entrants.
2. **Atom actions:** new/updated `alternative` atoms (with weakness/strength evidence), angle atoms re-flagged contested/open, `category_frame` shifts.
3. **Strategic flags for the planner:** open-lane opportunities (with/without supporting atoms), saturated-lane warnings on currently-running angles, counter-programming timing notes.
4. **Never:** copy competitor creative. Decode the *angle and structure*, then generate from the client's own atoms — both for ethics/IP and because copied creative carries none of the client's proof.
