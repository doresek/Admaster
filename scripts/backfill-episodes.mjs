#!/usr/bin/env node
// scripts/backfill-episodes.mjs — C-02 cold-path backfill.
//
// Embeds the EXISTING resolved experience (resolved hypotheses + diagnoses,
// migrations 030/034) into episode_embeddings (migration 035) for every
// client, so episodic recall has precedents from day one.
//
// WHY the logic is inlined: this repo runs Node 20 with no tsx/TS loader, so a
// plain .mjs script cannot import the lib/episodic TypeScript sources. This
// script therefore re-implements the minimal read → compose → embed → upsert
// loop inline using @supabase/supabase-js directly. It deliberately MIRRORS
// lib/episodic (compose.ts / ingest.ts) — lib/episodic is the SOURCE OF TRUTH;
// if the episode rendering there changes, update this mirror.
//
// Safety (err-safe overnight rule):
//   • DEFAULT IS DRY-RUN: prints what it would compose/write, embeds nothing,
//     writes nothing. Pass --execute to actually embed + upsert.
//   • Refuses to run without NEXT_PUBLIC_SUPABASE_URL +
//     SUPABASE_SERVICE_ROLE_KEY + GOOGLE_AI_API_KEY (all from .env.local).
//   • Idempotent: skips (source_kind, source_id) pairs that already have
//     episodes, and upserts on that same unique index.
//
// Usage:
//   node scripts/backfill-episodes.mjs                 # dry-run (default)
//   node scripts/backfill-episodes.mjs --dry-run       # explicit dry-run
//   node scripts/backfill-episodes.mjs --execute       # embed + write
//   node scripts/backfill-episodes.mjs --client <uuid> # one client only
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EMBEDDING_DIMS = 768; // pinned to migration 035 vector(768)
const GOOGLE_MODEL = 'text-embedding-004';
const GOOGLE_BATCH_LIMIT = 100;

// ── env ───────────────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = join(REPO_ROOT, '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

// ── flags ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const onlyClientIdx = argv.indexOf('--client');
const ONLY_CLIENT = onlyClientIdx >= 0 ? argv[onlyClientIdx + 1] : null;

// ── compose (MIRRORS lib/episodic/compose.ts — that module is source of truth)

const oneLine = (text, max = 240) => {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
};

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function composeFromDiagnosis(row) {
  if (!row.id || typeof row.rationale !== 'string' || !row.rationale.trim() || !row.failed_link) return null;
  const ev = isRecord(row.evidence) ? row.evidence : {};
  const metrics = isRecord(ev.metrics)
    ? Object.entries(ev.metrics)
        .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
        .sort(([a], [b]) => a.localeCompare(b)).slice(0, 6)
        .map(([k, v]) => `${k}=${v}`).join(', ')
    : '';
  const bits = [
    typeof ev.vertical === 'string' && ev.vertical ? `vertical: ${ev.vertical}` : null,
    typeof ev.funnel_stage === 'string' && ev.funnel_stage ? `funnel stage ${ev.funnel_stage}` : null,
    typeof ev.angle === 'string' && ev.angle ? `angle "${oneLine(ev.angle, 80)}"` : null,
    metrics ? `metrics: ${metrics}` : null,
  ].filter(Boolean);
  const action = isRecord(row.recommended_action)
    ? (row.recommended_action.summary || row.recommended_action.action || row.recommended_action.type || '')
    : '';
  const noFail = row.failed_link === 'none';
  return {
    source_kind: 'diagnosis',
    source_id: row.id,
    outcome: noFail ? 'inconclusive' : 'loss',
    insight_ids: Array.isArray(row.target_insight_ids) ? row.target_insight_ids : [],
    metadata: { failed_link: row.failed_link, applied: row.applied === true },
    episode_text: [
      `Situation: ${bits.length ? `campaign item underperformed — ${bits.join('; ')}.` : 'campaign item underperformed.'}`,
      `Action: ran link-isolation diagnosis over the client's insight atoms${action ? `; recommended: ${oneLine(action, 160)}` : ''}.`,
      `Outcome: ${noFail ? 'no failing link found (execution intact).' : `failed link = ${row.failed_link}.`}`,
      `Lesson: ${noFail ? 'no link failure' : `${row.failed_link} link broke`} — ${oneLine(row.rationale)}`,
    ].join('\n'),
  };
}

