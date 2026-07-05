# LEARNING-LOOP-MAP — how the system improves at writing (honest map)

> CP-5(a–d) read-only investigation, 2026-07-06. Every claim carries file:line
> evidence from this repo (branch `feat/ai-marketer-epic`) or a read-only
> SELECT against prod (`racywcnflunsdyxbmlms`). No code was changed.
>
> **The owner's question:** why doesn't the writing improve post-to-post
> (Create Post scores hover ~87)?
>
> **The one-sentence answer:** because on the Create-Post path there is no
> channel — none — through which post N's judge verdict, client feedback, or
> edits can change post N+1's prompts; the only wired cross-run loop
> (user signals → insight confidence) has been used **zero times** in prod,
> and everything else (episodes, diagnoses, performance, calibration,
> heartbeat) is built but idle. The ~87 is additionally a judge-scale
> compression artifact (both scorers live in a ~74–90 band).

---

## (a) The judge's exact criteria, and what the writers receive

### Scoring dimensions — as implemented

`lib/master-studio/index.ts:31-37` (pasted verbatim):

```ts
export const SCORE_DIMS = [
  // scroll_stop leads on purpose: the first half-second thumb-stop is often THE
  // biggest driver of ad performance — it is scored AND up-weighted in selection.
  'scroll_stop',
  'hook_strength', 'clarity', 'emotional_resonance', 'cta_strength',
  'brand_fit', 'awareness_match', 'framework_adherence',
] as const;
```

Eight dimensions, each judged 0–100 (`judge.ts:17`, clamped in code at
`judge.ts:43-46`).

### Weights and how the score computes

- **The per-dimension → overall aggregation is NOT computed in code.** The
  judge prompt says "ה-score הסופי לכל גרסה הוא שקלול הממדים"
  (`lib/master-studio/judge.ts:18`) and the model self-reports a single
  `score` per variant (`judge.ts:31`). So the "overall score" the owner sees
  is the LLM's own freeform blend of the eight dims — there are no fixed
  per-dimension weights anywhere in the codebase.
- **The only explicit weight is scroll_stop, and it applies to winner
  SELECTION, not to the displayed score.** `lib/master-studio/index.ts:45-50`:

```ts
export const SCROLL_STOP_WEIGHT = 0.4;
export function weightedSelectionScore(score: number, scrollStop: number): number {
  return Math.round((1 - SCROLL_STOP_WEIGHT) * score + SCROLL_STOP_WEIGHT * scrollStop);
}
```

  i.e. `weighted = 0.6·overall + 0.4·scroll_stop`. The judge prompt tells the
  model scroll_stop is "שוקלל 40% מבחירת המנצח" (`judge.ts:14,20`).

### Winner-selection rule

`lib/master-studio/judge.ts:72-76`: the winner is the variant with the highest
`weighted` selection score; the model's own `winner_index` is honored **only
as a tie-breaker** when weighted scores are equal. The judge runs only when
≥2 creator drafts survive (`pipeline.ts:90`); with a single survivor the judge
is bypassed and the winner score defaults to `FALLBACK_WINNER_SCORE = 78`
(`pipeline.ts:23,87`). If the judge's parse succeeds but the winner's score
row can't be found, the score defaults to `100` (`pipeline.ts:95`).

### Editor-boost threshold

`lib/master-studio/pipeline.ts:16` — `const BOOST_THRESHOLD = 80;` applied at
`pipeline.ts:105`: when the winner scored `< 80`, an editor pass rewrites it.
The editor is told the **3 weakest dimensions of the current run**
(`lib/master-studio/editor.ts:12-17`) — this is the only place judge feedback
influences writing, and it is strictly *within-run*.

### What the persona-writers receive in their prompts

Every stage's system prompt is `ctxPrefix + stagePrompt`
(`app/api/ai/master/route.ts:69-78`), where `ctxPrefix` comes from
`buildAiContext` (`route.ts:53-58`). The prefix contains
(`lib/ai-context.ts:122-160`):

1. **ACTIVE CLIENT** — client name (`ai-context.ts:122-124`).
2. **CLIENT BRIEF** — the full Hormozi×Schwartz brief form values
   (`ai-context.ts:128-143`).
3. **MARKETING STRATEGY / BUSINESS ANALYSIS** — the `client_strategy`
   synthesized snapshot (`ai-context.ts:146,227-300`).
4. **CLIENT AVATAR** — structured avatar (`ai-context.ts:149,302-336`).
5. **LIVING INSIGHTS** — top-4-per-layer *active* `client_insights` atoms
   ordered by confidence (`ai-context.ts:152-154,172-205`).

