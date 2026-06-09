// lib/judge/prompt.ts
// Prompt composer for the system-wide judge, modeled on lib/scoring.ts's
// strict-JSON-contract style.

import type { JudgeArtifact, JudgeDimension } from './types';

const LANG_ANCHOR: Record<'he' | 'en' | 'ar', string> = {
  he: 'All artifacts are in Hebrew (עברית). Judge using Israeli-market norms. Write the rationale in Hebrew.',
  en: 'Artifacts are in English. Write the rationale in English.',
  ar: 'Artifacts are in Arabic (العربية). Write the rationale in Arabic.',
};

const DIMENSION_GUIDE: Record<JudgeDimension, string> = {
  operational:
    'OPERATIONAL — is this ready to ship without manual fixing? Completeness, correct channel/format, no missing fields, no broken links/placeholders, low human effort to execute.',
  managerial:
    'MANAGERIAL — does it serve the business goal and the client relationship? On-brand, on-strategy, client-appropriate, defensible to present to the client, aligned with the brief.',
  practical:
    'PRACTICAL/PERFORMANCE — will it actually perform and NOT waste ad spend? Predicted CTR/conversion, hook strength, offer clarity, targeting fit, budget efficiency. Flag anything likely to burn money.',
  design:
    'DESIGN — is it polished and on-aesthetic? Visual/text hierarchy, readability, tone consistency, professional finish for the platform.',
};

export function composeJudgePrompt(opts: {
  artifact: JudgeArtifact;
  dimensions: JudgeDimension[];
  contextBlock: string;       // from buildAiContext().combined
  locale: 'he' | 'en' | 'ar';
  practicalScore?: number;
}): { system: string; user: string } {
  const { artifact, dimensions, contextBlock, locale, practicalScore } = opts;

  const dimGuide = dimensions.map((d) => `- ${DIMENSION_GUIDE[d]}`).join('\n');
  const scoreShape = dimensions.map((d) => `    "${d}": <int 0-100>`).join(',\n');

  const practicalHint =
    practicalScore !== undefined && dimensions.includes('practical')
      ? `\nA performance model already scored the PRACTICAL dimension at ${practicalScore}/100 — anchor your "practical" score to it (±10) unless you see a clear reason to diverge.`
      : '';

  const system = `You are the head of a top Israeli marketing agency reviewing work before it reaches a paying client. You think like the business owner: you protect the client's budget, the agency's reputation, and operational sanity. You are demanding but fair.

${LANG_ANCHOR[locale]}

You judge the artifact on these dimensions:
${dimGuide}
${practicalHint}
${contextBlock || ''}

Decide a verdict:
- "approve" — good to proceed as-is (all dimensions ≥ 70 and none critically broken).
- "revise" — usable but should be improved first (some dimension 40-69, or fixable issues).
- "reject" — do not proceed; would waste money or embarrass the agency (any dimension < 40 or a blocking flag).

═══ OUTPUT CONTRACT — return ONE valid JSON object, nothing else, no markdown, no commentary ═══
{
  "scores": {
${scoreShape}
  },
  "verdict": "approve" | "revise" | "reject",
  "rationale": "<one short paragraph, in the artifact's language>",
  "flags": ["<concrete issue or money-waste risk>", ...]
}

flags may be empty but must be present.`;

  const artifactText =
    artifact.kind === 'ad_copy'
      ? `Ad copy:\n${artifact.copy ?? ''}`
      : `Artifact kind: ${artifact.kind}\nSummary: ${artifact.summary ?? ''}\nDetails: ${JSON.stringify(artifact.meta ?? {})}`;

  const user = artifactText;

  return { system, user };
}
