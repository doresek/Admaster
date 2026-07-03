// lib/pii — shared PII-stripping PRIMITIVES.
//
// Extracted from lib/voc/pii.ts and lib/episodic/compose.ts, which had grown
// byte-identical regexes under the parallel-build collision doctrine (no
// cross-imports between capability folders). The PRIMITIVES live here; the
// POLICIES stay with their owners — voc strips to {name}/{phone}/… placeholders
// at storage time, episodic abstracts to {business}/{term} with a
// residual-length gate for fleet safety. Both consume these building blocks.
//
// Design notes:
//  • Strip order matters and is the CALLER's job: URLs first (they may contain
//    emails/digits), then emails, then phones — documented at each call site.
//  • The phone pattern is Israeli-anchored (+972 / leading 0) plus generic
//    international (+CC…), with digit-run guards on both sides so metric
//    values, prices, and ISO dates are never falsely redacted.
//  • Functions take and return strings; no shared mutable RegExp state leaks
//    across modules (each helper builds/uses its regex per call via replace).

/** Escape a literal for use inside a RegExp. */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const URL_SOURCE   = String.raw`\bhttps?:\/\/[^\s)>\]]+|\bwww\.[^\s)>\]]+`;
const EMAIL_SOURCE = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`;
const PHONE_SOURCE =
  String.raw`(?<!\d)(?:\+972(?:[-\s.]?\d){8,9}|0(?:[-\s.]?\d){8,9}|\+\d(?:[-\s.]?\d){8,14})(?!\d)`;

/** Replace every URL with `placeholder`. Run BEFORE emails/phones. */
export function stripUrls(text: string, placeholder: string): string {
  return text.replace(new RegExp(URL_SOURCE, 'gi'), placeholder);
}

/** Replace every email with `placeholder`. Run AFTER URLs. */
export function stripEmails(text: string, placeholder: string): string {
  return text.replace(new RegExp(EMAIL_SOURCE, 'g'), placeholder);
}

/** Replace every phone number (IL-anchored + international) with `placeholder`. */
export function stripPhones(text: string, placeholder: string): string {
  return text.replace(new RegExp(PHONE_SOURCE, 'g'), placeholder);
}

/**
 * Build a whitespace-run and Hebrew-quote tolerant matcher for a name/term:
 * tokens may be separated by any whitespace run, and gershayim variants
 * (" ״ ”) match each other — so `ד"ר כהן` matches `ד״ר  כהן`. Case-insensitive
 * and Unicode-aware. Returns null for a blank term.
 */
export function hebrewTermToRegex(term: string): RegExp | null {
  const tokens = term.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const pattern = tokens
    .map((token) => escapeRegExp(token).replace(/["״”]/g, '["״”]'))
    .join(String.raw`\s+`);
  return new RegExp(pattern, 'giu');
}

/** Replace every occurrence of `term` (per hebrewTermToRegex) with `placeholder`. */
export function stripTerm(text: string, term: string, placeholder: string): string {
  const re = hebrewTermToRegex(term);
  return re ? text.replace(re, placeholder) : text;
}
