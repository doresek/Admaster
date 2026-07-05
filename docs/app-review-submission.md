# Meta App Review — submission workbook (G0 track)

> Owner actions marked **[OWNER]** — these start the 2–6-week external clock and need no code.
> System prerequisites (G0-2 pages, P1-4 demo flow) are tracked in `docs/ORGANIC-TASKS.md`.
> Goal: Advanced Access for `pages_manage_posts`, `instagram_basic`, `instagram_content_publish` (keeping the 5 existing paid scopes in `lib/meta-config.ts`).

## Step 1 — Business Verification **[OWNER — do first, longest pole]**
1. Open [business.facebook.com](https://business.facebook.com) → the business portfolio that owns the AdMaster app → **Settings → Security Center → Start Verification**.
2. Have ready: official business registration document (תעודת עוסק/רישום חברה) matching the business name, business address + phone reachable for verification, and a business email/domain (they may verify via domain TXT record or an email code).
3. Status appears in Security Center; typical: days→2 weeks. If rejected for name mismatch — resubmit with the doc whose name EXACTLY matches the portfolio's legal name.

## Step 2 — App console prerequisites **[OWNER, after G0-2 deploys]**
In [developers.facebook.com](https://developers.facebook.com/apps) → the AdMaster app:
1. **Settings → Basic:** set Privacy Policy URL = `https://admaster-three.vercel.app/privacy` · Data Deletion Instructions URL = `https://admaster-three.vercel.app/data-deletion` · App icon (1024×1024) · Category (Business).
2. **Switch the app to Live mode** (toggle at the top). Nothing breaks: current paid scopes already have the access level our own use needs; Live is a review prerequisite.
3. **Use cases:** ensure "Facebook Login for Business" (or the authentication use case the app already carries) is added; under its Permissions, ADD: `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`. (Do NOT remove existing ones.)

## Step 3 — Review materials (system side; = task G0-4, after P1-4)
- Screencast (screen recording, 2–4 min, can be Hebrew UI with English captions): login → connect a Facebook Page → the system composes an organic post from the client's brief → the post is scheduled/appears on the (test) Page. One take per permission usage.
- Reviewer test credentials: a dedicated test login + a test Page already connected.
- Per-permission usage text (short, honest): "AdMaster Pro is an AI marketing platform; business owners connect their own Facebook Page and the system drafts and publishes/schedules organic posts on their behalf; `pages_manage_posts` is used solely to publish/schedule the posts the user approves to their own Page." (analogous texts for the IG pair).

## Step 4 — Submit **[OWNER]**
App Review → Permissions and Features → request Advanced Access for the three permissions → attach screencast + notes + test credentials → submit. Expect **2–6 weeks and possibly 2–3 rounds**; rejections come with reviewer notes — iterate, don't restart.

## Step 5 — After approval (= task G0-6, one-line code change)
Re-add the 3 scopes to `META_OAUTH_SCOPES` in `lib/meta-config.ts` (revert of PR #53); existing users re-consent via the normal connect flow. IG additionally requires each client's IG account to be Business/Creator and linked to their FB Page (per-client onboarding step, not an app gate).

## Status log
| Date | Step | Status | Notes |
|---|---|---|---|
| 2026-07-06 | Workbook created | — | G0-2 pages in build; P1-4 (demo flow) not started |