Stage-specific content:

- **Strategist** (`lib/master-studio/strategist.ts:8-47`): master notes
  (top priority, capped 2000 chars), the full 12-marketer corpus,
  platform/tone/type, grounding rules, and the brief. It outputs the avatar
  profile + 3 ranked marketers.
- **Creator** (`lib/master-studio/creator.ts:9-60`): the marketer persona
  block — archetype, principles, signature moves, examples, voice
  (`lib/marketers.ts:362-376`) — the strategist's avatar
  (persona/fears/desires/awareness/objections, `creator.ts:17-19`), master
  notes, framework/hook overrides, a scroll-stop directive
  (`creator.ts:42-45`), and the brief.
- **Judge** (`judge.ts:37-39`): platform + brief + the bare post texts of the
  variants (not hashtags/image/tips), plus the same ctxPrefix.

**Is ANY history/feedback/learning content included today? No.** Grep-verified:
the create path (`app/api/ai/master/route.ts`) imports nothing from
`lib/episodic`, reads no past `generated_content`, no `learning_signals`, no
`scores`, no judge rationales. The *only* learning-sensitive input is the
LIVING INSIGHTS block — whose confidences *would* move if signals fired
(§b.4) — and in prod those 64 active atoms are all brief-derived
(learning_signals count = 0, see §b.4).

### The second scorer on the Create page (context for "the 87")

After generation, the create page also calls `/api/ai/score`
(`app/(dashboard)/create/page.tsx:146-165,202`): a separate Haiku-based
0–100 rubric (`lib/scoring.ts:45-52`, bands low/<40, mid/<70, high at
`lib/scoring.ts:87-90`), persisted to the `scores` table
(`app/api/ai/score/route.ts:90-109`). It has a "Boost" loop — max 2 rewrite
iterations against the prior score row (`app/api/ai/score/boost/route.ts:13,
30-33,39-41`) — which is also strictly *within-session*: it reads only the
`prior_score_id` row, never history. `composeScorePrompt` receives copy,
channel, locale, audience only — no client context, no memory
(`lib/scoring.ts:45+`).

---

## (b) Learning mechanisms — WIRED / BUILT-BUT-IDLE / MISSING

Prod ground truth (read-only SELECT, 2026-07-06):

| table | rows |
|---|---|
| `learning_signals` | **0** |
| `episode_embeddings` | **0** |
| `diagnoses` | **0** |
| `content_performance` | **0** |
| `heartbeat_runs` | **0** |
| `hypotheses` | 1 |
| `content_artifacts` | 19 |
| `client_insights` (active) | 64 |
| `insight_events` | 64 |

### b.1 Episodic memory consulted at generation

**Campaign path: WIRED (but recalling from an empty table). Create-Post path: MISSING.**

- The campaign runner defaults `recallPrecedents` to `episodicRecaller(admin)`
  (`lib/campaigns/runner.ts:241-245`), recalls before generating
  (`runner.ts:262-267`), passes `precedents.summaries` into generation
  (`runner.ts:270-277`), and logs them as a `precedents` decision
  (`runner.ts:453-462`). `masterStudioGenerator` prepends them as
  `═══ תקדימים (זיכרון אפיזודי) ═══` to every stage's system prompt
  (`lib/campaigns/generate.ts:62-70`).
- **The create-post path does none of this.** `app/api/ai/master/route.ts`
  has no episodic import, no recall, no precedent block (verified by reading
  the whole file, lines 1-201).
- Moreover the memory is empty and nothing fills it in production:
  `ingestForClient` (`lib/episodic/ingest.ts:141`) has **no production
  caller** — its only invocations are the manual backfill script
  (`scripts/backfill-episodes.mjs`, dry-run by default) and the E2E script
  (`scripts/e2e-ai-marketer-dryrun.mjs`). `episode_embeddings` = 0 rows.

### b.2 Judge verdicts written as episodes/lessons

**MISSING.** Judge scores + rationale ARE persisted — to
`generated_content.output` (`score`, `scores`, `why` at
`app/api/ai/master/route.ts:155-170`) and the winner score to
`content_artifacts.content.score` (`route.ts:128-135`) — but they are only
ever read back for UI display: the create page history
(`route.ts GET, :180-201`), library/history pages
(`app/(dashboard)/library/page.tsx:43`, `history/page.tsx:63`). The episodic
system's only source kinds are `diagnosis` and `hypothesis`
(`lib/episodic/ingest.ts:184-199`, `compose.ts:100-228`). No code path turns
a judge verdict into an episode, an insight atom, or any retrievable lesson.

