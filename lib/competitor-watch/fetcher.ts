// lib/competitor-watch/fetcher.ts
//
// THE ISOLATION SEAM (spec C-09: "fetch layer isolated behind an interface
// with a fixture mode — scraping fragility is contained to one adapter file;
// manual-paste fallback supported from day one so the capability degrades
// gracefully").
//
// Three implementations:
//  • ManualPasteFetcher — parses a pasted block of a competitor's ads. This is
//    the day-one path: the owner opens facebook.com/ads/library, copies what a
//    competitor runs, and pastes. Deterministic 'manual:<sha256-12>' refs make
//    re-pasting idempotent (the store upserts on (entity_id, platform_ad_ref)).
//  • FixtureFetcher — canned ads per entity id, for tests and dry runs.
//  • LiveAdLibraryFetcher — a documented STUB. See its throw message for why.

import { createHash } from 'node:crypto';
import type { CompetitorEntityRow } from '@/lib/capability-contracts';
import type { FetchResult, RawObservedAd } from './types';

/** The seam: one entity in, its currently-observable ads out. Implementations
 *  MAY throw (network, malformed source) — runWatch isolates failures per
 *  entity so one broken source never kills the watch. */
export interface AdSourceFetcher {
  fetch(entity: CompetitorEntityRow): Promise<FetchResult>;
}

// ── manual paste ──────────────────────────────────────────────────────────────

/**
 * THE PASTE FORMAT (documented contract — also enforced by tests):
 *
 *   • One ad per paragraph: ads are separated by one or more blank lines,
 *     or by a line containing only `---`.
 *   • Each ad block may START with metadata lines of the form `key: value`
 *     (Hebrew or English keys, case-insensitive). Metadata parsing stops at
 *     the first non-metadata line — everything from there on is ad text
 *     verbatim, so ad copy that happens to contain a colon is safe.
 *
 *       format: image|video|carousel|...        (also: פורמט)
 *       platforms: facebook, instagram          (also: פלטפורמות)
 *       landing: https://...                    (also: דף נחיתה / לינק)
 *       first_seen: YYYY-MM-DD                  (also: מתאריך)
 *       status: inactive                        (also: סטטוס: לא פעיל)
 *
 *   • Ads default to still_active = true; `status: inactive` marks an ad the
 *     owner knows stopped running (feeds churn detection).
 *   • The ref is 'manual:' + first 12 hex chars of sha256(normalized text)
 *     where normalization lowercases and collapses whitespace — so a re-paste
 *     with different spacing/line-wrapping still maps to the SAME ad row.
 */
export const MANUAL_PASTE_FORMAT_DOC = `מודעה אחת לכל פסקה (מופרדות בשורה ריקה או ---).
שורות מטא אופציונליות בתחילת כל פסקה: format/פורמט, platforms/פלטפורמות, landing/דף נחיתה, first_seen/מתאריך (YYYY-MM-DD), status/סטטוס (inactive/לא פעיל).
כל שאר הפסקה = טקסט המודעה כלשונו.`;

const META_KEY_ALIASES: Record<string, 'format' | 'platforms' | 'landing' | 'first_seen' | 'status'> = {
  'format':      'format',
  'פורמט':       'format',
  'platforms':   'platforms',
  'פלטפורמות':   'platforms',
  'landing':     'landing',
  'דף נחיתה':    'landing',
  'לינק':        'landing',
  'first_seen':  'first_seen',
  'מתאריך':      'first_seen',
  'status':      'status',
  'סטטוס':       'status',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Hard cap on how many ads one paste (or any single fetch) may yield. Each ad
 * costs an LLM decode call, so an uncapped 30k paste could fan out into
 * hundreds of Sonnet calls per POST (cost/DoS — SECURITY-AUDIT-2 F1). The cap
 * bounds the fan-out at the source; runWatch enforces the same bound again on
 * the decode batch (defense in depth). Truncation is NEVER silent — the excess
 * count is logged here and surfaced as `ads_capped` in the run result.
 */
export const MAX_ADS_PER_RUN = 40;

/** Normalize ad text for hashing: lowercase + collapse ALL whitespace, so a
 *  re-paste with different wrapping produces the identical ref. */
const normalizeForHash = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, ' ').trim();

/** Deterministic manual ref: 'manual:<sha256-12>' of the normalized text.
 *  Exported so the store can derive the same ref for ref-less observations. */
export function manualRef(text: string): string {
  return `manual:${createHash('sha256').update(normalizeForHash(text), 'utf8').digest('hex').slice(0, 12)}`;
}

interface ParsedMeta {
  format?:     string;
  platforms?:  string[];
  landing?:    string;
  first_seen?: string;
  inactive:    boolean;
}

