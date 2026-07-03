// Deep tests for the PURE funnel design + health (skill §4): the awareness →
// funnel-length matrix, belief citations, expected-rate provenance resolution,
// the walk-backwards structural invariant, and the statistical humility of
// funnelHealth (insufficient-n edges can never be blamed).

import { describe, expect, it } from 'vitest';
import type { FunnelEdge, FunnelNode } from '@/lib/capability-contracts';
import {
  DEFAULT_PRIORS,
  MIN_EDGE_N,
  designFunnel,
  funnelHealth,
  resolveAwareness,
} from '../funnel';
import type { FunnelDesignInput } from '../types';
import { allAtoms, dentalFixtures } from './fixtures';

const f = dentalFixtures();
const insights = allAtoms(f);

const design = (over: Partial<FunnelDesignInput['decision']> = {}, rest: Partial<FunnelDesignInput> = {}) =>
  designFunnel({
    decision: { funnel_stage: 'BOFU', angle: 'לחייך בביטחון בלי בושה', awareness: 'most-aware', ...over },
    insights,
    ...rest,
  });

/** The §4.1 walk-backwards invariant: connected chain, every non-terminal node flows on. */
function assertBackwardsChain(nodes: FunnelNode[], edges: FunnelEdge[]): void {
  const keys = new Set(nodes.map((n) => n.key));
  for (const e of edges) {
    expect(keys.has(e.from)).toBe(true);
    expect(keys.has(e.to)).toBe(true);
  }
  // Every node except the terminal sale has an outgoing edge.
  const froms = new Set(edges.map((e) => e.from));
  for (const n of nodes) {
    if (n.key === 'sale') continue;
    expect(froms.has(n.key)).toBe(true);
  }
  // Connected: walking from the entry node reaches every node.
  const targets = new Set(edges.map((e) => e.to));
  const entry = nodes.find((n) => !targets.has(n.key));
  expect(entry).toBeDefined();
  const visited = new Set<string>();
  const queue = entry ? [entry.key] : [];
  while (queue.length) {
    const k = queue.pop();
    if (k === undefined || visited.has(k)) continue;
    visited.add(k);
    edges.filter((e) => e.from === k).forEach((e) => queue.push(e.to));
  }
  expect(visited.size).toBe(nodes.length);
}

describe('designFunnel — awareness matrix (funnel length = awareness distance)', () => {
  it('most-aware → SHORT: ad → landing → lead → sale (4 nodes)', () => {
    const { funnel } = design({ awareness: 'most-aware' });
    expect(funnel.nodes.map((n) => n.key)).toEqual(['ad', 'landing', 'lead_form', 'sale']);
    expect(funnel.edges.map((e) => e.event)).toEqual(['ad_click', 'landing_lead', 'lead_to_sale']);
    expect(funnel.awareness_entry).toBe('most-aware');
    assertBackwardsChain(funnel.nodes, funnel.edges);
  });

  it('product-aware → SHORT as well', () => {
    const { funnel } = design({ awareness: 'product-aware' });
    expect(funnel.nodes).toHaveLength(4);
  });

  it('problem-aware → + whatsapp_sequence nurture node (5 nodes)', () => {
    const { funnel } = design({ awareness: 'problem-aware', funnel_stage: 'TOFU' });
    expect(funnel.nodes.map((n) => n.key)).toEqual([
      'ad', 'landing', 'lead_form', 'whatsapp_sequence', 'sale',
    ]);
    expect(funnel.edges.map((e) => e.event)).toEqual([
      'ad_click', 'landing_lead', 'whatsapp_engaged', 'whatsapp_to_sale',
    ]);
    assertBackwardsChain(funnel.nodes, funnel.edges);
  });

  it('unaware → 6+ nodes including content + retargeting in front', () => {
    const { funnel } = design({ awareness: 'unaware', funnel_stage: 'TOFU' });
    expect(funnel.nodes.length).toBeGreaterThanOrEqual(6);
    expect(funnel.nodes.map((n) => n.key)).toEqual([
      'content', 'retargeting', 'ad', 'landing', 'lead_form', 'whatsapp_sequence', 'sale',
    ]);
    expect(funnel.nodes[0].kind).toBe('content');
    expect(funnel.nodes[1].kind).toBe('retargeting');
    assertBackwardsChain(funnel.nodes, funnel.edges);
  });

  it('Hebrew awareness content resolves through the decide.ts vocabulary', () => {
    expect(resolveAwareness('מודע לבעיה — דוחה טיפול')).toBe('problem-aware');
    expect(resolveAwareness('הכי מודע')).toBe('most-aware');
    expect(resolveAwareness('לא מודע בכלל')).toBe('unaware');
    expect(resolveAwareness('סתם טקסט')).toBeUndefined();
  });

  it('no explicit awareness → falls back to the client awareness atom (and grounds it)', () => {
    const { funnel } = design({ awareness: undefined });
    // f.awareness = "מודע לבעיה — ..." → problem-aware → medium funnel.
    expect(funnel.awareness_entry).toBe('problem-aware');
    expect(funnel.nodes.map((n) => n.key)).toContain('whatsapp_sequence');
    expect(funnel.grounded_in).toContain(f.awareness.id);
  });

  it('no awareness signal at all → shortest honest stage interpretation + warning', () => {
    const { funnel, warnings } = designFunnel({
      decision: { funnel_stage: 'BOFU', angle: 'זווית' },
      insights: [],
    });
    expect(funnel.awareness_entry).toBe('product-aware');
    expect(funnel.nodes).toHaveLength(4);
    expect(warnings.some((w) => w.includes('No awareness signal'))).toBe(true);
  });
});

