// lib/master-studio/pipeline.ts
import { MARKETERS_BY_ID, type Marketer } from '@/lib/marketers';
import { composeStrategistPrompt, parseStrategist } from './strategist';
import { composeCreatorPrompt, parseCreator } from './creator';
import { composeJudgePrompt, parseJudge, type JudgeVariant } from './judge';
import { composeEditorPrompt, parseEditor } from './editor';
import { type MasterStudioInput, type MasterV2Output } from './index';

/** Calls Claude with a (system, user) prompt and returns the raw text. */
export type StageRunner = (system: string, user: string, maxTokens: number) => Promise<string>;

/** Pipeline stages, in execution order. Emitted via onStage as each one begins. */
export type PipelineStage = 'strategist' | 'creators' | 'judge' | 'editor';

export interface PipelineOpts {
  /** Fired when each stage STARTS — used to stream live progress to the UI. */
  onStage?: (stage: PipelineStage) => void;
}

export type PipelineResult =
  | { ok: true; output: MasterV2Output }
  | { ok: false; reason: 'strategist' | 'creators' | 'judge' };

const BOOST_THRESHOLD = 80;

export async function runMasterPipeline(
  input: MasterStudioInput, run: StageRunner, opts: PipelineOpts = {},
): Promise<PipelineResult> {
  const emit = (stage: PipelineStage) => { try { opts.onStage?.(stage); } catch { /* never let UI hooks break the run */ } };

  // A. Strategist
  emit('strategist');
  const sp = composeStrategistPrompt(input);
  const strat = parseStrategist(await run(sp.system, sp.user, 800));
  if (strat.ranked.length === 0) return { ok: false, reason: 'strategist' };

  // B. Creators (parallel) — each ranked marketer writes one post.
  emit('creators');
  const drafts = await Promise.all(strat.ranked.map(async (m) => {
    const marketer = (MARKETERS_BY_ID as Record<string, Marketer>)[m.id as string];
    if (!marketer) return null;
    try {
      const cp = composeCreatorPrompt(input, marketer, strat.avatar);
      return parseCreator(await run(cp.system, cp.user, 1500));
    } catch { return null; }
  }));

  const survivors: JudgeVariant[] = [];
  drafts.forEach((d, i) => { if (d) survivors.push({ marketer: strat.ranked[i], draft: d }); });
  if (survivors.length < 2) return { ok: false, reason: 'creators' };

  // C. Judge
  emit('judge');
  const jp = composeJudgePrompt(survivors, input);
  const judge = parseJudge(await run(jp.system, jp.user, 1000), survivors.length);
  if (!judge) return { ok: false, reason: 'judge' };

  const winnerIdx = survivors[judge.winnerIndex] ? judge.winnerIndex : 0;
  const winnerScore = judge.scores.find(s => s.index === winnerIdx)?.score ?? 100;
  let winnerDraft = survivors[winnerIdx].draft;
  let boosted = false;

  // D. Editor (conditional)
  if (winnerScore < BOOST_THRESHOLD) {
    emit('editor');
    try {
      const scoreObj = judge.scores.find(s => s.index === winnerIdx)!;
      const ep = composeEditorPrompt(winnerDraft, survivors[winnerIdx].marketer, scoreObj, input);
      const edited = parseEditor(await run(ep.system, ep.user, 1500));
      if (edited) { winnerDraft = edited; boosted = true; }
    } catch { /* fall back to original winner */ }
  }

  return {
    ok: true,
    output: {
      avatar: strat.avatar,
      marketers: survivors.map(s => s.marketer),
      winner: { marketer: survivors[winnerIdx].marketer, draft: winnerDraft, score: winnerScore },
      scores: judge.scores,
      judgeRationale: judge.rationale,
      boosted,
    },
  };
}