function composeFromHypothesis(row) {
  const RESOLVED = new Set(['supported', 'refuted', 'inconclusive', 'killed']);
  if (!row.id || !RESOLVED.has(row.status) || typeof row.claim !== 'string' || !row.claim.trim() || !isRecord(row.prediction)) return null;
  const p = row.prediction;
  const res = isRecord(row.resolution) ? row.resolution : null;
  const resolvedBy = res && typeof res.resolved_by === 'string' ? res.resolved_by : null;
  const observed = res && isRecord(res.observed) && Object.keys(res.observed).length
    ? oneLine(JSON.stringify(res.observed), 200) : null;
  const verdict = row.status === 'killed' && resolvedBy ? `killed (${resolvedBy})` : row.status;
  const outcome = { supported: 'win', refuted: 'loss', killed: 'loss', inconclusive: 'inconclusive' }[row.status];
  return {
    source_kind: 'hypothesis',
    source_id: row.id,
    outcome,
    insight_ids: Array.isArray(row.insight_ids) ? row.insight_ids : [],
    metadata: { domain: row.domain, status: row.status, ...(resolvedBy ? { resolved_by: resolvedBy } : {}) },
    episode_text: [
      `Situation: pre-registered hypothesis (domain: ${row.domain}) — claim: "${oneLine(row.claim, 200)}". Prediction: ${p.metric} ${p.comparator} ${p.value} on arm "${p.arm}"${p.baseline_arm ? ` (vs "${p.baseline_arm}")` : ''} @confidence ${p.confidence}.`,
      `Action: ran the test to its floor/horizon${resolvedBy ? ` (resolved by ${resolvedBy})` : ''}.`,
      `Outcome: ${verdict}${observed ? ` — observed ${observed}` : ''}.`,
      `Lesson: ${verdict}: ${oneLine(row.claim, 200)}`,
    ].join('\n'),
  };
}

// abstraction mirror (lib/episodic/compose.ts abstractEpisode)
const URL_RE   = /\bhttps?:\/\/[^\s)>\]]+|\bwww\.[^\s)>\]]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<!\d)(?:\+972(?:[-\s.]?\d){8,9}|0(?:[-\s.]?\d){8,9}|\+\d(?:[-\s.]?\d){8,14})(?!\d)/g;

function abstractEpisode(text, clientName, businessTerms = []) {
  if (!text || !text.trim()) return null;
  let out = text.replace(URL_RE, '{url}').replace(EMAIL_RE, '{email}').replace(PHONE_RE, '{phone}');
  const termRe = (term) => new RegExp(
    term.trim().split(/\s+/)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/["״”]/g, '["״”]'))
      .join('\\s+'),
    'giu',
  );
  if (clientName && clientName.trim()) out = out.replace(termRe(clientName), '{business}');
  for (const term of businessTerms) if (term && term.trim()) out = out.replace(termRe(term), '{term}');
  out = out.trim();
  const residual = out.replace(/\{[a-z]+\}/g, '').replace(/\s+/g, ' ').trim();
  return residual.length < 40 ? null : out;
}

// ── embedding (Google text-embedding-004, batched) ───────────────────────────

