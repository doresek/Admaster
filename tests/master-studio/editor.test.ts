// tests/master-studio/editor.test.ts
import { describe, it, expect } from 'vitest';
import { composeEditorPrompt, parseEditor } from '@/lib/master-studio/editor';

const draft = { post: 'פוסט חלש', hashtags: ['#x'], image: 'img', tips: 't', whatsapp: 'w', principles: [] };
const marketer = { id: 'halbert', name: 'Gary Halbert', emoji: '🔥' };
const score = { index: 0, score: 64, dims: { hook_strength: 50, clarity: 80, emotional_resonance: 55, cta_strength: 60, brand_fit: 70, awareness_match: 68, framework_adherence: 66 }, note: 'hook חלש' };

describe('composeEditorPrompt', () => {
  it('includes the weak dims and the original post', () => {
    const { system, user } = composeEditorPrompt(draft as any, marketer as any, score as any, { brief: 'x', platform: 'FB' });
    expect(user).toContain('פוסט חלש');
    expect(system).toContain('hook_strength');   // names a dim to lift
    expect(system).toContain(marketer.name);
    expect(system).toContain('[POST]');
  });
});

describe('parseEditor', () => {
  it('parses the rewritten post (reuses post-tag parser)', () => {
    const d = parseEditor('[POST]פוסט משופר[/POST][HASHTAGS]#y[/HASHTAGS]')!;
    expect(d.post).toBe('פוסט משופר');
    expect(d.hashtags).toEqual(['#y']);
  });
  it('returns null when no [POST]', () => {
    expect(parseEditor('nothing')).toBeNull();
  });
});
