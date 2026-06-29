// Pure billing helpers (no I/O) — unit-testable.

/** New credit balance after a top-up purchase: current + purchased. */
export function creditAfterTopup(current: number, purchased: number): number {
  const base = Number.isFinite(current) ? current : 0;
  const add = Number.isFinite(purchased) ? purchased : 0;
  return base + add;
}

/** Parse a Stripe metadata credits string into a safe positive integer (0 if invalid). */
export function parseTopupCredits(raw: string | undefined | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** True when Stripe returned at least one customer for the given email. */
export function hasActiveCustomer(customers: { data: unknown[] } | null | undefined): boolean {
  return !!customers && Array.isArray(customers.data) && customers.data.length > 0;
}