async function embedBatch(texts, apiKey) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += GOOGLE_BATCH_LIMIT) {
    const chunk = texts.slice(i, i + GOOGLE_BATCH_LIMIT);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requests: chunk.map((text) => ({ model: `models/${GOOGLE_MODEL}`, content: { parts: [{ text }] } })),
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`embed failed: HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    const payload = await res.json();
    if (!Array.isArray(payload?.embeddings) || payload.embeddings.length !== chunk.length) {
      throw new Error(`embed response mismatch: sent ${chunk.length}, got ${payload?.embeddings?.length ?? 'none'}`);
    }
    for (const e of payload.embeddings) {
      if (!Array.isArray(e?.values) || e.values.length !== EMBEDDING_DIMS) {
        throw new Error(`embedding has ${e?.values?.length ?? 0} dims, expected ${EMBEDDING_DIMS}`);
      }
      vectors.push(e.values);
    }
  }
  return vectors;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const googleKey = process.env.GOOGLE_AI_API_KEY;
  const missing = [
    !url && 'NEXT_PUBLIC_SUPABASE_URL',
    !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    // GOOGLE_AI_API_KEY is what --execute embeds with; dry-run reads only.
    EXECUTE && !googleKey && 'GOOGLE_AI_API_KEY',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`REFUSING to run — missing env (.env.local): ${missing.join(', ')}`);
    process.exit(1);
  }
  if (!EXECUTE && !googleKey) {
    console.warn('WARNING: GOOGLE_AI_API_KEY is not set — dry-run works (no embedding), but --execute will refuse.');
  }

  console.log(`backfill-episodes — mode: ${EXECUTE ? 'EXECUTE (embeds + writes)' : 'DRY-RUN (default; no embeds, no writes — pass --execute to write)'}`);

  // supabase-js eagerly constructs a RealtimeClient; Node 20 has no native
  // WebSocket, and this script never opens realtime channels — no-op transport.
  class NoopWebSocket {
    constructor(address) { this.url = String(address); this.readyState = 3; this.protocol = ''; }
    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  }
  const supabase = createClient(url, serviceKey, {
    auth:     { persistSession: false },
    realtime: { transport: NoopWebSocket },
  });

  let clientsQuery = supabase.from('clients').select('id, name, company, owner_user_id').order('created_at', { ascending: true });
  if (ONLY_CLIENT) clientsQuery = clientsQuery.eq('id', ONLY_CLIENT);
  const clientsRes = await clientsQuery;
  if (clientsRes.error) throw new Error(`clients query failed: ${clientsRes.error.message}`);
  const clients = clientsRes.data ?? [];
  console.log(`clients: ${clients.length}${ONLY_CLIENT ? ` (filtered to ${ONLY_CLIENT})` : ''}`);

  const totals = { composed: 0, upserted: 0, skippedExisting: 0, skippedMalformed: 0 };

  for (const client of clients) {
    const existingRes = await supabase
      .from('episode_embeddings')
      .select('source_kind, source_id')
      .eq('client_id', client.id);
    if (existingRes.error) throw new Error(`existing-episodes query failed (${client.id}): ${existingRes.error.message}`);
    const existing = new Set((existingRes.data ?? []).map((r) => `${r.source_kind}:${r.source_id}`));

    const hypRes = await supabase
      .from('hypotheses')
      .select('id, client_id, owner_user_id, claim, prediction, domain, status, resolution, insight_ids, resolved_at')
      .eq('client_id', client.id)
      .in('status', ['supported', 'refuted', 'inconclusive', 'killed']);
    if (hypRes.error) throw new Error(`hypotheses query failed (${client.id}): ${hypRes.error.message}`);

    const diagRes = await supabase
      .from('diagnoses')
      .select('id, client_id, owner_user_id, scope_item_id, failed_link, rationale, evidence, target_insight_ids, recommended_action, applied, created_at')
      .eq('client_id', client.id);
    if (diagRes.error) throw new Error(`diagnoses query failed (${client.id}): ${diagRes.error.message}`);

    const episodes = [];
    const consider = (kind, rows, compose) => {
      for (const row of rows ?? []) {
        if (existing.has(`${kind}:${row.id}`)) { totals.skippedExisting += 1; continue; }
        const episode = compose(row);
        if (!episode) {
          totals.skippedMalformed += 1;
          console.warn(`  ! skipping malformed ${kind} ${row.id ?? '<no id>'} (client ${client.id})`);
          continue;
        }
        episodes.push({ ...episode, owner_user_id: row.owner_user_id });
      }
    };
    consider('hypothesis', hypRes.data, composeFromHypothesis);
    consider('diagnosis', diagRes.data, composeFromDiagnosis);
    totals.composed += episodes.length;

    const label = `${client.name ?? client.id}`;
    if (episodes.length === 0) {
      console.log(`- ${label}: nothing new (existing ${existing.size})`);
      continue;
    }

    if (!EXECUTE) {
      console.log(`- ${label}: WOULD embed+upsert ${episodes.length} episodes (existing ${existing.size})`);
      console.log(`    sample [${episodes[0].source_kind} ${episodes[0].source_id}]:`);
      console.log(episodes[0].episode_text.split('\n').map((l) => `      ${l}`).join('\n'));
      continue;
    }

    // ONE batched embed call per client (mirrors lib/episodic/ingest.ts).
    const vectors = await embedBatch(episodes.map((e) => e.episode_text), googleKey);
    const rows = episodes.map((e, i) => ({
      client_id:       client.id,
      owner_user_id:   e.owner_user_id ?? client.owner_user_id,
      source_kind:     e.source_kind,
      source_id:       e.source_id,
      episode_text:    e.episode_text,
      abstracted_text: abstractEpisode(e.episode_text, client.name, client.company ? [client.company] : []),
      outcome:         e.outcome,
      insight_ids:     e.insight_ids,
      metadata:        { ...e.metadata, embedder: GOOGLE_MODEL, dims: EMBEDDING_DIMS, backfill: true },
      embedding:       vectors[i],
    }));
    const upsertRes = await supabase
      .from('episode_embeddings')
      .upsert(rows, { onConflict: 'source_kind,source_id' })
      .select('id');
    if (upsertRes.error) throw new Error(`upsert failed (${client.id}): ${upsertRes.error.message}`);
    totals.upserted += upsertRes.data?.length ?? 0;
    console.log(`- ${label}: upserted ${upsertRes.data?.length ?? 0} episodes`);
  }

  console.log('\ntotals:', JSON.stringify(totals));
  if (!EXECUTE) console.log('dry-run complete — nothing was embedded or written. Re-run with --execute to apply.');
}

main().catch((e) => {
  console.error(`backfill-episodes FAILED: ${e?.message ?? e}`);
  process.exit(1);
});
