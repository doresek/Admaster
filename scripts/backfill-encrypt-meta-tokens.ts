// backfill-encrypt-meta-tokens.ts — one-off migration of plaintext Meta tokens.
//
// Why: migration 003 added meta_clients.token_encrypted and kept the legacy
// plaintext `token` column for rows connected before encryption rolled out.
// The connect path is insert-only and reads are strictly read-only, so legacy
// rows never get re-encrypted on their own. This script migrates them.
//
// What it does: loads every meta_clients row, and for any token NOT already in
// encrypted format, encrypts it with ENCRYPTION_KEY and writes token_encrypted.
// Idempotent — rows whose token_encrypted is already a valid ciphertext are
// skipped, so it is safe to run repeatedly. Reports how many rows it migrated.
//
// Run deliberately against prod (see exact command at the bottom of the PR /
// commit notes). Requires .env.local with NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, and ENCRYPTION_KEY.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { encrypt, isEncrypted } from '../lib/crypto';

export type MetaClientTokenRow = {
  id: string;
  token: string | null;
  token_encrypted: string | null;
};

// Pure, idempotent decision: given a row, return the value to write into
// token_encrypted, or null to skip (already encrypted, or nothing to migrate).
export function planTokenEncryption(row: MetaClientTokenRow): string | null {
  // Already migrated: token_encrypted holds a valid ciphertext.
  if (row.token_encrypted && isEncrypted(row.token_encrypted)) return null;

  // Otherwise find the plaintext to encrypt: a token_encrypted that somehow
  // holds plaintext, else the legacy plaintext token column.
  const plaintext =
    (row.token_encrypted && !isEncrypted(row.token_encrypted) ? row.token_encrypted : null) ??
    row.token;

  if (!plaintext) return null; // no token at all — nothing to migrate
  return encrypt(plaintext);
}

export type MigrationTally = {
  migrated: number;
  skipped: number;
  failed: number;
  total: number;
};

// Writes an encrypted token for a row; returns a Supabase-shaped result so a
// failed update increments `failed` rather than throwing. Injected so the tally
// is pure/testable independently of the DB.
export type WriteEncrypted = (
  id: string,
  tokenEncrypted: string,
) => Promise<{ error: { message: string } | null }>;

// Pure, deterministic-given-inputs tally of the migration over a batch. Rows
// needing encryption are written via `writeEncrypted`; already-encrypted/empty
// rows are skipped; write errors count as failures. The returned `migrated`
// count is our read of how many tokens were sitting in plaintext at rest, so it
// is unit-tested directly.
export async function tallyMigration(
  rows: MetaClientTokenRow[],
  writeEncrypted: WriteEncrypted,
): Promise<MigrationTally> {
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const next = planTokenEncryption(row);
    if (next === null) {
      skipped++;
      continue;
    }
    const { error } = await writeEncrypted(row.id, next);
    if (error) failed++;
    else migrated++;
  }
  return { migrated, skipped, failed, total: rows.length };
}

// ── DB runner ────────────────────────────────────────────────────────────────

function loadEnvLocal(): void {
  let envText: string;
  try {
    envText = readFileSync('.env.local', 'utf-8');
  } catch {
    return; // env may already be present in the process
  }
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function run(): Promise<void> {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error('Missing ENCRYPTION_KEY (must match the app)');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rows, error } = await admin
    .from('meta_clients')
    .select('id, token, token_encrypted');
  if (error) {
    console.error('Failed to load meta_clients:', error.message);
    process.exit(1);
  }

  const writeEncrypted: WriteEncrypted = async (id, tokenEncrypted) => {
    const { error: updErr } = await admin
      .from('meta_clients')
      .update({ token_encrypted: tokenEncrypted })
      .eq('id', id);
    if (updErr) console.error(`  ✗ ${id}: ${updErr.message}`);
    else console.log(`  ✓ ${id} migrated`);
    return { error: updErr ? { message: updErr.message } : null };
  };

  const tally = await tallyMigration((rows ?? []) as MetaClientTokenRow[], writeEncrypted);

  console.log(
    `\nDone. migrated=${tally.migrated} skipped(already-encrypted/empty)=${tally.skipped} failed=${tally.failed} total=${tally.total}`,
  );
  if (tally.failed > 0) process.exit(1);
}

// Only run when executed directly (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
