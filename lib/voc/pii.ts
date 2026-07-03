// lib/voc/pii.ts
//
// PURE PII stripping for stored quotes (voc-mining §4: "strip person names /
// phones from stored quotes; keep the language pattern, drop the identity").
// Runs BEFORE the text is sent to the LLM and before any quote is stored, so
// no phone/email/URL ever leaves the pipeline.
//
// Honest scope note: phones / emails / URLs are stripped robustly by pattern;
// person NAMES are stripped only from a caller-supplied list (client contact
// names, owner name) — free-text Hebrew full-name detection is genuinely hard
// and a bad regex silently mangles quotes, which are the product here. The
// name matching is whitespace-run + gershayim tolerant, the same craft as
// lib/episodic/compose abstractEpisode but implemented locally: capability
// folders do not cross-import (collision doctrine). ORCHESTRATOR NOTE: this
// duplication (URL/EMAIL/PHONE regexes + term matching, here and in
// lib/episodic) is a candidate for a shared lib/pii util.
//
// Idempotent by construction: the replacement placeholders ({phone}, {email},
// {url}, {name}) contain no digits, no '@', no scheme, so they can never
// re-match — stripPii(stripPii(x)) === stripPii(x).

export interface PiiStripOptions {
  /** Exact names to redact (e.g. the client's contact person, the owner). */
  names?: string[];
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Turn a supplied name into a whitespace-run + gershayim-tolerant regex:
 * tokens match across any whitespace run, and Hebrew quote marks inside a
 * token (ד"ר) match any of " ״ ” — reviewers spell titles inconsistently.
 */
function nameToRegex(name: string): RegExp {
  const pattern = name
    .trim()
    .split(/\s+/)
    .map((token) => escapeRegExp(token).replace(/["״”]/g, '["״”]'))
    .join('\\s+');
  return new RegExp(pattern, 'giu');
}

// Order matters: URLs first (they may contain emails/digits), then emails,
// then phones. The phone pattern is Israeli-anchored (+972 / leading 0) plus
// generic international (+CC…), with (?<!\d)/(?!\d) digit-run guards and a
// separator class limited to [-\s.] so metric values ("12,000 ₪"), times
// ("05:30") and dates ("15.3.2024", "2026-06-05") are NOT falsely redacted.
const URL_RE   = /\bhttps?:\/\/[^\s)>\]]+|\bwww\.[^\s)>\]]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<!\d)(?:\+972(?:[-\s.]?\d){8,9}|0(?:[-\s.]?\d){8,9}|\+\d(?:[-\s.]?\d){8,14})(?!\d)/g;

/**
 * Strip PII from text, replacing each hit with a neutral placeholder that
 * preserves the sentence's readability (the copy-ammunition value of a quote
 * survives; the identity doesn't).
 */
export function stripPii(text: string, options: PiiStripOptions = {}): string {
  if (typeof text !== 'string' || !text) return '';

  let out = text
    .replace(URL_RE, '{url}')
    .replace(EMAIL_RE, '{email}')
    .replace(PHONE_RE, '{phone}');

  for (const name of options.names ?? []) {
    if (name.trim()) out = out.replace(nameToRegex(name), '{name}');
  }

  return out;
}
