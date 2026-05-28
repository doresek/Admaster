import { describe, it, expect } from 'vitest';
import { composeScorePrompt } from '@/lib/scoring';

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
