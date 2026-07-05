// lib/narration — public surface of the deterministic narration engine (D-0).
//
// DASHBOARD-ARCHITECTURE §0.2: deterministic-first narration grounded in the
// metrics layer; LLM polish (if ever) sits ON TOP of this text, never replaces
// it. Consumers: the pulse dashboard (D-1/D-2), portfolio (D-3), alerts.

export { narrate } from './engine';
export { buildClientStory } from './story';
export type {
  AtomCiteFact,
  ClientStory,
  DiagnosisFact,
  ForecastRangeFact,
  NarrationInput,
  NarrationPeriod,
  NarrationRegister,
  NarrationResult,
  PendingActionFact,
  StoryExtras,
} from './types';