describe('designFunnel — beliefs cite real atoms', () => {
  it('every node installs a belief; ad/landing/lead cite the chain atoms', () => {
    const { funnel, warnings } = design({ awareness: 'most-aware' });
    for (const node of funnel.nodes) {
      expect(node.belief_installed.text.length).toBeGreaterThan(0);
    }
    const byKey = new Map(funnel.nodes.map((n) => [n.key, n]));
    // ad: "this speaks about me" ← the desire the angle expresses (desire1
    // shares the token לחייך/בביטחון with the angle).
    expect(byKey.get('ad')?.belief_installed.insight_id).toBe(f.desire1.id);
    // landing: "these people can fix MY problem" ← top mechanism/proof atom.
    expect(byKey.get('landing')?.belief_installed.insight_id).toBe(f.mechanism.id);
    // lead (short funnel): "offer beats my alternative" ← top objection.
    expect(byKey.get('lead_form')?.belief_installed.insight_id).toBe(f.objPrice.id);
    expect(warnings).toEqual([]); // full brain → no uncited beliefs
  });

  it('whatsapp nurture node carries the objection belief in medium funnels', () => {
    const { funnel } = design({ awareness: 'problem-aware' });
    const wa = funnel.nodes.find((n) => n.key === 'whatsapp_sequence');
    expect(wa?.kind).toBe('whatsapp_sequence');
    expect(wa?.belief_installed.insight_id).toBe(f.objPrice.id);
  });

  it('grounded_in collects exactly the cited atom ids, sorted', () => {
    const { funnel } = design({ awareness: 'unaware' });
    expect(funnel.grounded_in).toEqual([...funnel.grounded_in].sort());
    for (const node of funnel.nodes) {
      const id = node.belief_installed.insight_id;
      if (id) expect(funnel.grounded_in).toContain(id);
    }
  });

  it('no atoms → text-only beliefs, one warning per uncited belief, no throw', () => {
    const { funnel, warnings } = designFunnel({
      decision: { funnel_stage: 'BOFU', angle: 'זווית כלשהי', awareness: 'most-aware' },
      insights: [],
    });
    for (const node of funnel.nodes) {
      expect(node.belief_installed.insight_id).toBeUndefined();
      expect(node.belief_installed.text.length).toBeGreaterThan(0);
    }
    expect(funnel.grounded_in).toEqual([]);
    expect(warnings.filter((w) => w.includes('text-only')).length).toBeGreaterThanOrEqual(3);
  });
});