### b.3 Judge-preference patterns fed forward into writers' prompts

**MISSING (cross-run).** Within one run, the editor is told the 3 weakest
dims (`editor.ts:12-17`, triggered at `pipeline.ts:105-111`); within one
session, the Boost loop rewrites against the prior score row
(`app/api/ai/score/boost/route.ts:39-41`). Neither survives the request.
There is no mechanism anywhere that reads past judge verdicts (which sit in
`generated_content.output.scores`) into a future strategist/creator prompt.

### b.4 Client approve/reject → learning_signals → next generation

**WIRED end-to-end — the only live cross-run loop — but used ZERO times.**

The full chain exists in code:

1. `SignalButtons` renders on the create page under the generated post when an
   artifact exists (`app/(dashboard)/create/page.tsx:417`;
   `components/intelligence/SignalButtons.tsx:21-60` POSTs
   `/api/intelligence/signal`).
2. The signal route inserts a `learning_signals` row (weight 0.8,
   `app/api/intelligence/signal/route.ts:21,128-143`), resolves the
   artifact's `insight_ids` (`:66-75`), CAS-claims the signal
   (`lib/intelligence/lifecycle.ts:224-233`), applies it to each grounding
   atom via `applyLearningSignal` (`lifecycle.ts:241-282`; ±0.12·weight
   confidence step, decisive negatives refute — `lifecycle.ts:49-73`,
   constants `lib/intelligence/types.ts:92-97`), then re-synthesizes the
   strategy snapshot (`signal/route.ts:177-184`).
3. The next generation reads the updated atoms: `buildAiContext` →
   `formatTopInsights` orders active insights by confidence
   (`lib/ai-context.ts:172-205`), and the artifact recorded at generation
   time carries `insightIds: ctx.insightIds` so future signals resolve back
   (`app/api/ai/master/route.ts:140`).

Caveats that blunt it even if used: a signal only *nudges the confidence of
pre-existing (brief-derived) atoms* — it never creates new knowledge; the
free-text `detail` is stored (`signal/route.ts:138`) but never resurfaces in
any prompt; and the buttons only appear when an active client was selected
(`artifactId` is null otherwise, `route.ts:122-123`,
`create/page.tsx:417`). **Empirically: `learning_signals` has 0 rows ever.**

### b.5 Client EDITS captured as lessons

**MISSING entirely.** The winning post is rendered read-only
(`OutputBox` + `CopyBtn`, `app/(dashboard)/create/page.tsx:412-414`). The
only mutation is the Boost button replacing the post with an AI rewrite
(`create/page.tsx:428-433`). There is no editable field, no save-final
action, no diff capture, and no API that accepts an edited version. The
user's actual corrections — the highest-signal free training data available
pre-live — evaporate in their clipboard.

### b.6 Performance loop (content_performance → verdicts → diagnoses → auto-improve)

**BUILT-BUT-IDLE — every stage exists, no production caller for any of it.**

- Ingestion + verdicts: `lib/performance/ingest.ts` computes a verdict per ad
  (`computeVerdict`, `ingest.ts:144,247`) and persists to
  `content_performance`; `lib/performance/ingest-live.ts` maps live Meta
  insights into it keyed by artifact (`ingest-live.ts:20,218`). **No caller**
  in `app/` (grep: only `scripts/e2e-ai-marketer-dryrun.mjs`). Note
  `/api/meta/insights` writes the *reporting* table `ad_performance`, not
  `content_performance` (`app/api/meta/insights/route.ts:14-16`).
- Diagnosis: `lib/diagnosis/diagnose.ts` reasons which marketing link failed
  from the living insights (`diagnose.ts:1-14`). **No caller** outside tests
  and the E2E script; `diagnoses` = 0 rows.
- Auto-improve: `lib/diagnosis/auto-improve.ts` regenerates only the failed
  link, queues an A/B challenger `campaign_items` row (`auto-improve.ts:205-243`),
  emits exactly one performance learning_signal at weight **0.2**
  (`auto-improve.ts:85,245-276`) and feeds it through the real
  `applyLearningSignal` (`:278-301`). **No caller** outside tests/E2E.
- What starts flowing when campaigns go live *and the pipe is scheduled*:
  `content_performance` rows → verdicts → diagnoses → (i) atom
  confidence updates that reach create-path prompts through the LIVING
  INSIGHTS block, (ii) A/B challenger items on the campaign path,
  (iii) episodes for precedent recall (once `ingestForClient` is scheduled).
  Even then, nothing feeds diagnoses/verdicts into create-path prompts
  *directly* — only through atom confidence.

