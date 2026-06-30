import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  nextStates,
  isTerminal,
  CAMPAIGN_STATUSES,
  DRY_RUN_PATH,
} from '@/lib/campaigns';

describe('campaign state machine', () => {
  it('lists all ten statuses', () => {
    expect(CAMPAIGN_STATUSES).toHaveLength(10);
    expect(CAMPAIGN_STATUSES).toContain('draft');
    expect(CAMPAIGN_STATUSES).toContain('completed');
    expect(CAMPAIGN_STATUSES).toContain('failed');
  });

  it('allows the dry-run assembly path draft→planned→generating→assembled', () => {
    expect(canTransition('draft', 'planned')).toBe(true);
    expect(canTransition('planned', 'generating')).toBe(true);
    expect(canTransition('generating', 'assembled')).toBe(true);
  });

  it('allows the live publish path from assembled onward', () => {
    expect(canTransition('assembled', 'scheduled')).toBe(true);
    expect(canTransition('scheduled', 'publishing')).toBe(true);
    expect(canTransition('publishing', 'live')).toBe(true);
    expect(canTransition('live', 'paused')).toBe(true);
    expect(canTransition('paused', 'live')).toBe(true);
    expect(canTransition('live', 'completed')).toBe(true);
  });

  it('lets any non-terminal status fail', () => {
    for (const s of CAMPAIGN_STATUSES) {
      if (s === 'completed' || s === 'failed') continue;
      expect(canTransition(s, 'failed')).toBe(true);
    }
  });

  it('rejects illegal jumps', () => {
    expect(canTransition('draft', 'live')).toBe(false);
    expect(canTransition('draft', 'assembled')).toBe(false);
    expect(canTransition('assembled', 'live')).toBe(false);
    expect(canTransition('completed', 'live')).toBe(false);
    expect(canTransition('failed', 'draft')).toBe(false);
  });

  it('treats same-state as a no-op (allowed)', () => {
    expect(canTransition('assembled', 'assembled')).toBe(true);
  });

  it('marks completed and failed as terminal', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('draft')).toBe(false);
    expect(nextStates('completed')).toHaveLength(0);
  });

  it('assertTransition throws only on illegal moves', () => {
    expect(assertTransition('draft', 'planned')).toBe('planned');
    expect(() => assertTransition('draft', 'live')).toThrow(/Illegal campaign transition/);
  });

  it('DRY_RUN_PATH stops at assembled (never publishes)', () => {
    expect(DRY_RUN_PATH[DRY_RUN_PATH.length - 1]).toBe('assembled');
    expect(DRY_RUN_PATH).not.toContain('live');
    expect(DRY_RUN_PATH).not.toContain('publishing');
  });
});
