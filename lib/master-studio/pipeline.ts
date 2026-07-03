// lib/master-studio/pipeline.ts
import { MARKETERS_BY_ID, type Marketer } from '@/lib/marketers';
import { composeStrategistPrompt, parseStrategist } from './strategist';
import { composeCreatorPrompt, parseCreator } from './creator';
import { composeJudgePrompt, parseJudge, type JudgeVariant } from './judge';
import { composeEditorPrompt, parseEditor } from './editor';
import { type MasterStudioInput, type MasterV2Output, type MarketerPick, type AvatarProfile, type VariantDraft } from './index';

/** Calls Claude with a (system, user) prompt and returns the raw text. */
export type StageRunner = (system: string, user: string, maxTokens: number) => Promise<string>;

export type PipelineResult =
  | { ok: true; output: MasterV2Output }
  | { ok: false; reason: 'strategist' | 'creators' | 'judge' };

const BOOST_THRESHOLD = 80;
/** How many times to run the whole pipeline before surfacing a partial to the user.
 *  A user must NEVER see "try again" on the core action — a fresh run almost always
 *  succeeds where a transient parse/LLM hiccup produced a partial. */
const MAX_PIPELINE_ATTEMPTS = 2; // stays within the 300s function budget (~120s/attempt)
/** Default winner score when we bypass the judge (single survivor / judge fallback):
 *  below BOOST_THRESHOLD so the editor polishes it. */
const FALLBACK_WINNER_SCORE = 78;

/** Never ship an empty image concept — synthesize a scroll-stop prompt from the post. */
function fallbackImagePrompt(avatar: AvatarProfile | null, post: string): string {
  const firstLine = (post.split('\n').find((l) => l.trim()) ?? '').slice(0, 140);
  const desire = (avatar as { core_desire?: string } | null)?.core_desire ?? '';
  return (
    'A bold, high-contrast, scroll-stopping social ad image with a single strong focal ' +
    'point and immediate emotional pull, engineered to stop the thumb in the first ' +
    `half-second for the target audience${desire ? ` (who wants ${desire})` : ''}. ` +
    `Visual concept anchored to: ${firstLine}. Photographic, dramatic lighting, no text overlay.`
  );
}

/** Belt-and-suspenders default ranking if the strategist yields none (rare — it self-fills). */
function defaultRanked(): MarketerPick[] {
  return Object.values(MARKETERS_BY_ID as Record<string, Marketer>)
    .slice(0, 3)
    .map((m) => ({ id: m.id, name: m.name, emoji: m.emoji, why: '' }));
}

/** Retrying wrapper — the whole best-of-N is re-run on a partial result. */
export async function runMasterPipeline(
  input: MasterStudioInput, run: StageRunner,
): Promise<PipelineResult> {
  let last: PipelineResult = { ok: false, reason: 'strategist' };
  for (let attempt = 0; attempt < MAX_PIPELINE_ATTEMPTS; attempt++) {
    try {
      last = await runMasterPipelineOnce(input, run);
    } catch {
      last = { ok: false, reason: 'creators' };
    }
    if (last.ok) return last;
  }
  return last;
}

async function runMasterPipelineOnce(
  input: MasterStudioInput, run: StageRunner,
): Promise<PipelineResult> {
  // A. Strategist — self-fills marketers; fall back to a default ranking if somehow empty.
  const sp = composeStrategistPrompt(input);
  const strat = parseStrategist(await run(sp.system, sp.user, 800));
  const ranked = strat.ranked.length ? strat.ranked : defaultRanked();
  if (ranked.length === 0) return { ok: false, reason: 'strategist' };

  // B. Creators (parallel) — each ranked marketer writes one post.
  const drafts = await Promise.all(ranked.map(async (m) => {
    const marketer = (MARKETERS_BY_ID as Record<string, Marketer>)[m.id as string];
    if (!marketer) return null;
    try {
      const cp = composeCreatorPrompt(input, marketer, strat.avatar);
      return parseCreator(await run(cp.system, cp.user, 1500));
    } catch { return null; }
  }));

  const survivors: JudgeVariant[] = [];
  drafts.forEach((d, i) => { if (d) survivors.push({ marketer: ranked[i], draft: d }); });
  // Accept a SINGLE survivor — one good post is a valid result (was: require 2).
  if (survivors.length < 1) return { ok: false, reason: 'creators' };

  // C. Judge — only when there's a real contest; otherwise the sole survivor wins.
  //    A judge parse failure falls back to the first survivor rather than failing.
  let winnerIdx = 0;
  let winnerScore = FALLBACK_WINNER_SCORE;
  let scores: MasterV2Output['scores'] = [];
  let judgeRationale = '';
  if (survivors.length >= 2) {
    const jp = composeJudgePrompt(survivors, input);
    const judge = parseJudge(await run(jp.system, jp.user, 1000), survivors.length);
    if (judge) {
      winnerIdx = survivors[judge.winnerIndex] ? judge.winnerIndex : 0;
      winnerScore = judge.scores.find((s) => s.index === winnerIdx)?.score ?? 100;
      scores = judge.scores;
      judgeRationale = judge.rationale;
    }
  }

  let winnerDraft = survivors[winnerIdx].draft;
  let boosted = false;

  // D. Editor (conditional) — polish when the winner scored below the bar.
  if (winnerScore < BOOST_THRESHOLD) {
    try {
      const scoreObj = scores.find((s) => s.index === winnerIdx);
      const ep = composeEditorPrompt(winnerDraft, survivors[winnerIdx].marketer, scoreObj ?? { index: winnerIdx, score: winnerScore, dims: {} as never, weighted: winnerScore, note: '' }, input);
      const edited = parseEditor(await run(ep.system, ep.user, 1500));
      if (edited) { winnerDraft = edited; boosted = true; }
    } catch { /* fall back to original winner */ }
  }

  // Never ship an empty image concept (the empty-IMAGE_PROMPT gap).
  if (!winnerDraft.image?.trim()) {
    winnerDraft = { ...winnerDraft, image: fallbackImagePrompt(strat.avatar, winnerDraft.post) } as VariantDraft;
  }

  return {
    ok: true,
    output: {
      avatar: strat.avatar,
      marketers: survivors.map((s) => s.marketer),
      winner: { marketer: survivors[winnerIdx].marketer, draft: winnerDraft, score: winnerScore },
      scores,
      judgeRationale,
      boosted,
    },
  };
}