### Heartbeat and calibration

- **Heartbeat: BUILT-BUT-IDLE.** The daily tick resolves hypotheses through
  `resolveAndLearn` → learning_signals → lifecycle
  (`lib/heartbeat/ticks/daily.ts:16-22,63`); the weekly tick can run a
  campaign via `defaultCampaignRunner` (`ticks/weekly.ts:43,304`). The
  endpoint exists (`app/api/heartbeat/route.ts:1-25`) **but nothing schedules
  it**: `vercel.json` has no `crons` key (whole file read; only headers +
  rewrites) and there are no GitHub workflows. `heartbeat_runs` = 0 in prod.
  (If a cron exists in the Vercel dashboard it is not visible from the repo —
  but the empty `heartbeat_runs` table says it has never fired.) Even when
  running, it touches writing quality only indirectly via atom confidence —
  hypotheses are about campaign arms, not copywriting craft.
- **Calibration: BUILT-BUT-IDLE, and not about writing.** `lib/calibration`
  Brier-scores hypothesis *confidence predictions* (`lib/calibration/index.ts:1-12`,
  `core.ts:1-58`). `calibrationAdjust` / `buildAdjustmentTable` have **no
  callers** outside `lib/calibration` and its tests. It never touches judge
  scores or writing quality.

---

## (c) The 87 question — calibration ceiling vs real plateau

Read-only SELECTs against prod (2026-07-06).

### Winner scores (`generated_content`, type='master_post', `output->>'score'`)

```
n=9   min=78   max=87   avg=83.78   stddev=3.23
score: 78×1, 81×2, 83×1, 85×2, 87×3
window: 2026-05-27 → 2026-07-05, 2 distinct clients, boosted=true: 0 rows
```

### All judged variants (`output->'scores'`, 8 rows carry the array, 21 variants)

```
n=21   min=74   max=87   avg=80.29   stddev=4.43
```

### Per-dimension spread (all judged variants)

| dim | n | min | max | avg | sd |
|---|---|---|---|---|---|
| scroll_stop | 11 | 68 | 88 | 77.1 | 7.7 |
| cta_strength | 21 | 68 | 88 | 78.8 | 4.9 |
| awareness_match | 21 | 75 | 90 | 81.6 | 3.9 |
| framework_adherence | 21 | 72 | 93 | 82.4 | 4.8 |
| hook_strength | 21 | 62 | 95 | 82.4 | 8.3 |
| clarity | 21 | 70 | 92 | 82.6 | 5.2 |
| brand_fit | 21 | 72 | 88 | 83.6 | 3.7 |
| emotional_resonance | 21 | 78 | 96 | 85.4 | 5.2 |

(scroll_stop has n=11: the dimension was added after the earliest rows.)

### The second scorer (`scores` table, source_kind='master_post')

```
n=10   min=15   max=87   avg=70.6   sd=29.4
score: 15×2, 82×4, 87×4        boost_iteration: all 0 (Boost never used)
```

### Interpretation — it is BOTH, in this order

1. **Judge-scale compression (the dominant effect).** Two independent LLM
   scorers, different models and prompts, both top out at exactly 87 and
   cluster in ~74–90 for competent copy. Neither prompt contains rubric
   anchors or exemplars for what 60/75/90/95 mean (`judge.ts:15-35`,
   `lib/scoring.ts:45-52`) — classic un-anchored-LLM-judge behavior: the
   usable scale is roughly 70–90, so "87" is effectively the top of the
   scale, not a measurement of a plateau. The winner-score floor is also
   structurally propped: judge-bypass runs get 78 (`pipeline.ts:23`) and
   sub-80 winners get an editor rewrite (`pipeline.ts:105`).
2. **But there IS variance the writers never convert — because they can't.**
   Per-dimension spread is real (hook_strength 62–95, scroll_stop 68–88,
   scroll_stop is the weakest recurring dim at avg 77.1). Best-of-3 selection
   harvests this variance *within* a run, and the editor pass targets the
   weak dims *within* a run — but per §b, no mechanism carries any of it to
   the next run. A flat score series is exactly what the wiring predicts:
   the system is drawing i.i.d. samples from the same distribution every
   time, with a selection filter on top.
