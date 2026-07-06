// lib/articles/store.ts
//
// P3-2 write side: persist a scored topic backlog as `articles` rows in status
// 'idea' (migration 054). Slugs are Hebrew-safe (transliteration + a stable
// content hash suffix) and deterministic, so re-saving the same backlog is
// idempotent: unique(client_id, slug) conflicts are SKIPPED, never churned.
// Best-effort per row — this function never throws.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArticleTopic, SaveTopicsResult } from './types';

// ── Hebrew-safe slug ──────────────────────────────────────────────────────────

const HE_TRANSLIT: Record<string, string> = {
  'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z',
  'ח': 'ch', 'ט': 't', 'י': 'y', 'כ': 'k', 'ך': 'k', 'ל': 'l', 'מ': 'm',
  'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p', 'ף': 'f',
  'צ': 'ts', 'ץ': 'ts', 'ק': 'k', 'ר': 'r', 'ש': 'sh', 'ת': 't',
};

/** FNV-1a 32-bit, hex — a stable fingerprint of the Hebrew title so distinct
    titles that transliterate identically still get distinct slugs. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Deterministic Hebrew-safe slug: transliterate, kebab-case, cap length,
    always suffix the title hash (uniqueness without churn on re-save). */
export function topicSlug(titleHe: string): string {
  const translit = titleHe
    .toLowerCase()
    .split('')
    .map((ch) => HE_TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return `${translit || 'topic'}-${fnv1a(titleHe)}`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

export interface SaveTopicsAsIdeasInput {
  topics:      ArticleTopic[];
  clientId:    string;
  ownerUserId: string;
  admin:       SupabaseClient;
}

/**
 * Upsert-as-ideas: insert one `articles` row per topic (status 'idea'); a
 * unique(client_id, slug) conflict — i.e. the idea already exists — is counted
 * as skipped. Any per-row failure is swallowed into `skipped` so one bad row
 * never loses the rest of the backlog.
 */
export async function saveTopicsAsIdeas(input: SaveTopicsAsIdeasInput): Promise<SaveTopicsResult> {
  const { topics, clientId, ownerUserId, admin } = input;
  let created = 0;
  let skipped = 0;

  for (const topic of topics) {
    try {
      const { error } = await admin.from('articles').insert({
        client_id:     clientId,
        owner_user_id: ownerUserId,
        slug:          topicSlug(topic.title_he),
        title:         topic.title_he,
        kind:          topic.kind,
        keywords:      topic.query_patterns,
        topic_source:  topic as unknown as Record<string, unknown>,
        status:        'idea',
        grounded_in:   topic.atomIds,
        rationale:     topic.rationale_he,
      });
      if (error) skipped++; // 23505 duplicate slug, or any other per-row failure
      else created++;
    } catch {
      skipped++;
    }
  }

  return { created, skipped };
}
