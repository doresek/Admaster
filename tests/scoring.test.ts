import { describe, it, expect } from 'vitest';
import { composeScorePrompt, parseScoreResponse } from '@/lib/scoring';

describe('composeScorePrompt', () => {
  it('includes the copy text and channel in the user prompt', () => {
    const { system, user } = composeScorePrompt({
      copy:    'בוא נגדיל לך את העסק פי 3 ב-90 יום',
      channel: 'meta_feed',
      locale:  'he',
    });
    expect(user).toContain('בוא נגדיל לך את העסק');
    expect(user).toContain('meta_feed');
    expect(system).toContain('JSON');                   // contract is JSON
    expect(system).toMatch(/Hebrew|עברית/);             // locale anchored
  });

  it('uses English anchor when locale=en', () => {
    const { system } = composeScorePrompt({ copy: 'Hello', channel: 'email', locale: 'en' });
    expect(system).toMatch(/English/);
  });

  it('appends brand DNA block when brand provided', () => {
    const { system } = composeScorePrompt({
      copy: 'x', channel: 'meta_feed', locale: 'he',
      brand: { name: 'MyShop', audience: 'בעלות עסקים' },
    });
    expect(system).toContain('MyShop');
    expect(system).toContain('בעלות עסקים');
  });
});

describe('parseScoreResponse', () => {
  const valid = JSON.stringify({
    score: 73, band: 'high',
    demographics: { age: { '18-24': 0.1, '25-34': 0.4, '35-44': 0.3, '45-54': 0.15, '55+': 0.05 },
                    gender: { m: 0.6, f: 0.4 } },
    emotions: ['urgency','social_proof'],
    extracts: { offerings:['קורס'], features:[], pains:['חוסר זמן'], benefits:['חיסכון'], ctas:['הירשם'] },
    policy_flags: [],
    predicted_hook: 'urgency',
  });

  it('parses a valid JSON response', () => {
    const r = parseScoreResponse(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.score).toBe(73);
      expect(r.value.band).toBe('high');
      expect(r.value.emotions).toEqual(['urgency','social_proof']);
    }
  });

  it('handles a fenced ```json block', () => {
    const fenced = '```json\n' + valid + '\n```';
    const r = parseScoreResponse(fenced);
    expect(r.ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const r = parseScoreResponse('not json');
    expect(r.ok).toBe(false);
  });

  it('rejects score out of range', () => {
    const bad = valid.replace('"score":73', '"score":142');
    const r = parseScoreResponse(bad);
    expect(r.ok).toBe(false);
  });

  it('corrects band when it disagrees with score (band reset to derived)', () => {
    const bad = valid.replace('"band":"high"', '"band":"low"');
    const r = parseScoreResponse(bad);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.band).toBe('high');  // score 73 → high
  });
});