describe('designFunnel — expected rates + provenance', () => {
  it('every edge has an event, a positive expected rate and a provenance', () => {
    const { funnel } = design({ awareness: 'unaware' });
    for (const edge of funnel.edges) {
      expect(edge.event.length).toBeGreaterThan(0);
      expect(edge.expected.rate).toBeGreaterThan(0);
      expect(edge.expected.provenance).toBe('playbook_prior'); // no baselines given
      expect(edge.expected.rate).toBe(DEFAULT_PRIORS[edge.event]); // prior table is the source
    }
  });

  it('client baseline with n≥30 wins → client_baseline', () => {
    const { funnel } = design({}, { baselines: { landing_lead: { rate: 0.09, n: 45 } } });
    const edge = funnel.edges.find((e) => e.event === 'landing_lead');
    expect(edge?.expected).toEqual({ rate: 0.09, provenance: 'client_baseline' });
  });

  it('baseline under the floor is noise → prior + warning', () => {
    const { funnel, warnings } = design({}, { baselines: { ad_click: { rate: 0.03, n: 10 } } });
    const edge = funnel.edges.find((e) => e.event === 'ad_click');
    expect(edge?.expected).toEqual({ rate: DEFAULT_PRIORS.ad_click, provenance: 'playbook_prior' });
    expect(warnings.some((w) => w.includes('n=10') && w.includes('ignored'))).toBe(true);
  });

  it('caller-declared override (no baseline) → declared_guess', () => {
    const { funnel } = design({}, { overrides: { lead_to_sale: 0.2 } });
    const edge = funnel.edges.find((e) => e.event === 'lead_to_sale');
    expect(edge?.expected).toEqual({ rate: 0.2, provenance: 'declared_guess' });
  });

  it('a sufficient baseline beats a declared override (real data first)', () => {
    const { funnel } = design({}, {
      baselines: { lead_to_sale: { rate: 0.15, n: 60 } },
      overrides: { lead_to_sale: 0.3 },
    });
    const edge = funnel.edges.find((e) => e.event === 'lead_to_sale');
    expect(edge?.expected).toEqual({ rate: 0.15, provenance: 'client_baseline' });
  });
});

describe('funnelHealth — localization with statistical humility', () => {
  const shortFunnel = design({ awareness: 'most-aware' }).funnel;

  it('identifies the worst SUFFICIENT edge by actual/expected ratio', () => {
    const health = funnelHealth(shortFunnel, {
      ad_click:     { rate: 0.006, n: 5000 }, // ratio 0.006/0.012 = 0.5 ← worst readable
      landing_lead: { rate: 0.05,  n: 40 },   // ratio ≈ 0.909
      lead_to_sale: { rate: 0.12,  n: 35 },   // ratio 1.0
    });
    expect(health.worst_edge?.event).toBe('ad_click');
    expect(health.worst_edge?.ratio).toBeCloseTo(0.5, 10);
    expect(health.reason).toBeUndefined();
    expect(health.edges).toHaveLength(3);
  });

  it('an edge with a TERRIBLE ratio but n<30 is unreadable and must NOT be blamed', () => {
    const health = funnelHealth(shortFunnel, {
      ad_click:     { rate: 0.010, n: 5000 }, // ratio ≈ 0.83 — readable, mediocre
      lead_to_sale: { rate: 0.001, n: 5 },    // ratio ≈ 0.008 — catastrophic BUT n=5
    });
    expect(health.worst_edge?.event).toBe('ad_click'); // the readable one gets the blame
    const tiny = health.edges.find((e) => e.event === 'lead_to_sale');
    expect(tiny?.sufficient_n).toBe(false);
    expect(tiny?.ratio).toBeLessThan(0.01); // reported for transparency, never blamed
  });

  it('no sufficient edge at all → worst_edge null + explicit reason', () => {
    const health = funnelHealth(shortFunnel, {
      ad_click: { rate: 0.001, n: 3 },
    });
    expect(health.worst_edge).toBeNull();
    expect(health.reason).toContain(`n≥${MIN_EDGE_N}`);
    expect(health.reason).toContain('do not diagnose');
  });

  it('edges with no actuals report null ratio and insufficient_n', () => {
    const health = funnelHealth(shortFunnel, {});
    for (const e of health.edges) {
      expect(e.actual).toBeNull();
      expect(e.ratio).toBeNull();
      expect(e.sufficient_n).toBe(false);
    }
    expect(health.worst_edge).toBeNull();
  });

  it('ratio math is exact and stale edge.actual is used as fallback', () => {
    const withStale = {
      edges: shortFunnel.edges.map((e) =>
        e.event === 'landing_lead'
          ? { ...e, actual: { rate: 0.11, n: 90 } } // persisted actual (0.11/0.055 = 2.0)
          : e,
      ),
    };
    const health = funnelHealth(withStale, {});
    const edge = health.edges.find((e) => e.event === 'landing_lead');
    expect(edge?.ratio).toBeCloseTo(2.0, 10);
    expect(edge?.sufficient_n).toBe(true);
    expect(health.worst_edge?.event).toBe('landing_lead'); // the only readable edge
  });
});