function parseMetaLine(line: string): { key: 'format' | 'platforms' | 'landing' | 'first_seen' | 'status'; value: string } | null {
  const m = /^([^:\n]{1,20}):\s*(.+)$/.exec(line.trim());
  if (!m) return null;
  const key = META_KEY_ALIASES[m[1].trim().toLowerCase()];
  if (!key) return null;
  return { key, value: m[2].trim() };
}

/**
 * PURE parser: pasted block → RawObservedAd[]. Deterministic (same input,
 * same output, same refs). Blocks that yield no ad text are skipped.
 */
export function parsePastedAds(rawText: string): RawObservedAd[] {
  // Line-walk split: a blank line or a ruler line (---) ends the current block.
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    if (line.trim() === '' || /^-{3,}$/.test(line.trim())) {
      if (current.length) blocks.push(current.join('\n').trim());
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join('\n').trim());

  const ads: RawObservedAd[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const meta: ParsedMeta = { inactive: false };
    let i = 0;
    // Metadata only at the START of the block; the first non-meta line ends it.
    for (; i < lines.length; i++) {
      const parsed = parseMetaLine(lines[i]);
      if (!parsed) break;
      if (parsed.key === 'format')     meta.format = parsed.value;
      if (parsed.key === 'platforms')  meta.platforms = parsed.value.split(',').map((p) => p.trim()).filter(Boolean);
      if (parsed.key === 'landing')    meta.landing = parsed.value;
      if (parsed.key === 'first_seen' && DATE_RE.test(parsed.value)) meta.first_seen = parsed.value;
      if (parsed.key === 'status') {
        const v = parsed.value.toLowerCase();
        meta.inactive = v === 'inactive' || v.includes('לא פעיל');
      }
    }
    const text = lines.slice(i).join('\n').trim();
    if (!text) continue;

    ads.push({
      ref:          manualRef(text),
      text,
      ...(meta.format     !== undefined ? { format: meta.format } : {}),
      ...(meta.platforms  !== undefined ? { platforms: meta.platforms } : {}),
      ...(meta.landing    !== undefined ? { landing_url: meta.landing } : {}),
      ...(meta.first_seen !== undefined ? { first_seen: meta.first_seen } : {}),
      still_active: !meta.inactive,
    });
  }

  // Cost/DoS guard (F1): cap the fan-out so one paste can never spawn an
  // unbounded number of LLM decode calls. Truncate, but log the drop count —
  // no silent evidence loss.
  if (ads.length > MAX_ADS_PER_RUN) {
    console.warn(
      `[competitor-watch] paste yielded ${ads.length} ads; capping to MAX_ADS_PER_RUN=${MAX_ADS_PER_RUN} ` +
      `(${ads.length - MAX_ADS_PER_RUN} dropped — split the paste to process the rest)`,
    );
    return ads.slice(0, MAX_ADS_PER_RUN);
  }
  return ads;
}

/** Manual-paste fetcher: bound to ONE pasted block, returns the same parse for
 *  whichever entity it is asked about — callers pair it with the entity the
 *  paste belongs to (the API route scopes it to a single entityId). */
export class ManualPasteFetcher implements AdSourceFetcher {
  constructor(private readonly rawText: string) {}

  fetch(_entity: CompetitorEntityRow): Promise<FetchResult> {
    return Promise.resolve({ ads: parsePastedAds(this.rawText), source: 'manual_paste' });
  }
}

// ── fixtures ──────────────────────────────────────────────────────────────────

/** Canned ads per entity id — the test/dry-run mode the spec mandates. */
export class FixtureFetcher implements AdSourceFetcher {
  constructor(private readonly byEntityId: Record<string, RawObservedAd[]>) {}

  fetch(entity: CompetitorEntityRow): Promise<FetchResult> {
    return Promise.resolve({ ads: this.byEntityId[entity.id] ?? [], source: 'fixture' });
  }
}

// ── live Ad Library (stub by design) ─────────────────────────────────────────

/**
 * Live Meta Ad Library pull — INTENTIONALLY not implemented (spec C-09 marks
 * live pull "best-effort follow-up", dispatch wave W-β).
 *
 * WHY a stub: the Ad Library's public web surface has no stable contract —
 * markup changes, rate limits and login walls make scraping fragile, and the
 * official ads_archive API only returns non-political ads reliably for EU
 * reach data. That fragility is CONTAINED HERE by design: when a live adapter
 * lands, only this class changes; the pipeline (store → decode → analyze →
 * atoms) is already fully useful via ManualPasteFetcher, so the capability
 * degrades gracefully instead of silently returning wrong data.
 */
export class LiveAdLibraryFetcher implements AdSourceFetcher {
  fetch(_entity: CompetitorEntityRow): Promise<FetchResult> {
    return Promise.reject(new Error(
      'not implemented — Ad Library live pull is best-effort follow-up (spec C-09, wave W-β); ' +
      'use ManualPasteFetcher meanwhile',
    ));
  }
}
