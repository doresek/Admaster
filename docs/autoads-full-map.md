# AutoAds — Full App Map (live, logged-in deep crawl)

> **Method:** logged into `auto-ads.io` (Hebrew UI) on 2026-06-29 via browser MCP, read-only — no data created/edited/deleted, no generation triggered, no Meta connected, nothing submitted. Mapped by navigating + reading the DOM/accessibility tree of existing screens and existing generated content. Account: `elirankahalani27@gmail.com` (1,480 credits, 8 clients).
> **Supersedes guesswork.** This is the source of truth for matching AutoAds. Where I could not observe something without mutating data (e.g. triggering a paid generation), it is explicitly flagged.

## ⭐ Headline findings (read these first)
1. **A client is a business CONTACT, not a Meta entity.** Create form = **name (required) + email + phone + company + notes**. **No Meta token field anywhere in creation.** Page is titled "דשבורד / ניהול לקוחות הארגון" — never "Meta clients".
2. **Meta is a tiny optional card on the *existing* client page** ("חיבור Meta Ads / חבר חשבון פייסבוק"), connected LATER via OAuth. Every client shows a "לא מחובר / פייסבוק לא מחובר" status pill. It is never part of creation.
3. **There is NO standalone "marketing strategy analysis" artifact** (no Strategic-Summary / awareness-tagged-sub-audience / platform+funnel / offer-stack document) on the client, the brief, or the generation entry screens. The "strategy" is expressed as: **(a) the deep BRIEF** (the strategic input), **(b) per-ad FRAMEWORK/ANGLE tagging** (AIDA, Story, Us-vs-Them, BAB, PAS, Direct-Offer, Direct-Logic…), and **(c) "angle memory"** that carries angles across campaigns. ⚠️ A separate 2-credit "strategy analysis" as the user recalled was **not found in the live app** — see §6 for the honest caveat (it may render transiently inside a generation *output*, which I could not trigger read-only).

---

## 1. CLIENT MODEL

### 1.1 Create-client form (modal "לקוח חדש", from dashboard) — EXACT fields
| Field | Required | Notes |
|---|---|---|
| **שם** (Name) | ✅ | `יצירה` (Create) button stays **disabled** until name is filled |
| **אימייל** (Email) | – | plain text |
| **טלפון** (Phone) | – | plain text |
| **חברה** (Company) | – | plain text |
| **הערות** (Notes) | – | free text |

Buttons: **ביטול** (Cancel) · **יצירה** (Create, disabled w/o name) · Close (X). **No Meta, no token, no industry/emoji, no awareness — pure contact.**

### 1.2 Client card anatomy (dashboard grid)
- Initials avatar + **name** (H3) + 3 small icon buttons (edit/…) top-corner.
- **Contact rows w/ icons:** email, phone, company (each shown if present).
- For one client (עמותת עולל) the card shows a long **free-text description** paragraph instead of company — i.e. notes/description can render on the card.
- **Status block:** brief status — **"ללא בריפינג"** OR **"בריפינג הושלם (100%)"**, sometimes **"נשלח ללקוח (לפני N ימים)"** (sent-to-client N days ago); optional **draft/approved/published counts** ("N טיוטות · N מאושרות · N פורסמו"); a **Meta pill "לא מחובר"**; actions **"בריפינג"** + **"פתח"** (Open → client-home).

### 1.3 Dashboard (`/he/dashboard`) layout
- Greeting "ערב טוב, <name> 👋" + "N קרדיטים · N לקוחות".
- Title "דשבורד" / sub "ניהול לקוחות הארגון". Actions: **ייצוא CSV**, **לקוח חדש**.
- Counters: לקוחות, קרדיטים. Search box "חיפוש לפי שם, אימייל או חברה...".
- Grid of client cards (§1.2).
- **Sidebar (persistent):** active-client switcher ("לקוח פעיל / <name>") · **ניווט ראשי**: דשבורד · **כלי יצירה**: יצירה וניהול מודעות, סדרות מסרים, דפי נחיתה, היסטוריה · **הגדרות וניהול**: מנוי וקרדיטים, הגדרות, תמיכה. Top bar: theme toggle, language, logout, search, "מה חדש?", notifications.

---

## 2. CLIENT DETAIL (`/he/client-home?client=<uuid>`)

