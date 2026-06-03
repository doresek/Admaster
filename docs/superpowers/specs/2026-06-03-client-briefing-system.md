# Client Briefing System — Design Spec (auto-ads parity)

**Date:** 2026-06-03
**Branch:** `feat/client-briefing` (off main)
**Goal:** Replicate auto-ads.io's clients + briefing experience: a clients grid, a per-client multi-step "universal briefing" wizard, a **send-to-client public token link**, and a public no-auth fill page that auto-saves back to the system.

> Scanned live from auto-ads.io/he (logged in as user). Reference screenshots: `autoads-clients.png`, `autoads-briefing-full.png`, `autoads-public-briefing.png`.

---

## 1. What auto-ads does (the target)

**Clients grid (`/clients`):** header (icon + "לקוחות" / "ניהול לקוחות הארגון" + "ייצוא CSV" + "לקוח חדש"), search box, responsive grid of client **cards**. Each card: letter-avatar + name, email/phone/company rows, briefing status (`ללא בריפינג` / `נשלח ללקוח (לפני N ימים)` / `בריפינג הושלם (100%)`), and two buttons: **בריפינג** + **ניהול מודעות**.

**New client modal:** name* / email / phone / company / notes.

**Briefing page (`/clients/{id}/briefing`):** title "בריפינג — {name}", status badge, buttons **שלח ללקוח** / **שכפל לקוח** / **שלח דוח ללקוח**; a "חיבור Meta Ads" card; a **template selector** ("תבנית בריפינג אוניברסלית"); then a **5-step wizard** with a progress bar ("שלב N מתוך 5", "% הושלם"):
1. **בוא נכיר את העסק (והנשמה שמאחוריו):** שם העסק*, במה עוסק*, מוצר/שירות לקדם עכשיו*, שפת המודעות* (select), סיפור ההקמה (textarea), הפנים מאחורי המותג* (select: בשמך/המותג/שילוב), "ספר עליך" (textarea), השליחות (textarea).
2. **איפה אפשר לראות אתכם?** אתר/דף נחיתה, אינסטגרם, פייסבוק.
3. **מה הלקוח מקבל? (הצעה לעומק):** מחיר, מה מקבל בתכלס, יתרון מול מתחרים.
4. **מי הלקוח ומה כואב לו? (פסיכולוגיה):** הכאב הגדול, החיים האידיאליים אחרי.
5. **עוד משהו שחשוב שנדע?**
Below (when complete): **ניתוח AI** — תת-קהל מומלץ, המלצת פלטפורמה+משפך, הערכת Offer Stack, and **multiple avatars** each with זהות / רמת מודעות (Schwartz) / מערכת אמונות / משוואת ערך (Hormozi) / התנגדויות, plus הרכבת הצעה (Offer Stack). Buttons "הוסף אווטר (1 קרדיט)" / "ניתוח מחדש (2 קרדיטים)".

**Send-to-client:** "שלח ללקוח" → modal "קישור למילוי בריפינג" with a copyable public URL `…/briefing?token=<token>` (valid 7 days). No auto-email — copy & send.

**Public fill page (`/briefing?token=…`, no auth):** clean page (no sidebar), "טופס בריפינג" / "{template} — {client}", same 5-step wizard, **"נשמר אוטומטית ✓"** + progress %. On completion the marketer's card shows "בריפינג הושלם (100%)".

---

## 2. What we already have (reuse)

- `meta_clients` (clients) + `/clients` page (currently shows pages/ad-accounts).
- `briefs` (values jsonb, avatar, ads, funnel, status, code FK) + `brief_codes` (code unique, user_id, agency_name).
- `/api/briefs/submit` — **public, no-auth**, takes `{code, values}`, verifies code, inserts brief. **The link→fill→save loop already exists**, keyed by `code`.
- `app/brief/page.tsx` — public fill page (by code).
- `/briefs` — marketer's brief manager + form + AI avatar/ads/funnel generation (`/api/briefs/[id]/avatar` etc.).
- `BriefValues` type (21 fields). `buildAiContext` already injects a client's brief into Master Studio.

