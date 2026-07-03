// lib/validation/json.ts
//
// The runtime-validation boundary primitives (finding H1). Every value that
// crosses the LLM/DB seam arrives as `unknown` — never as the `T` the type
// system claims. These hand-written, dependency-free helpers turn that raw
// `unknown` into either a verified `T` or a `null` we can degrade on, so a
// malformed LLM/JSONB payload fails HANDLED at the parse seam instead of
// propagating as a mis-typed "valid" object.

/** A structural type guard: narrows an `unknown` to `T` or rejects it. */
export type Guard<T> = (x: unknown) => x is T;

/** True for a non-null, non-array plain object we can index by key. */
export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** True for a non-empty string. */
export function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

/** True for an array whose every element is a string. */
export function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((e) => typeof e === 'string');
}

/**
 * Parse an LLM/DB JSON string and validate it against `guard` in one step.
 * Returns the verified `T` on success, or `null` when the text is not valid
 * JSON OR fails the structural guard. NEVER throws — callers branch on `null`
 * and take a coherent fallback rather than catching an unhandled rejection.
 *
 * When no `guard` is supplied it behaves like a throw-safe `JSON.parse` (still
 * an improvement over `JSON.parse(x) as T`, which hides parse failures), but a
 * guard is strongly preferred on the money path.
 */
export function safeJsonParse<T>(text: string, guard?: Guard<T>): T | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (guard) return guard(parsed) ? parsed : null;
  return parsed as T;
}