Top-to-bottom:
1. **Breadcrumb** דשבורד › <name>.
2. **Header:** initials avatar + name (H1) + company sub-line + **"פייסבוק לא מחובר"** pill.
3. **"איך עובדים? תהליך העבודה" — a 5-step WORKFLOW strip** (each step has a status chip "הושלם"/"מומלץ עכשיו" + an action button):
   1. **אישור בריף** — "מלאו ואשרו את הבריף של הלקוח" → **ערוך בריף**
   2. **יצירת מודעות** — "צרו קמפיין מודעות מתוך הבריף" → **צור קמפיין**
   3. **דף נחיתה** — "בנו דף נחיתה שאליו המודעות מפנות" → **צור דף נחיתה**
   4. **העלאה במרכז הבקרה** — "אשרו והעלו את המודעות לפייסבוק" → **פתח מרכז בקרה**
   5. **סדרות מסרים** — "צרו מייל, וואטסאפ ו-SMS להמשך הקשר" → **צור סדרת מסרים**
4. **Stat counters (clickable):** N טיוטות · N מאושרות · N פורסמו.
5. **"פעולות מהירות" (Quick Actions) — 10 buttons:** צור מודעה · צור תמונה · קמפיין · דף נחיתה · מייל · וואטסאפ · SMS · רב-ערוצי · נהל מודעות · מרכז הבקרה.
6. **"חיבור Meta Ads" card** (badge "חדש"): "חבר את חשבון הפייסבוק של הלקוח" → **חבר חשבון פייסבוק** (OAuth). This is the ONLY Meta entry point — small, optional, on the existing client.
7. **"הבריף" card** (action **ערוך בריף מלא**) — the brief rendered as **5 grouped Q&A sections** (this is the deep strategic input):
   - **בוא נכיר את העסק (והנשמה שמאחוריו):** שם העסק · במה העסק עוסק · המוצר/שירות לקדם עכשיו · שפת המודעות · סיפור ההקמה · הפנים מאחורי המותג (פרזנטור? בשמך/בשם המותג) · מי אתה/רקע · השליחות.
   - **איפה אפשר לראות אתכם?:** אתר/דף נחיתה · אינסטגרם · פייסבוק · טיקטוק · לינקדאין · יוטיוב · לינקים נוספים.
   - **מה הלקוח מקבל? (הצעה לעומק):** מחיר · מה כלול בחבילה · צ׳ופר/בונוס · אחריות · למה לקנות מכם ולא מהמתחרים · "מרכיב הקסם" · התהליך מרכישה לתוצאה · סיפור הצלחה.
   - **מי הלקוח ומה כואב לו? (פסיכולוגיה עמוקה):** הבעיה הכי גדולה · איך הוא מרגיש · החיים אחרי · התירוץ הכי נפוץ · המחשבה המפחידה · מיתוסים וטעויות · הסטטוס החדש.
   - **עוד משהו שחשוב שנדע?:** free text.

> The brief card displays answers read-only with an "ערוך בריף מלא" edit affordance. The fill/wizard UI itself was not opened, but the field set above is complete (read off a 100%-complete brief).

---

## 3. THE FULL FLOW (observed)

```
לקוח חדש (contact: name+email+phone+company+notes)   ← NO Meta
      │
      ▼
בריפינג  (5-section deep brief; can be "נשלח ללקוח" to fill, or filled in-app)  → "בריפינג הושלם (100%)"
      │
      ▼
יצירת מודעות  →  צור מודעה (text, 1cr/ad)  ·  קמפיין (full text+image, 3cr/ad)  ·  צור תמונה
      │           generates N framework/angle-tagged ad variations from the brief
      ▼
ניהול מודעות (/he/ad-review):  טיוטה → שלח לאישור (client portal) → מאושר / נדחה
      │
      ▼
מרכז הבקרה: אשרו והעלו את המודעות לפייסבוק   ← requires Meta connected (optional, per-client OAuth)
      │
      ▼
דף נחיתה (landing)  +  סדרות מסרים (מייל/וואטסאפ/SMS follow-up)
```
- **Meta connect is OPTIONAL and late** — only needed to *upload* ads (step "מרכז הבקרה"). Everything up to approval works with no Meta.
- **"זיכרון זוויות" (angle memory):** the campaign builder shows "🧠 זיכרון זוויות פעיל - 10 זוויות מקמפיינים קודמים נלקחות בחשבון / מתוך 2 קמפיינים אחרונים", with a toggle "אני רוצה זוויות חדשות לגמרי". So angles persist per-client across campaigns to avoid repetition.

