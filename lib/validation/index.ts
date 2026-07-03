// lib/validation/index.ts
//
// The runtime-validation boundary (finding H1). Hand-written, dependency-free
// type guards and safe parsers for the shapes that cross the LLM/DB seam. The
// type system asserts these shapes; this module is where the runtime actually
// verifies them so a malformed payload fails handled at the seam.

export { safeJsonParse, isRecord, isNonEmptyString, isStringArray } from './json';
export type { Guard } from './json';
export { isStrategyAnalysis, parseStrategyAnalysis } from './strategy';
