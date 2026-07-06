// lib/retention/types.ts
//
// Row + verdict types for the retention engine (CP-6b, RETENTION-ENGINE-DESIGN.md).
// Mirrors migration 052 (applied): client_contacts, contact_touches,
// series_enrollments, and the additive message_series/series_messages columns.
// Everything here is a plain shape — no I/O, no dates constructed.

/** Channels a retention touch can travel on (mirrors 052 CHECKs). */
export type RetentionChannel = 'email' | 'sms' | 'whatsapp';

/** Fixed rotation order for R5 (deterministic, doc §3.3). */
export const CHANNEL_ROTATION: readonly RetentionChannel[] = ['whatsapp', 'email', 'sms'];

/** contact_touches.status (052 CHECK). */
export type TouchStatus = 'sent' | 'failed' | 'refused';

/** contact_touches.refusal_code (052 CHECK) — the ONLY legal refusal codes. */
export type RefusalCode =
  | 'opted_out'
  | 'no_consent'
  | 'channel_pref'
  | 'missing_address'
  | 'shabbat'
  | 'holiday'
  | 'quiet_hours'
  | 'daily_cap'
  | 'weekly_cap'
  | 'monthly_cap'
  | 'min_gap'
  | 'promo_duplicate'
  | 'autonomy_blocked'
  | 'dry_run_hold';

/** client_contacts.consent_source (052 CHECK). */
export type ConsentSource = 'landing_page' | 'checkout' | 'manual' | 'import' | 'api';

export const CONSENT_SOURCES: readonly ConsentSource[] = [
  'landing_page', 'checkout', 'manual', 'import', 'api',
];

/** A `client_contacts` row (the fields the engine reads). */
export interface ContactRow {
  id: string;
  client_id: string;
  owner_user_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  tags: string[];
  consent_source: ConsentSource;
  consented_at: string;                 // timestamptz ISO
  consent_evidence: string | null;
  opted_out_at: string | null;          // the tombstone — never deleted
  opt_out_channel: string | null;
  opt_out_reason: string | null;
  opt_out_token: string;
  /** Explicit `false` = never use that channel for this contact. */
  channel_prefs: Record<string, boolean | undefined>;
  last_purchase_at: string | null;
  last_contact_at: string | null;
}

/** A `contact_touches` row (the frequency-cap substrate). */
export interface TouchRow {
  id?: string;
  contact_id: string;
  client_id: string;
  owner_user_id: string;
  series_id: string | null;
  series_message_id: string | null;
  channel: RetentionChannel;
  status: TouchStatus;
  refusal_code: RefusalCode | null;
  promo_key: string | null;
  provider: string | null;
  provider_ref: string | null;
  grounded_in: string[];
  rationale: string | null;
  sent_at: string;                      // timestamptz ISO
}

/** A `series_enrollments` row (the engine's per-contact cursor). */
export interface EnrollmentRow {
  id: string;
  series_id: string;
  contact_id: string;
  client_id: string;
  owner_user_id: string;
  status: 'active' | 'completed' | 'stopped' | 'opted_out';
  enrolled_at: string;
  next_position: number;
  not_before: string | null;            // deferral marker (R7: caps push, never skip)
  last_touch_at: string | null;
  last_channel: RetentionChannel | null;
}

/** A `series_messages` step (with the 052 additive columns). */
export interface SeriesStepRow {
  id: string;
  series_id: string;
  day_offset: number;
  channel: RetentionChannel;
  subject: string | null;
  body: string;
  position: number;
  promo_key: string | null;             // same offer across steps/channels = same key (R4)
  grounded_in: string[];
}

/** A `message_series` row (the fields the sender reads). */
export interface SeriesRow {
  id: string;
  client_id: string;
  owner_user_id: string;                // message_series.user_id in the schema
  status: 'draft' | 'active' | 'paused' | 'done';
  grounded_in: string[];
  rationale: string | null;
}

/** One invariant's verdict. `deferUntil` present ⇔ the block DEFERS (R7). */
export type InvariantVerdict =
  | { ok: true }
  | { ok: false; code: RefusalCode; reason: string; deferUntil?: Date };

/** The gate's verdict — the single chokepoint output (doc §4.1). */
export type GateVerdict =
  | { allowed: true }
  | { allowed: false; code: RefusalCode; reason: string; deferUntil?: Date };

/** What the gate judges: one planned touch for one contact NOW. */
export interface GateCandidate {
  channel: RetentionChannel;
  promoKey: string | null;
  seriesId?: string | null;
  seriesMessageId?: string | null;
  /** enrollment.last_channel — the R5 rotation input. */
  lastChannel?: RetentionChannel | null;
}

/**
 * The write seam the sender uses — implemented over Supabase in store.ts and
 * as an in-memory fixture in tests. The touch INSERT is fail-closed: if it
 * throws, the send is ABORTED (doc §4.1, the inverse of route-and-log).
 */
export interface RetentionStore {
  /** Insert one contact_touches row; MUST return the new row id. */
  insertTouch(row: Omit<TouchRow, 'id'>): Promise<string>;
  /** Flip a touch to 'failed' after a provider error (best effort). */
  markTouchFailed(touchId: string, error: string): Promise<void>;
  /** Stamp provider linkage on a sent touch (best effort). */
  setTouchProviderRef(touchId: string, provider: string, providerRef: string | null): Promise<void>;
  /** Advance the enrollment cursor after a sent touch. */
  advanceEnrollment(enrollmentId: string, patch: {
    next_position: number;
    last_touch_at: string | null;
    last_channel: RetentionChannel | null;
    not_before: null;
  }): Promise<void>;
  /** Defer the enrollment (R7): not_before moves, next_position does NOT. */
  deferEnrollment(enrollmentId: string, notBefore: string): Promise<void>;
  /** Stop the enrollment (opt-out tombstone hit / consent lost). */
  stopEnrollment(enrollmentId: string, status: 'stopped' | 'opted_out'): Promise<void>;
  /** Mark the enrollment completed (cursor ran past the last step). */
  completeEnrollment(enrollmentId: string, completedAt: string): Promise<void>;
  /** Denormalized recency on the contact (doc §2: sender maintains). */
  touchContact(contactId: string, lastContactAt: string): Promise<void>;
}

/** Result of a channel adapter send (email/sms seam; providers are gated). */
export interface AdapterSendResult {
  ok: boolean;
  mode: 'mock' | 'live';
  providerRef: string | null;
  error?: string;
}

/** The email/sms adapter seam (doc T7/T8 — mock until providers are chosen). */
export interface ChannelAdapter {
  channel: RetentionChannel;
  provider: string;
  send(input: {
    to: string;
    subject: string | null;
    body: string;
  }): Promise<AdapterSendResult>;
}