---

## 4. GENERATION SURFACES

| Surface | URL | What it does | Cost | How it uses the client |
|---|---|---|---|---|
| **יצירת טקסט AI** | `/he/create-ad-ai` | Pick client + output language (auto-by-brief) + choose **ad templates** (סיפור, אנחנו מול הם, PAS, AIDA, BAB, לוגיקה ישירה, הצעה ישירה וטכנית, TikTok/Reel, עסקים משעממים) + N variations slider + advanced options + "הנחיה מהירה" | **1 credit/ad** | reads the brief; tone/language "auto by brief" |
| **צור קמפיין** | `/he/create-campaign` | Full ads (headline+text+image) in one click; N ads (≤10); image formats **1:1 / 4:5 / 9:16**; **angle memory** toggle | **3 credits/ad** | reads brief + prior angles |
| **צור תמונה** | (image gen) | images by style/ratio | – | – |
| **ניהול מודעות / ad-review** | `/he/ad-review` | Tabs **טיוטה(N) / נדחה / מאושר / מרכז הבקרה**; each saved ad tagged by **framework/angle** + status; **שלח לאישור** (client approval), edit, attach image | – | per-client ad library |
| **יצירה וניהול מודעות (hub)** | `/he/ad-creation-hub` | Entry: one-click full campaign · step-by-step (1 טקסט → 2 תמונות → 3 ניהול) · **המעבדה 🧪** (remix existing text+images into new ads — **0 tokens**, Basic+ plan) | – | – |
| **סדרות מסרים** | `/he/messaging-hub` | Email / WhatsApp / SMS series for follow-up | (not opened) | reads brief |
| **דפי נחיתה** | `/he/landing-pages` | Landing pages the ads point to | (not opened) | reads brief |
| **היסטוריה** | `/he/history` | All generated content history | (not opened) | – |
| **מרכז הבקרה** | (control center) | Approve + upload ads to Facebook; needs Meta | – | per-client Meta |