3. **Sample caveat.** n=9 winners over ~5 weeks across 2 clients — too small
   to detect a trend even if one existed. Also ambiguous: the single
   78-score row has `boosted=false`, which means its editor pass either
   pre-dates the wiring or failed silently (`pipeline.ts:109-111` swallows
   editor errors); indistinguishable from the data.

---

## (d) The verdict

### How the system improves at writing TODAY (the honest chain)

```
brief form ──► client_insights atoms (brief-derived, confidence-ordered)
                        │
                        ▼
        buildAiContext LIVING INSIGHTS block (ai-context.ts:152-205)
                        │
                        ▼
   strategist → 3 creators → judge (best-of-3, scroll_stop-weighted)
                        │
                        ▼
        editor pass IF winner < 80 (within-run only)
                        │
                        ▼
   optional Boost loop on /api/ai/score (within-session only, never used)
```

That is the whole loop. Selection and within-run repair, grounded in a static
snapshot of the client. Cross-run, the only wired channel is
user-signal → atom confidence (§b.4) — used 0 times, and even at best it
re-ranks existing brief knowledge rather than accumulating writing lessons.
Judge verdicts, client edits, and episodic memory do not reach the writers.
**The system writes each post as if it has never written one before.**

### What closes automatically at live

Once campaigns run live AND the pipes are scheduled (both currently
unscheduled — no crons in `vercel.json`, `heartbeat_runs`=0):
`content_performance` → verdicts → diagnoses → auto-improve
(A/B challengers + weight-0.2 signals → atom confidence) and, if
`ingestForClient` is put on a schedule, episodes → precedent recall on the
**campaign** path. None of that will feed the **create-post** path's prompts
directly; it only reaches them via atom confidence. So live data alone does
not fix post-to-post writing improvement on /create.

### The 1–3 highest-value wiring gaps to close NOW (→ CP-5b; not implemented)

**G1 — Feed past judge verdicts forward into the create-path prompts. [Effort: S]**
- *Wire:* in `app/api/ai/master/route.ts` (around the `buildAiContext` call,
  :53-58) or inside `lib/ai-context.ts`, load the client's last N
  `generated_content` master_post rows (`output->'scores'`, `output->>'why'`
  are already persisted, `route.ts:155-170`), reduce to: recurring weakest
  dims + last judge rationales + best-scoring hook of the period, and prepend
  a `═══ לקחים משיפוט קודם ═══` block to `ctxPrefix` so strategist, creators,
  editor and judge all see it. Optionally pass weak dims explicitly into
  `composeCreatorPrompt` (`lib/master-studio/creator.ts:9`).
- *Expected effect:* the tightest possible closed loop with zero new tables —
  writers stop repeating scored weaknesses (scroll_stop avg 77.1 is a
  standing, named target), and the editor's within-run repair becomes
  cross-run pressure.

**G2 — Turn human feedback and edits into retrievable lessons. [Effort: M]**
- *Wire:* (i) make the winning post editable on
  `app/(dashboard)/create/page.tsx` (:412 renders read-only today) with a
  "save final" action; diff original→final and persist it as a
  learning_signal + a new bridge-layer `client_insights` atom (e.g. kind
  `content_feedback`), via the existing `reconcileCandidates`
  (`lib/intelligence/lifecycle.ts:125`); (ii) extend
  `app/api/intelligence/signal/route.ts` so the free-text `detail` (:138,
  currently write-only) also becomes such an atom, entering prompts through
  `formatTopInsights` (`lib/ai-context.ts:172-205`).
- *Expected effect:* client taste ("never mention price", "the grandfather
  angle works") accumulates as prompt-visible knowledge — the pre-live
  equivalent of performance data, captured from actions the user already
  takes.

**G3 — Anchor the judge scale and persist per-dimension history. [Effort: S]**
- *Wire:* add rubric anchors/exemplars to `composeJudgePrompt`
  (`lib/master-studio/judge.ts:15-35`) defining what 60/75/90/95 look like
  (optionally: score comparatively against the client's best previous post,
  loaded per G1); stamp the winner's per-dim scores onto
  `content_artifacts.content` (`app/api/ai/master/route.ts:128-135`) so a
  trendline per client/dimension is queryable.
- *Expected effect:* de-compresses the 74–87 band so the score can actually
  show improvement, making G1's feedback signal meaningful and giving the
  owner an honest KPI instead of a ceiling.

(Not in the top 3: wiring episodic recall into the create path — correct
long-term, but today it would recall from an empty table; it becomes valuable
after G1/G2 create lesson sources and after `ingestForClient` +
`/api/heartbeat` get scheduled.)
