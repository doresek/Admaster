// lib/anti-abuse/fingerprint.ts
//
// Hand-rolled, DEPENDENCY-FREE device fingerprint. No external library
// (FingerprintJS et al.) is used. The raw signals are collected client-side
// (see collectClientSignals below, which runs in the browser) and the STABLE
// HASH is what we persist — never the raw signals.
//
// This is a WEAK signal by design: fingerprints are spoofable and shared across
// users behind the same device model. It is one of four signals, used to FLAG
// clustering, not to hard-block.

import { createHash } from 'crypto';

import type { FingerprintSignals } from './types';

/**
 * Canonicalize signals into a single stable string. Order is fixed and each
 * field is trimmed + lowercased so trivial variance does not change the hash.
 * Missing fields collapse to empty so a partial payload still hashes stably.
 */
export function canonicalizeSignals(signals: FingerprintSignals): string {
  const norm = (v: string | null | undefined) => (v ?? '').toString().trim().toLowerCase();
  return [
    norm(signals.userAgent),
    norm(signals.acceptLanguage),
    norm(signals.timezone),
    norm(signals.screen),
    norm(signals.canvas),
    norm(signals.extra),
  ].join('|');
}

/**
 * Hash a device fingerprint to a stable sha256 hex string. Accepts either the
 * structured signals or a pre-canonicalized raw string (the client may send a
 * single string). Returns null for an empty/degenerate payload so we don't
 * store a hash of "nothing" (which would falsely cluster every empty client).
 */
export function hashFingerprint(input: FingerprintSignals | string | null | undefined): string | null {
  const raw = typeof input === 'string' ? input.trim() : canonicalizeSignals(input ?? {});
  // All-empty canonical form is just the field separators — treat as no signal.
  if (!raw || /^\|*$/.test(raw)) return null;
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Browser-side collector. DEPENDENCY-FREE. Returns a canonical signal string
 * suitable for POSTing to /api/signup/send-otp. Safe to call only in the
 * browser (guards `typeof window`); returns '' server-side.
 *
 * The "canvas-ish" signal is a tiny hand-rolled canvas render hashed to a short
 * string — enough to vary across GPU/font stacks without pulling a library.
 */
export function collectClientSignals(): string {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return '';

  const nav = navigator as Navigator & { hardwareConcurrency?: number };
  let timezone = '';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* older engines */
  }

  const screenStr =
    typeof screen !== 'undefined'
      ? `${screen.width}x${screen.height}x${(screen as Screen & { colorDepth?: number }).colorDepth ?? ''}`
      : '';

  let canvas = '';
  try {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 100, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('admaster-fp', 2, 2);
      const data = c.toDataURL();
      // Fold the data URL into a short numeric signal (no crypto in browser dep).
      let h = 0;
      for (let i = 0; i < data.length; i++) {
        h = (h * 31 + data.charCodeAt(i)) | 0;
      }
      canvas = String(h >>> 0);
    }
  } catch {
    /* canvas blocked (privacy mode) — degrade gracefully */
  }

  const extra = [nav.hardwareConcurrency ?? '', (nav as Navigator & { platform?: string }).platform ?? ''].join(',');

  return canonicalizeSignals({
    userAgent: nav.userAgent,
    acceptLanguage: nav.language,
    timezone,
    screen: screenStr,
    canvas,
    extra,
  });
}
