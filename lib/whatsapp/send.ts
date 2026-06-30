// lib/whatsapp/send.ts
//
// Compose + record one WhatsApp message:
//   1. send through the InforU adapter (mock by default — no live call)
//   2. compose a `whatsapp_messages` row (carrying `grounded_in`, the insight
//      atoms that justified the send)
//   3. persist it via the service-role (admin) Supabase client
//
// GRACEFUL DEGRADATION: `whatsapp_messages` does not exist in prod yet
// (migration 030 not applied). If the table is absent the send still succeeds
// and we return `persisted: false` instead of throwing.
import { createAdminClient } from '@/lib/supabase/server';
import { sendViaInforU } from './inforu';
import type {
  InforUMode,
  SendWhatsAppInput,
  SendWhatsAppResult,
  WhatsAppMessageRow,
  WhatsAppStatus,
} from './types';

/** Postgres / PostgREST signatures for "table does not exist yet". */
function isMissingTable(message?: string, code?: string): boolean {
  if (code === '42P01' || code === 'PGRST205') return true;
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? '');
}

/**
 * Send a WhatsApp message and record it. The provider send happens first; the
 * resulting status (`sent` | `failed`) and provider id are stamped onto the row
 * along with the grounding before insert.
 */
export async function sendWhatsApp(
  input: SendWhatsAppInput,
  opts: { mode?: InforUMode } = {},
): Promise<SendWhatsAppResult> {
  const groundedIn = input.groundedIn ?? [];

  // ── 1. send via provider (mock by default) ─────────────────────────────────
  const send = await sendViaInforU(
    { toPhone: input.toPhone, body: input.body, templateName: input.templateName ?? null },
    opts,
  );
  const status: WhatsAppStatus = send.status;

  // ── 2. compose the row ──────────────────────────────────────────────────────
  const row: WhatsAppMessageRow = {
    client_id: input.clientId,
    owner_user_id: input.ownerUserId,
    campaign_id: input.campaignId ?? null,
    artifact_id: input.artifactId ?? null,
    to_phone: input.toPhone,
    body: input.body,
    template_name: input.templateName ?? null,
    provider: 'inforu',
    provider_msg_id: send.providerMsgId,
    status,
    grounded_in: groundedIn,
    error: send.error ?? null,
  };

  // ── 3. persist (graceful when the table is absent) ──────────────────────────
  let id: string | null = null;
  let persisted = false;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from('whatsapp_messages').insert(row).select('id').single();
    if (error) {
      if (isMissingTable(error.message, (error as { code?: string }).code)) {
        console.warn('[whatsapp] whatsapp_messages table absent (migration 030 not applied) — not persisted');
      } else {
        // A real DB error: surface it but keep the provider outcome.
        return { ok: send.ok, status, id: null, providerMsgId: send.providerMsgId, persisted: false, mode: send.mode, error: error.message };
      }
    } else {
      id = (data as { id?: string } | null)?.id ?? null;
      persisted = true;
    }
  } catch (e) {
    console.warn('[whatsapp] persist failed:', e instanceof Error ? e.message : e);
  }

  return { ok: send.ok, status, id, providerMsgId: send.providerMsgId, persisted, mode: send.mode, error: send.error };
}