**Gap vs auto-ads:** no per-client link (briefs↔clients), the form is flat (not a 5-step "soul"-deep wizard), the public link uses a `code` not a per-client 7-day token, and `/clients` doesn't surface briefing.

---

## 3. Data model (DB — DB-session domain; prepare SQL)

Minimal, additive:
```sql
-- link a brief to a client
alter table public.briefs add column if not exists client_id uuid
  references public.meta_clients(id) on delete set null;
create index if not exists idx_briefs_client on public.briefs(client_id);

-- per-client public fill token with expiry (auto-ads = 7 days)
alter table public.brief_codes add column if not exists client_id uuid
  references public.meta_clients(id) on delete cascade;
alter table public.brief_codes add column if not exists token text unique;
alter table public.brief_codes add column if not exists expires_at timestamptz;
create index if not exists idx_brief_codes_token on public.brief_codes(token);
```
`token` is a 32-byte hex (crypto.randomBytes). `expires_at = now()+7d`. Public submit verifies token unexpired.

> No new tables — extends existing. Avoids collision with DB session's `client_journeys`. SQL handed to user/DB session to run; feature code degrades gracefully (token features no-op) until applied.

---

## 4. Universal briefing template (single source of truth)

`lib/briefing-template.ts` — exports the 5-step schema: array of `{ id, title, fields: { key, label, type: 'text'|'textarea'|'select', required?, options? }[] }`. Extends `BriefValues` with new keys: `biz_founding_story`, `biz_presenter` (select), `biz_about_you`, `biz_mission`, `link_website`, `link_instagram`, `link_facebook`, `extra_notes`. Used by BOTH the marketer wizard and the public fill page, so they never drift.

---

## 5. Pages & APIs

**Create/extend:**
- `lib/briefing-template.ts` — the template config + a `briefCompletion(values)` helper (% of required filled).
- `app/(dashboard)/clients/page.tsx` — redesign list into auto-ads-style **cards** (status + בריפינג/ניהול מודעות/לקוח חדש). Keep pages/ad-account selection reachable from "ניהול מודעות".
- `app/(dashboard)/clients/[id]/briefing/page.tsx` — marketer 5-step wizard (autosave per field to the client's brief row), "שלח ללקוח" → token modal.
- `app/brief/[token]/page.tsx` (or extend `app/brief/page.tsx` to accept `?token=`) — public 5-step wizard, autosave, submit.
- `app/api/clients/[id]/brief-link/route.ts` — POST: create/rotate a 7-day token for the client (returns the public URL). Auth.
- Extend `app/api/briefs/submit/route.ts` — accept `token` (in addition to `code`), validate unexpired, upsert the brief by client_id; bump status.
- `GET /api/briefs?client_id=` — load a client's brief (for the marketer wizard prefill).

**New-client modal** on `/clients` (name*/email/phone/company/notes) → POST to existing client-create path (`/api/meta/clients` or a lightweight `/api/clients`).

---

## 6. Phasing

- **Phase 1 (this build):** template config; `briefs.client_id` + token SQL; clients-grid redesign with status + new-client modal; marketer 5-step wizard at `/clients/[id]/briefing`; "שלח ללקוח" token modal; public `/brief/[token]` fill with autosave + submit. → The complete "create client → fill briefing (self or via link) → saved" loop, matching auto-ads.
- **Phase 2 (later):** AI analysis section — multi-avatar (Schwartz/beliefs/Hormozi/objections), sub-audience, platform+funnel, Offer-Stack rating (reuse `/api/briefs/[id]/avatar` + offer-stack engines). "שכפל לקוח", "שלח דוח ללקוח", CSV export.
- **Phase 3:** Meta connect inline; deeper Master Studio wiring (auto-pick the active client's brief by client_id).

---

## 7. Non-goals / coordination

- Onboarding/autopilot/journeys/cockpit are the **DB session's** (their plan is literally derived from auto-ads). This spec stays in clients-grid + briefing-wizard + public-fill. Demarcation recorded in memory.
- DB migration is prepared as SQL for the DB session/user to apply; feature degrades gracefully until then.
