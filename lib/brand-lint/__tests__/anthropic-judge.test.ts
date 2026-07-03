// lib/brand-lint/__tests__/anthropic-judge.test.ts
//
// AnthropicRegisterJudge against a mocked SDK (NO live API calls): request
// shape, strict-JSON parsing, and the malformed-response → inconclusive-flag
// contract through lintArtifact.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted((): {
  requests: Array<Record<string, unknown>>;
  responseText: string;
  fail: boolean;
} => ({ requests: [], responseText: '', fail: false }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (req: Record<string, unknown>) => {
        h.requests.push(req);
        if (h.fail) throw new Error('api down');
        return { content: [{ type: 'text', text: h.responseText }] };
      },
    };
  },
}));

import { lintArtifact } from '../lint';
import { AnthropicRegisterJudge, RegisterJudgeError } from '../types';
import { makeAtom, makeSpec } from './fixtures';

beforeEach(() => {
  h.requests.length = 0;
  h.responseText = '';
  h.fail = false;
});

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

describe('AnthropicRegisterJudge', () => {
  it('sends a well-formed request and parses a clean JSON verdict', async () => {
    h.responseText = '{"register_match": false, "concerns": ["משלב גבוה מדי"]}';
    const spec = makeSpec({ register: 'dugri', notes: 'בלי סופרלטיבים' });

    const verdict = await new AnthropicRegisterJudge().judge('תעדכנו את הפרטים. זה לוקח דקה.', spec);
    expect(verdict).toEqual({ registerMatch: false, concerns: ['משלב גבוה מדי'] });

    expect(h.requests).toHaveLength(1);
    const req = h.requests[0];
    expect(typeof req.model).toBe('string');
    expect(req.max_tokens).toBe(500);
    expect(String(req.system)).toContain('register');

    const messages = req.messages;
    expect(Array.isArray(messages)).toBe(true);
    const first: unknown = Array.isArray(messages) ? messages[0] : null;
    expect(isRecord(first)).toBe(true);
    if (isRecord(first)) {
      expect(first.role).toBe('user');
      const content = String(first.content);
      expect(content).toContain('dugri');                       // declared register
      expect(content).toContain('בלי סופרלטיבים');              // voice notes surfaced
      expect(content).toContain('תעדכנו את הפרטים');            // the artifact itself
      expect(content).toContain('<<<UNTRUSTED_ARTIFACT');       // data-only fencing
    }
  });

  it('respects the CLAUDE_LINT_MODEL env override', async () => {
    h.responseText = '{"register_match": true, "concerns": []}';
    const prev = process.env.CLAUDE_LINT_MODEL;
    process.env.CLAUDE_LINT_MODEL = 'claude-test-model';
    try {
      await new AnthropicRegisterJudge().judge('טקסט', makeSpec());
      expect(h.requests[0].model).toBe('claude-test-model');
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_LINT_MODEL;
      else process.env.CLAUDE_LINT_MODEL = prev;
    }
  });

  it('parses a code-fenced JSON response', async () => {
    h.responseText = '```json\n{"register_match": true, "concerns": []}\n```';
    const verdict = await new AnthropicRegisterJudge().judge('טקסט', makeSpec());
    expect(verdict).toEqual({ registerMatch: true, concerns: [] });
  });

  it('malformed (non-JSON) response → RegisterJudgeError, not a permissive verdict', async () => {
    h.responseText = 'אין לי מושג, סליחה';
    await expect(new AnthropicRegisterJudge().judge('טקסט', makeSpec()))
      .rejects.toBeInstanceOf(RegisterJudgeError);
  });

  it('wrong-shaped JSON (register_match not boolean) → RegisterJudgeError', async () => {
    h.responseText = '{"register_match": "yes", "concerns": []}';
    await expect(new AnthropicRegisterJudge().judge('טקסט', makeSpec()))
      .rejects.toBeInstanceOf(RegisterJudgeError);
  });

  it('empty text content → RegisterJudgeError', async () => {
    h.responseText = '';
    await expect(new AnthropicRegisterJudge().judge('טקסט', makeSpec()))
      .rejects.toBeInstanceOf(RegisterJudgeError);
  });

  it('through lintArtifact: malformed response degrades to an inconclusive FLAG, never a throw', async () => {
    h.responseText = 'garbage';
    const res = await lintArtifact('טקסט תקין לחלוטין', [makeAtom()], new AnthropicRegisterJudge());
    const inconclusive = res.violations.filter((v) => v.rule === 'register_inconclusive');
    expect(inconclusive).toHaveLength(1);
    expect(inconclusive[0].severity).toBe('flag');
    expect(res.passed).toBe(true);
    expect(res.checked.register).toBe(false);
  });

  it('through lintArtifact: an SDK/API failure also degrades to an inconclusive FLAG', async () => {
    h.fail = true;
    const res = await lintArtifact('טקסט', [makeAtom()], new AnthropicRegisterJudge());
    const inconclusive = res.violations.filter((v) => v.rule === 'register_inconclusive');
    expect(inconclusive).toHaveLength(1);
    expect(inconclusive[0].message).toContain('api down');
    expect(res.passed).toBe(true);
  });
});
