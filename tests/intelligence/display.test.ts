// Pure display-helper tests for the Client Intelligence UI: confidence bands,
// source chips, relative freshness, average confidence and the build-in-progress
// decision. No React, no DOM.
import { describe, it, expect } from 'vitest';
import {
  confidenceBand,
  confidencePct,
  sourceMeta,
  relativeHe,
  avgConfidencePct,
  shouldShowBuilding,
} from '@/lib/intelligence/display';

describe('confidenceBand', () => {
  it('labels גבוה at >= 0.8', () => {
    expect(confidenceBand(0.8).label).toBe('גבוה');
    expect(confidenceBand(0.95).tone).toBe('high');
  });
  it('labels בינוני in [0.5, 0.79]', () => {
    expect(confidenceBand(0.5).label).toBe('בינוני');
    expect(confidenceBand(0.79).tone).toBe('mid');
  });
  it('labels נמוך below 0.5', () => {
    expect(confidenceBand(0.49).label).toBe('נמוך');
    expect(confidenceBand(0).tone).toBe('low');
  });
  it('color-codes each band distinctly', () => {
    expect(confidenceBand(0.9).bar).not.toBe(confidenceBand(0.6).bar);
    expect(confidenceBand(0.6).bar).not.toBe(confidenceBand(0.2).bar);
  });
});

describe('confidencePct', () => {
  it('clamps and rounds to 0..100', () => {
    expect(confidencePct(0.596)).toBe(60);
    expect(confidencePct(1.5)).toBe(100);
    expect(confidencePct(-1)).toBe(0);
  });
});

describe('sourceMeta', () => {
  it('maps each known source to icon + Hebrew label', () => {
    expect(sourceMeta('brief')).toEqual({ icon: '📋', label: 'מהבריף' });
    expect(sourceMeta('user_signal')).toEqual({ icon: '✓', label: 'ממשוב' });
    expect(sourceMeta('content_performance')).toEqual({ icon: '📊', label: 'מביצועים' });
    expect(sourceMeta('ai_synthesis')).toEqual({ icon: '🤖', label: 'הסקה' });
  });
});

describe('relativeHe', () => {
  const now = new Date('2026-06-29T12:00:00Z').getTime();
  it('returns עכשיו for very recent', () => {
    expect(relativeHe(new Date(now - 5000).toISOString(), now)).toBe('עכשיו');
  });
  it('returns minutes/hours/days', () => {
    expect(relativeHe(new Date(now - 5 * 60_000).toISOString(), now)).toBe('לפני 5 דקות');
    expect(relativeHe(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('לפני 3 שעות');
    expect(relativeHe(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('לפני 2 ימים');
  });
  it('handles null', () => {
    expect(relativeHe(null)).toBe('');
  });
});

describe('avgConfidencePct', () => {
  it('averages and rounds to a percentage', () => {
    expect(avgConfidencePct([{ confidence: 0.8 }, { confidence: 0.6 }])).toBe(70);
  });
  it('returns 0 for an empty set', () => {
    expect(avgConfidencePct([])).toBe(0);
  });
});

describe('shouldShowBuilding', () => {
  it('is true only when there are no atoms AND no synthesized core', () => {
    expect(shouldShowBuilding([], null)).toBe(true);
    expect(shouldShowBuilding([{ id: 'a' }], null)).toBe(false);
    expect(shouldShowBuilding([], '2026-01-01')).toBe(false);
  });
});
