// lib/voc — C-08 voice-of-customer ingestion (MARKETING-CAPABILITIES-SPEC C-08).
// Public surface: the ingest pipeline, the quote-bank reads, the extraction
// seam (for wire-ins that bring their own LLM), and the internal types.

export * from './types';
export { stripPii, type PiiStripOptions } from './pii';
export {
  buildExtractionPrompt,
  createAnthropicLlm,
  extractQuotes,
  parseExtraction,
  summarizeAtoms,
  VOC_EXTRACTION_PROMPT_HEADER,
  type LlmComplete,
} from './extract';
export { reconcileQuotes, type ReconcileQuotesInput } from './reconcile';
export { hashRawText, ingestDocument } from './ingest';
export { formatQuotesForPrompt, getQuoteBank, type QuoteBankFilters } from './quote-bank';