**Generated-ad anatomy (from real drafts):** each = framework/angle label (e.g. "AIDA", "Story", "Us vs. Them") + **headline** + **body copy** (in the brief's chosen language — here English) + optional image + date + **שלח לאישור**. No per-ad "strategy" block — the framework label IS the strategy tag.

---

## 5. ACCOUNT / SETTINGS / BILLING (from nav; not deep-opened)
- **מנוי וקרדיטים** `/he/billing` — subscription + credit balance (credit-metered like AdMaster).
- **הגדרות** `/he/settings` — per the prior recon: פרופיל / ארגון / צוות / תוכנית שותפים / תבניות. **No Meta connection in settings** (Meta is per-client only).
- **תמיכה** `/he/support`, community WhatsApp link, "הקורס לשימוש".

---

## 6. ⚠️ The "strategy analysis" question — honest result
The deep **2-credit, 4-section marketing strategy analysis** (Strategic Summary / awareness-tagged sub-audience / platform+funnel rec / offer-stack assessment) that motivated AdMaster's `feat/strategy-analysis` (#32) was **NOT found as a standalone artifact** anywhere in the live AutoAds app I crawled: not on the client card, client-home, brief card, ad-creation, campaign builder, hub, or ad-review. AutoAds' actual "strategy" surface area is: the **deep brief** (input) + **framework/angle-tagged ad variations** (output) + **angle memory** (continuity).

**Why this might differ from the screenshots that prompted the request:**
- The analysis may render **transiently inside a generation OUTPUT** (e.g. a rationale/angle panel shown right after clicking "צור קמפיין"). I **could not** verify this without triggering a paid generation (21 credits for this client) which would create drafts — out of the read-only scope.
- It may be a different/older feature, a different plan tier, or a conflation of the framework-tagged output with a "strategy."

**Recommendation:** if you want certainty on the generation-output strategy panel, authorize a **single cheap generation** (1 ad = 1 credit on `create-ad-ai`) on a throwaway/QA client and I'll map exactly what the output renders. Until then, AdMaster's `StrategyAnalysis` (#32) is *richer than AutoAds' visible model*, not behind it.

---

## 7. GAP TABLE — AutoAds (real) vs AdMaster (current), prioritized

| # | Dimension | AutoAds (mapped) | AdMaster (current) | Gap / action | Priority |
|---|---|---|---|---|---|
| 1 | **Client = contact** | Create form: name+email+phone+company+notes; **no Meta** | `/clients` still had token-paste in creation (PR #31 made token optional but kept the field + "לקוחות Meta" title; create still errors on phantom token) | Rebuild `/clients`: contact form (name+email+phone+company+notes), title "לקוחות", **remove token from creation**; **migration 026** adds email/phone/company (SQL provided) | **P0** |
| 2 | **Meta = optional, late, OAuth** | Small "חיבור Meta Ads" card on existing client; OAuth; pill "לא מחובר"; only needed to upload | OAuth exists (#10/#21) but creation is Meta-first; token-paste legacy path in UI | Move Meta entirely to an optional card on the client; drop token-paste from UI; client card = primary | **P0** |
| 3 | **Client-home workflow strip** | 5-step guided strip (brief→ads→landing→upload→messages) w/ status + per-step CTA | No equivalent guided client-home; we have a generic dashboard + FirstRunHero | Build a per-client home with the 5-step workflow strip + quick actions | **P1** |
| 4 | **Brief = 5-section deep Q&A** | Rich brief (identity/soul, presence, offer-depth, deep psychology, extras) — the strategic input | We have a brief + orchestrator + StrategyAnalysis (#32) | Align our brief questions to AutoAds' 5-section set; our analysis is already richer (keep) | **P1** |
| 5 | **Strategy** | Implicit: brief + framework/angle tags + **angle memory** across campaigns | Explicit `StrategyAnalysis` (4 sections) on the client (#32) — *more* than AutoAds shows | Keep #32; **add "angle memory"** (persist used angles per client to avoid repetition) — a real AutoAds feature we lack | **P1** |
| 6 | **Ad templates/frameworks** | 9 named templates (סיפור, אנחנו מול הם, PAS, AIDA, BAB, לוגיקה ישירה, הצעה ישירה וטכנית, TikTok/Reel, עסקים משעממים) | We have FRAMEWORKS (PAS/AIDA/BAB/…) in master-studio | Add "סיפור", "אנחנו מול הם", "עסקים משעממים", "TikTok/Reel" angle templates if missing | P2 |
| 7 | **Full-campaign one-click** | "צור קמפיין שלם" = headline+text+image, N ads, formats 1:1/4:5/9:16, 3cr/ad | We have quick-campaign + master post | Add a one-click full-campaign (copy+image) producer with format choice | P2 |
| 8 | **Ad approval pipeline** | טיוטה → שלח לאישור (client portal) → מאושר/נדחה → מרכז הבקרה (upload) | We have approvals (`/approve/[token]`) + autopilot gate | Wire a client-facing per-ad approval queue + control center to upload approved ads to Meta | **P1** |
| 9 | **"The Lab" (remix, 0 tokens)** | Mix existing texts+images into new ads free | none | Add a free remix surface (combine saved copy+images) | P3 |
| 10 | **Messaging series hub** | מייל/וואטסאפ/SMS follow-up series | we have messages/series | parity check vs AutoAds messaging-hub | P3 |
| 11 | **Reports / ROI** | Not surfaced in this crawl (Meta-gated "ביצועים"/insights, "בקרוב" per prior recon) | We BUILT client ROI report + `/report/<token>` (#26/#27) — **AdMaster is ahead here** | none (advantage) | — |
| 12 | **Copy/labels** | "דשבורד / ניהול לקוחות הארגון", contact-centric, Hebrew | "לקוחות Meta", Meta-centric | Reword to client/contact-centric Hebrew | P2 |

> Net: AdMaster's biggest divergences are **structural at the front door** (client = contact, Meta optional/late, guided client-home, approval→upload pipeline). On **strategy depth and ROI reporting AdMaster is already ahead** of what AutoAds visibly exposes. The "angle memory" feature (#5) is a concrete, valuable AutoAds idea AdMaster lacks.

*Read-only map. Nothing in AutoAds was changed. Screens deep-mapped: dashboard, create-client modal, client-home (incl. full brief), create-ad-ai, create-campaign, ad-creation-hub, ad-review. Surfaces seen via nav only: messaging-hub, landing-pages, history, control center, settings, billing.*
