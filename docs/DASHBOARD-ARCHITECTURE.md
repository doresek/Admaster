# DASHBOARD ARCHITECTURE — three living dashboards on the measurement spine

> **What this is.** Design for AdMaster's three dashboards — single-client (2 viewer modes), agency portfolio, and the ISOLATED owner dashboard — each a LIVING MARKETER at its level, embodying the 7 leaps. Research basis: 2026 analytics-UX + admin-isolation sweep (cited; Gartner's category name for this is **"agentic analytics"**). Sits ON `MEASUREMENT-SPINE-PLAN.md` — a dashboard can only show what we measure.
>
> **The one architectural law (research-decided): METRICS LAYER FIRST, LLM SECOND.** Every number is defined once (Hebrew name, formula, grain, target) in a semantic metrics layer; all narration/Q&A/alerts ground in it. Ungrounded LLM-over-data is provably non-repeatable (Power BI Copilot's documented failure); grounded narration is why ours can be trusted — and our narration has something no BI vendor has: the atoms + decision trace, so the "why" is REAL causality, not regression guesses.

---

## 0. Shared foundations (all three dashboards)

1. **The metrics layer** (`lib/metrics-layer`): KPI registry — each metric: key, Hebrew display name, formula over spine tables, time grain, comparison basis (prev period / benchmark / goal), honesty label ("מבוסס קליקים"), evidence note. Consumed by tiles, narration, alerts, digests. THE single source of truth.
2. **The narration engine** (`lib/narration`): deterministic-first (like the digest composer — selects and templates from real rows: metrics deltas, diagnosis rationales, atom states), LLM polish optional per surface. Anti-hallucination inherited from the digest's proven design: every clause traces to a row; no number appears that isn't in the inputs.
3. **The 7 leaps as shared services** (each dashboard consumes at its level):
   | Leap | Mechanism | Rides on |
   |---|---|---|
   | 1 IT TALKS | narration engine over metrics+diagnoses+atoms; one-line story first (progressive disclosure) | digest composer pattern |
   | 2 INSIGHTS CHASE YOU | severity-tiered push: critical→WhatsApp/notification now · important→daily digest · info→in-app feed; **mute controls + acknowledge-rate ≥70% as the fatigue KPI** (Improvado threshold) | heartbeat + reflex(later) + InforU(C2) |
   | 3 WHY IN ONE CLICK | every KPI tile carries "למה?" → ranked drivers: diagnosis-engine verdicts + change-decomposition across campaign/audience/creative dims (ThoughtSpot two-point pattern) + shock state ("שוק, לא אתה") | diagnosis engine, C-04, C-10 funnel edges |
   | 4 COMPARISON | every metric rendered with prev-period + goal + benchmark (WordStream priors → fleet benchmarks C-12 at scale) — never a naked number | metrics layer |
   | 5 FORECAST/WHAT-IF | ranges not points ("סביר בין X ל-Y"), shaded bands, plain Hebrew (never "רווח בר-סמך"); what-if as guided scenarios with editable assumptions, honesty from calibration (C-03: "התחזיות שלנו בתחום הזה מדויקות ~78%") | calibration, hypotheses, economics |
   | 6 ACT FROM HERE | inline actions with machine-checkable guardrails visible (learning-phase lock, caps, undo window) — approve-first per autonomy mode; every action = the same routeAndLog path, logged | autonomy modes, approvals (CP-1 surface) |
   | 7 BRAIN-CONNECTED METRICS | the differentiator: atom-level performance ("הזווית שמדברת אל 'שקט נפשי' ממירה פי 2 מהזווית הרציונלית") — computable because every artifact carries grounded_in + technique tags and every lead carries its source item | artifacts×spine join; nobody else can build this |
4. **RTL/Hebrew-first**, mobile-first (owners live on phones — Databox lesson), north-star number top-RIGHT (RTL mirror of the F-pattern finding), ≤10 KPIs per screen (NN/g + Statsig discipline).

---

## 1. DASHBOARD 1 — SINGLE-CLIENT (build FIRST)
**Route:** `app/(dashboard)/pulse/` (new folder — disjoint from command-center and from the security session's surfaces). Client-scoped via `useActiveClient()`.

### Viewer mode A — THE BUSINESS OWNER (default)
One screen, one story, zero jargon:
```
┌──────────────────────────────────────────────┐
│  החודש: 47 לידים · ₪12 לליד · משתלם ✅        │   ← the one-line story (leap 1)
│  "החודש טוב מהממוצע כי זווית 'שקט נפשי'       │
│   עובדת. שים לב: הקהל מתעייף — מומלץ          │
│   לרענן קריאייטיב השבוע."                     │
├──────────────────────────────────────────────┤
│  [47 לידים ↑12%]  [₪12 לליד ↓8%]  [ROI 3.1×] │   ← ≤4 tiles, each vs prev/goal
│   מול יעד: 50      מול ענף: ₪27    מעל איזון │      (leap 4; break-even from economics)
├──────────────────────────────────────────────┤
│  ⚡ ממתין לך: [אשר רענון קריאייטיב] [צפה]      │   ← act-from-here (leap 6, Mode-2 approvals)
│  📈 בקצב הזה: ~200 לידים עד סוף הרבעון        │   ← forecast as range on tap (leap 5)
└──────────────────────────────────────────────┘
```
- Every tile taps → "למה?" in plain Hebrew (leap 3): "העלות עלתה כי המודעה רצה 3 שבועות והקהל ראה אותה 4 פעמים — זה נורמלי; הפתרון: קריאייטיב חדש (מוכן לאישור)".
- Push (leap 2): WhatsApp for critical only ("עצרתי קמפיין ששרף תקציב בלי תוצאות — ₪180 נחסכו"), weekly digest for the rest (already built — the digest IS this dashboard's push channel).
- Language register: business-warm, dugri; NO CTR/CPM anywhere — leads, cost-per-lead, "משתלם/לא משתלם", worth-it framing.

### Viewer mode B — THE MARKETER/AGENCY (toggle, same data)
Adds: full funnel view (impression→click→LP→lead→stage, with the C-10 edge-health localization) · per-campaign/adset/creative tables with technique+atom tags · hypothesis board (open/resolved, floors progress) · reconciliation honesty panel (platform-claimed vs CRM ratio) · brain-connected metrics table (leap 7: per-atom/angle/persona CVR+CPL) · deeper actions (pause/reallocate proposals within mode caps). Same metrics layer, more columns + drill-downs (progressive disclosure, NN/g).

## 2. DASHBOARD 2 — AGENCY PORTFOLIO
**Route:** `app/(dashboard)/portfolio/` (new). The portfolio analyst over all the agency's clients:
```
┌────────────────────────────────────────────────┐
│ "8 לקוחות: 5 ירוקים, 2 דורשים טיפול, 1 חדש.    │  ← portfolio narration (leap 1)
│  הכי דחוף: אצל X הקהל מוצה; אצל Y לידים        │
│  זולים אבל לא רלוונטיים — כדאי לצמצם קהל."      │
├────────────────────────────────────────────────┤
│ 🔴 דחוף (2)  🟡 לתשומת לב (1)  🟢 תקין (5)      │  ← triage lanes, not tables
│ [לקוח X — קריאייטיב מותש · CPA ↑34% · פעולה]    │  ← click→their single-client dashboard
├────────────────────────────────────────────────┤
│ סה"כ: ₪41k הושקעו · 312 לידים · ROI ממוצע 2.8×  │  ← aggregates + spend/ROI ranking
│ 💡 תובנת רוחב: זוויות רגשיות מנצחות רציונליות    │  ← cross-client insight (leap 7,
│    ב-6 מ-8 לקוחות החודש                          │     agency-scoped only — never cross-agency)
└────────────────────────────────────────────────┘
```
- Ranking by attention-worthiness (the C-06 attention scores ARE the sort order — information value, not spend), then by ROI/spend on toggle.
- Alerts roll up ("3 לקוחות עם עייפות קריאייטיב") with batch actions where safe (leap 6).
- Data boundary: strictly the agency's own clients (existing RLS — owner_user_id scoping already enforces this; no new access paths).

## 3. DASHBOARD 3 — OWNER (Eliran) — ISOLATED BY ARCHITECTURE
**The requirement:** MRR, per-agency revenue, tenant counts, growth, margins, cross-tenant aggregates, usage/credits, case-study candidates. If an agency ever saw this — catastrophic. **A permission flag is NOT the design.**

**Recommendation (research ladder, Rung 1 — strongest): a SEPARATE APP.**
- Separate Vercel project (monorepo dir `apps/owner-ops` or its own repo), own domain (e.g. `ops.<private-domain>`), own env — **admin code, routes, and the service-role key physically absent from the tenant deployment** (the Aikido doctrine: admin routes in the main bundle are discoverable).
- In front of app auth: **Vercel Authentication** (deployment-level SSO gate) — platform-level defense BEFORE any app code runs; Trusted IPs if/when on Enterprise.
- App auth: email-allowlist (you) + **passkey** (the Retool 2023 breach lesson: OTP MFA silently degrades; phishing-resistant only).
- **Auth at the data layer, never middleware-only** — CVE-2025-29927 (CVSS 9.1) proved Next middleware is bypassable; every route handler re-verifies identity.
- Data access: cross-tenant aggregates via **private-schema SECURITY DEFINER functions** (pinned search_path, EXECUTE granted to the admin role only) — tenant RLS remains untouched; no `is_admin` flag ever enters tenant policies.
- **Append-only audit log** of every view/action (Twitter-2020/NY-DFS lesson: the admin panel IS the crown jewels).
- **Interim acceptable (Rung 3), if we want owner metrics before standing up the second app:** same repo, dedicated route group, EVERY handler independently verifies an `app_metadata` admin claim at the DAL, service-role confined to server-only modules, Next ≥15.2.3 pinned, audit log from day one, with the split planned. **Never below this.**
- ⚠️ **FLAGGED FOR THE SECURITY SESSION:** review + approve the isolation model (Rung 1 vs interim Rung 3, domain choice, allowlist mechanics) BEFORE the owner dashboard is built. Not built until that review.

Content (once isolated): MRR/growth narration, revenue per agency, tenant/usage/credit economics, margin per tenant (LLM+data costs vs subscription — the §6.3 token ledger finally consumed), fleet health (heartbeat coverage, error rates), case-study candidates (best-performing clients), system trends. Same 7 leaps at business-of-AdMaster level ("MRR ↑9% — סוכנות X הוסיפה 3 לקוחות; לקוח Y הוא מועמד קייס-סטאדי: ROI 4.2× לאורך רבעון").

---

## 4. Buildable NOW vs gated
| NOW | Gated |
|---|---|
| metrics layer + narration engine (deterministic core) | live impressions/spend in tiles (H4 flip) |
| single-client dashboard, both modes (dry-run + existing data: campaigns, decisions, diagnoses-fixture, hypotheses, digest content, economics once spine lands) | WhatsApp push (C2) — until then in-app + email-fallback(H2) |
| "why" click (diagnosis rows + shock + funnel edges) | benchmark comparisons beyond WordStream priors (fleet ≥10, C-12) |
| forecasts from calibration/hypotheses (labeled honestly) | reflex-tier real-time alerts (C-05, Meta-live) |
| agency portfolio (attention-ranked lanes) | owner dashboard (security-session isolation review + app setup) |
| act-from-here for Mode-2 approvals (CP-1's surface is the security session's — we LINK to it, not rebuild) | cross-client leap-7 insights (fleet-size + k-anonymity) |

## 5. Build priority
1. **D-0 metrics layer + narration engine** (the foundation both sessions' surfaces can eventually consume).
2. **D-1 single-client OWNER mode** (the wow + the daily-use surface) → **D-2 marketer mode** (drill-downs).
3. **D-3 agency portfolio.**
4. **D-4 owner dashboard — AFTER security-session review**, Rung-1 preferred.
Each wave: disjoint folders (`lib/metrics-layer`, `lib/narration`, `app/(dashboard)/pulse`, `app/(dashboard)/portfolio`), full gates, real tests (narration anti-hallucination tests inherit the digest's whitelist-scan pattern).

*Design doc — build follows the measurement spine per the approved plan.*
