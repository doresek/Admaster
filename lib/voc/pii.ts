// lib/voc/pii.ts
//
// PURE PII stripping for stored quotes (voc-mining §4: "strip person names /
// phones from stored quotes; keep the language pattern, drop the identity").
// Runs BEFORE the text is sent to the LLM and before any quote is stored, so
// no phone/email/URL ever leaves the pipeline.
//
// The regex PRIMITIVES live in lib/pii (shared with lib/episodic's fleet-safe
// abstraction); this module owns the VoC POLICY: which placeholders, which
// order, and the names-list scope. Honest scope note: phones / emails / URLs
// are stripped robustly by pattern; person NAMES are stripped only from a
// caller-supplied list (client contact names, owner name) — free-text Hebrew
// full-name detection is genuinely hard and a bad regex silently mangles
// quotes, which are the product here.
//
// Idempotent by construction: the replacement placeholders ({phone}, {email},
// {url}, {name}) contain no digits, no '@', no scheme, so they can never
// re-match — stripPii(stripPii(x)) === stripPii(x).

import { stripEmails, stripPhones, stripTerm, stripUrls } from '@/lib/pii';

export interface PiiStripOptions {
  /** Exact names to redact (e.g. the client's contact person, the owner). */
  names?: string[];
}

/**
 * Strip PII from text, replacing each hit with a neutral placeholder that
 * preserves the sentence's readability (the copy-ammunition value of a quote
 * survives; the identity doesn't).
 *
 * Order matters (lib/pii doctrine): URLs first (they may contain
 * emails/digits), then emails, then phones, then supplied names.
 */
export function stripPii(text: string, options: PiiStripOptions = {}): string {
  if (typeof text !== 'string' || !text) return '';

  let out = stripPhones(stripEmails(stripUrls(text, '{url}'), '{email}'), '{phone}');

  for (const name of options.names ?? []) {
    out = stripTerm(out, name, '{name}');
  }

  return out;
}
