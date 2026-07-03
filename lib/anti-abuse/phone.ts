// lib/anti-abuse/phone.ts
//
// Minimal, dependency-free phone normalization for the Israeli market (the
// signup audience). Normalizes to E.164-ish so "050-123 4567", "0501234567"
// and "+972501234567" all collapse to ONE canonical string — otherwise the
// one-phone-one-account unique index is trivially bypassed by formatting.

/** Strip everything but digits and a single leading '+'. */
function stripNonDigits(raw: string): string {
  const plus = raw.trim().startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  return plus ? `+${digits}` : digits;
}

/**
 * Normalize a phone to canonical E.164 for IL numbers; pass through other
 * already-plus-prefixed numbers. Returns null when the input can't be a valid
 * phone (too short / non-numeric), so callers reject rather than store junk.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = stripNonDigits(raw);

  if (s.startsWith('+')) {
    const rest = s.slice(1);
    if (rest.length < 8 || rest.length > 15) return null;
    return `+${rest}`;
  }

  // Israeli local formats: 0XXXXXXXXX (10 digits) or 972XXXXXXXXX.
  if (s.startsWith('972')) s = `0${s.slice(3)}`;
  if (s.startsWith('0')) {
    if (s.length < 9 || s.length > 10) return null;
    return `+972${s.slice(1)}`;
  }

  // Bare national number without leading 0 — ambiguous; require a leading 0/+.
  return null;
}

/** True when `raw` normalizes to a valid phone. */
export function isValidPhone(raw: string | null | undefined): boolean {
  return normalizePhone(raw) !== null;
}
