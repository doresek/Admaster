// lib/articles — P3 content engine. P3-2 surface: the deterministic topic
// engine (ORGANIC-DEEP-RESEARCH §1.1) + the idea-backlog store. P3-3 surface:
// the article generator (generate.ts) + the deterministic §3.1 GEO gate
// (geo-rules.ts). P3-4 surface: the video-script generator (video-script.ts).

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
export {
  countFacts,
  countWords,
  extractH2s,
  extractOpening,
  HEBREW_QUESTION_WORDS,
  isQuestionH2,
  MIN_INFO_GAIN_FACTS,
  OPENING_MAX_WORDS,
  OPENING_MIN_WORDS,
  runGeoGate,
  stripFactTags,
  type GateFailure,
  type GateInput,
  type GateResult,
  type GateRule,
} from './geo-rules';
export {
  assembleBody,
  buildFactsBlock,
  generateArticle,
  parseOutline,
  type ArticleRowForGenerate,
  type GenerateArticleInput,
  type GenerateArticleResult,
} from './generate';
export {
  checkVideoScript,
  estimateSeconds,
  formatVideoScriptMd,
  generateVideoScript,
  parseVideoScript,
  saveVideoScript,
  VIDEO_MAX_SECONDS,
  VIDEO_MIN_SECONDS,
  WORDS_PER_SECOND,
  type GenerateVideoScriptInput,
  type GenerateVideoScriptResult,
  type SaveVideoScriptInput,
  type SaveVideoScriptResult,
  type VideoScriptCheck,
} from './video-script';
