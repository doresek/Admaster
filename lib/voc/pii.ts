// lib/voc/pii.ts
//
// PURE PII stripping for stored quotes (voc-mining §4: "strip person names /
// phones from stored quotes; keep the language pattern, drop the identity").
// Runs BEFORE the text is sent to the LLM and before any quote is stored, so
// no phone/email/URL ever leaves the pipeline.
//
// The regex PRIMITIVES live in lib/pii (shared with lib/episodic's fleet-safe
// abstraction); this module owns the VoC POLICY: which placeholders, which
// order, and the names-list scope. Honest scope note: phones / emails / URLs /
// social handles are stripped robustly by PATTERN (so third-party contact info
// is redacted even when the caller never listed that person — audit PII-2);
// person NAMES are additionally stripped from a caller-supplied list (client
// contact names, owner name). Free-text Hebrew full-name detection is
// deliberately NOT attempted by regex — it is genuinely hard and a bad regex
// silently mangles quotes, which are the product here — so name coverage stays
// the union of (pattern-based contact info) ∪ (the supplied names list).
//
// Idempotent by construction: the replacement placeholders ({phone}, {email},
// {url}, {handle}, {name}) contain no digits, no '@', no scheme, so they can
// never re-match — stripPii(stripPii(x)) === stripPii(x).

import { stripEmails, stripPhones, stripTerm, stripUrls } from '@/lib/pii';

// Bare social/contact handle (@dana_k, @clinic.tlv) — a common third-party
// contact pattern NOT covered by the email primitive (which requires a full
// local-part@domain.tld). Anchored so it never eats the '@' of a real email
// (emails are replaced with {email} BEFORE this runs) and requires a letter
// start so stray '@' punctuation is left alone. Israeli reviews/comments carry
// these to tag people/pages, so they are third-party contact info by policy.
const HANDLE_SOURCE = String.raw`(?<![\w@%+.-])@[A-Za-z][A-Za-z0-9_.]{1,}`;

/** Replace every bare social handle with `placeholder`. Run AFTER emails. */
function stripHandles(text: string, placeholder: string): string {
  return text.replace(new RegExp(HANDLE_SOURCE, 'g'), placeholder);
}

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
 * emails/digits), then emails, then bare handles (left over once real emails
 * are gone), then phones, then supplied names.
 */
export function stripPii(text: string, options: PiiStripOptions = {}): string {
  if (typeof text !== 'string' || !text) return '';

  let out = stripUrls(text, '{url}');
  out = stripEmails(out, '{email}');
  out = stripHandles(out, '{handle}');
  out = stripPhones(out, '{phone}');

  for (const name of options.names ?? []) {
    out = stripTerm(out, name, '{name}');
  }

  return out;
}
