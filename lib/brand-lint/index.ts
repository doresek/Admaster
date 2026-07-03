// lib/brand-lint/index.ts
//
// Public surface of C-07 brand-voice lint. Wire-in call-sites (master-studio /
// autopilot generation, batch audits) should import from here only.

export {
  AnthropicRegisterJudge,
  DEFAULT_BRAND_VOICE,
  MockRegisterJudge,
  parseBrandVoice,
  RegisterJudgeError,
  type AddressGender,
  type BrandRegister,
  type BrandVoiceParse,
  type BrandVoiceSpec,
  type EmojiPolicy,
  type HumorPolicy,
  type LintResult,
  type LintViolation,
  type LoadedWordAction,
  type RegisterJudge,
  type RegisterVerdict,
} from './types';

export {
  computeScore,
  countEmoji,
  DEFAULT_LOADED_WORDS,
  DETERMINISTIC_RULES,
  emojiPolicy,
  excerptAround,
  findHebrewWordMatches,
  genderAddressConsistency,
  loadedWords,
  metaPolicySafety,
  tabooWords,
  type LintRule,
  type WordMatch,
} from './rules';

export { lintArtifact, lintBatch, selectBrandVoiceAtom } from './lint';
