// lib/whatsapp/types.ts
//
// Types for the WhatsApp send layer (L5 in the AI-Marketer master plan).
// Messages are sent through InforU (the Israeli messaging provider also used by
// the sibling "Geula Mode" project) and recorded in `whatsapp_messages`.
//
// A WhatsApp message is INSIGHT-GROUNDED: `groundedIn` carries the
// `client_insights` atom ids that justified the send (the decision engine picks
// WhatsApp for BOFU/retention and hands the grounding through to here).

/** Lifecycle of a `whatsapp_messages` row (mirrors the migration 030 CHECK). */
export type WhatsAppStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

/** How the InforU adapter behaves. Defaults to `mock` (no live HTTP call). */
export type InforUMode = 'mock' | 'live';

/** Minimal input the InforU adapter needs to send one message. */
export interface InforUSendInput {
  toPhone: string;
  body: string;
  /** When set, a pre-approved WhatsApp template is sent instead of free text. */
  templateName?: string | null;
}

/** Result of an InforU send attempt (mock or live). */
export interface InforUSendResult {
  ok: boolean;
  status: WhatsAppStatus;
  /** Provider message id. In mock mode a synthetic `mock-<uuid>`. */
  providerMsgId: string | null;
  /** Which path produced this result. */
  mode: InforUMode;
  error?: string;
  /** Raw provider response (live mode only) for debugging. */
  raw?: unknown;
}

/** Input to {@link sendWhatsApp} — compose + record one message. */
export interface SendWhatsAppInput {
  clientId: string;
  ownerUserId: string;
  toPhone: string;
  body: string;
  templateName?: string | null;
  campaignId?: string | null;
  artifactId?: string | null;
  /** `client_insights` ids that justified this message (the grounding). */
  groundedIn?: string[];
}

/** Shape of a `whatsapp_messages` row we compose for insert. */
export interface WhatsAppMessageRow {
  client_id: string;
  owner_user_id: string;
  campaign_id: string | null;
  artifact_id: string | null;
  to_phone: string;
  body: string;
  template_name: string | null;
  provider: 'inforu';
  provider_msg_id: string | null;
  status: WhatsAppStatus;
  grounded_in: string[];
  error: string | null;
}

/** Result of {@link sendWhatsApp}. */
export interface SendWhatsAppResult {
  /** Whether the provider accepted the send. */
  ok: boolean;
  status: WhatsAppStatus;
  /** DB row id, or null when the row was not persisted. */
  id: string | null;
  providerMsgId: string | null;
  /** False when the `whatsapp_messages` table is absent (migration 030 not applied). */
  persisted: boolean;
  mode: InforUMode;
  error?: string;
}
