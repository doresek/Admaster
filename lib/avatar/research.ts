/**
 * Web research helper for avatar generation.
 *
 * Tries Brave Search → Tavily → empty.  No keys = silent skip (no throw),
 * because the generator must still work without web research.
 *
 * Returns short factual snippets that ground the avatar in real market
 * context rather than LLM hallucinations.
 */

export interface ResearchSnippet {
  title:   string;
  url:     string;
  snippet: string;
  source:  'brave' | 'tavily';
}

export interface AvatarResearchInput {
  businessName?:    string | null;
  industry?:        string | null;
  productCategory?: string | null;
  region?:          string | null; // 'IL', 'US', …
  language?:        'he' | 'en';
}

const MAX_SNIPPETS = 12;

export async function researchForAvatar(
  input: AvatarResearchInput,
): Promise<ResearchSnippet[]> {
  // No keys at all → skip cleanly.
  if (!process.env.BRAVE_SEARCH_API_KEY && !process.env.TAVILY_API_KEY) {
    return [];
  }

  const queries = buildResearchQueries(input);
  if (!queries.length) return [];

  const lang  = input.language ?? 'he';
  const batch = await Promise.all(
    queries.map((q) =>
      search(q, lang).catch((err) => {
        console.warn('[avatar-research] query failed:', q, err?.message ?? err);
        return [] as ResearchSnippet[];
      }),
    ),
  );

  // Flatten + dedupe by URL.
  const seen: Set<string> = new Set();
  const out:  ResearchSnippet[] = [];
  for (const s of batch.flat()) {
    if (!s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
    if (out.length >= MAX_SNIPPETS) break;
  }
  return out;
}

function buildResearchQueries(input: AvatarResearchInput): string[] {
  const cat = input.productCategory ?? input.industry;
  if (!cat) return [];

  const isHe = (input.language ?? 'he') === 'he';
  const q: string[] = [];

  if (isHe) {
    q.push(`${cat} ביקורות לקוחות`);
    q.push(`${cat} פורום דעות`);
    q.push(`${cat} למה לבחור`);
    if (input.businessName) q.push(`${input.businessName} חוות דעת`);
  } else {
    q.push(`${cat} customer reviews complaints`);
    q.push(`${cat} reddit discussion`);
    q.push(`why choose ${cat}`);
    if (input.businessName) q.push(`${input.businessName} reviews`);
  }

  return q;
}

async function search(query: string, lang: 'he' | 'en'): Promise<ResearchSnippet[]> {
  if (process.env.BRAVE_SEARCH_API_KEY) return searchBrave(query, lang);
  if (process.env.TAVILY_API_KEY)       return searchTavily(query);
  return [];
}

async function searchBrave(query: string, lang: 'he' | 'en'): Promise<ResearchSnippet[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '5');
  if (lang === 'he') {
    url.searchParams.set('country', 'IL');
    url.searchParams.set('search_lang', 'he');
  }

  const res = await fetch(url.toString(), {
    headers: {
      'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY!,
      Accept:                 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);

  const data = await res.json();
  const results: Array<{ title?: string; url?: string; description?: string }> =
    data?.web?.results ?? [];
  return results.map((r) => ({
    title:   r.title       ?? '',
    url:     r.url         ?? '',
    snippet: r.description ?? '',
    source:  'brave' as const,
  }));
}

async function searchTavily(query: string): Promise<ResearchSnippet[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      api_key:      process.env.TAVILY_API_KEY,
      query,
      search_depth: 'basic',
      max_results:  5,
    }),
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);

  const data = await res.json();
  const results: Array<{ title?: string; url?: string; content?: string }> =
    data?.results ?? [];
  return results.map((r) => ({
    title:   r.title   ?? '',
    url:     r.url     ?? '',
    snippet: r.content ?? '',
    source:  'tavily' as const,
  }));
}

export function formatResearchForPrompt(snippets: ResearchSnippet[]): string {
  if (!snippets.length) return '';

  return `\n## Real Market Signals\n\nBelow are real snippets from web research about this market. Use these to ground the avatar in actual customer language and concerns (do not cite URLs in output):\n\n${snippets
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.snippet}`)
    .join('\n\n')}\n`;
}
