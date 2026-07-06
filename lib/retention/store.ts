// lib/retention/store.ts
//
// The Supabase implementation of RetentionStore (migration 052 tables). Thin
// on purpose: every method is one statement; the SEMANTICS (fail-closed touch
// log, defer-vs-advance) live in sender.ts. `insertTouch` THROWS on failure —
// that throw is exactly what aborts a send (doc §4.1).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RetentionChannel, RetentionStore, TouchRow } from './types';

export function createSupabaseRetentionStore(supabase: SupabaseClient): RetentionStore {
  return {
    async insertTouch(row: Omit<TouchRow, 'id'>): Promise<string> {
      const { data, error } = await supabase
        .from('contact_touches')
        .insert(row)
        .select('id')
        .single();
      if (error) throw new Error(`contact_touches insert failed: ${error.message}`);
      const id = (data as { id?: string } | null)?.id;
      if (!id) throw new Error('contact_touches insert returned no id');
      return id;
    },

    async markTouchFailed(touchId: string, error: string): Promise<void> {
      const { error: err } = await supabase
        .from('contact_touches')
        .update({ status: 'failed', rationale: error })
        .eq('id', touchId);
      if (err) throw new Error(`contact_touches fail-mark failed: ${err.message}`);
    },

    async setTouchProviderRef(touchId: string, provider: string, providerRef: string | null): Promise<void> {
      const { error } = await supabase
        .from('contact_touches')
        .update({ provider, provider_ref: providerRef })
        .eq('id', touchId);
      if (error) throw new Error(`contact_touches provider-ref update failed: ${error.message}`);
    },

    async advanceEnrollment(enrollmentId, patch): Promise<void> {
      const { error } = await supabase
        .from('series_enrollments')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', enrollmentId);
      if (error) throw new Error(`series_enrollments advance failed: ${error.message}`);
    },

    async deferEnrollment(enrollmentId: string, notBefore: string): Promise<void> {
      const { error } = await supabase
        .from('series_enrollments')
        .update({ not_before: notBefore, updated_at: new Date().toISOString() })
        .eq('id', enrollmentId);
      if (error) throw new Error(`series_enrollments defer failed: ${error.message}`);
    },

    async stopEnrollment(enrollmentId: string, status: 'stopped' | 'opted_out'): Promise<void> {
      const { error } = await supabase
        .from('series_enrollments')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', enrollmentId);
      if (error) throw new Error(`series_enrollments stop failed: ${error.message}`);
    },

    async completeEnrollment(enrollmentId: string, completedAt: string): Promise<void> {
      const { error } = await supabase
        .from('series_enrollments')
        .update({ status: 'completed', completed_at: completedAt, updated_at: completedAt })
        .eq('id', enrollmentId);
      if (error) throw new Error(`series_enrollments complete failed: ${error.message}`);
    },

    async touchContact(contactId: string, lastContactAt: string): Promise<void> {
      const { error } = await supabase
        .from('client_contacts')
        .update({ last_contact_at: lastContactAt, updated_at: lastContactAt })
        .eq('id', contactId);
      if (error) throw new Error(`client_contacts recency update failed: ${error.message}`);
    },
  };
}

/**
 * Count the client's SENT touches whose sent_at falls on the given IL calendar
 * day (the R8 input). `dayStartUtc`/`dayEndUtc` are computed by the caller via
 * quiet-windows' ilToUtc so the day boundary is Asia/Jerusalem, not UTC.
 */
export async function countClientSentBetween(
  supabase: SupabaseClient,
  clientId: string,
  dayStartUtcISO: string,
  dayEndUtcISO: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('contact_touches')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'sent')
    .gte('sent_at', dayStartUtcISO)
    .lt('sent_at', dayEndUtcISO);
  if (error) throw new Error(`contact_touches client count failed: ${error.message}`);
  return count ?? 0;
}
