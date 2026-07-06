// app/api/retention/enroll/eligibility.ts
//
// Pure audience-eligibility helpers for series enrollment (CP-6b T5).
// Single source of truth used by BOTH the enroll route (server) and the
// series page preview (client), so "ישלח ל-N אנשי קשר" and the actual
// enrollment can never disagree.
//
// Eligibility (doc §5 + migration 052):
//   • consented        — structural in client_contacts (consented_at NOT NULL),
//                        but re-checked here so a malformed row never slips in;
//   • NOT opted out    — the tombstone (opted_out_at) excludes, always;
//   • audience match   — audience_tags '{}' = ALL active contacts, otherwise
//                        any-tag overlap (matches the GIN && semantics of 052).
//
// NOTE: this decides WHO ENROLLS. Whether a given touch may actually SEND is
// the compliance gate's job (lib/retention/gate) at send time — never here.

/** The minimal contact shape eligibility needs (subset of ContactRow). */
export interface AudienceContact {
  tags: string[] | null;
  consented_at: string | null;
  opted_out_at: string | null;
}

/** '{}' audience = everyone; otherwise ANY shared tag qualifies (SQL `&&`). */
export function matchesAudience(contactTags: string[] | null | undefined, audienceTags: string[]): boolean {
  if (audienceTags.length === 0) return true;
  if (!contactTags || contactTags.length === 0) return false;
  return contactTags.some((t) => audienceTags.includes(t));
}

/** Consented AND not tombstoned AND inside the audience. */
export function isEligibleForEnrollment(contact: AudienceContact, audienceTags: string[]): boolean {
  if (contact.opted_out_at) return false;                 // tombstone — never bypassed
  if (!contact.consented_at) return false;                // no consent event, no enrollment
  return matchesAudience(contact.tags, audienceTags);
}

/** The "ישלח ל-N אנשי קשר עם הסכמה" preview number. */
export function countEligible(contacts: AudienceContact[], audienceTags: string[]): number {
  return contacts.filter((c) => isEligibleForEnrollment(c, audienceTags)).length;
}

/** Unique, sorted tag universe across a contact list (audience picker options). */
export function deriveTagSet(contacts: Array<{ tags: string[] | null }>): string[] {
  const set = new Set<string>();
  for (const c of contacts) {
    for (const t of c.tags ?? []) {
      const trimmed = t.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'he'));
}

/** Free-text tags field → clean tag array (splits on , ; | — dedup, trims). */
export function parseTagsInput(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,;|]/)) {
    const t = part.trim();
    if (t) seen.add(t);
  }
  return Array.from(seen);
}
