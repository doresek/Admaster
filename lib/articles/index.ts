// lib/articles — P3 content engine. P3-2 surface: the deterministic topic
// engine (ORGANIC-DEEP-RESEARCH §1.1) + the idea-backlog store.
// (generate.ts — the article generator — is P3-3 and lives elsewhere in scope.)

export * from './types';
export {
  ATOM_QUERY_MAP,
  VOC_BOOST,
  HEBREW_PREFIXES,
  buildTopicBacklog,
  depersonalizeHe,
  deriveVocQuestions,
  expandHebrewTerm,
} from './topics';
export { saveTopicsAsIdeas, topicSlug, type SaveTopicsAsIdeasInput } from './store';
