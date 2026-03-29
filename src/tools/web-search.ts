/**
 * Guarded web search tool.
 *
 * Disabled by default. Enable with:
 *   SHIPYARD_ENABLE_WEB_SEARCH=true
 *   BRAVE_SEARCH_API_KEY=...
 */

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;

export interface WebSearchParams {
  query: string;
  count?: number;
  country?: string;
  search_lang?: string;
  freshness?: string;
}

export interface WebSearchItem {
  title: string;
  url: string;
  description: string;
  age?: string;
  language?: string;
}

export interface WebSearchResult {
  success: boolean;
  provider: 'brave';
  query: string;
  results: WebSearchItem[];
  disabled?: boolean;
  status_code?: number;
  message?: string;
}

function isEnabled(): boolean {
  return process.env['SHIPYARD_ENABLE_WEB_SEARCH'] === 'true';
}

function clampCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_COUNT;
  return Math.max(1, Math.min(MAX_COUNT, Math.floor(value ?? DEFAULT_COUNT)));
}

function readApiKey(): string {
  return process.env['BRAVE_SEARCH_API_KEY']?.trim() ?? '';
}

function disabledResult(query: string, message: string): WebSearchResult {
  return {
    success: false,
    provider: 'brave',
    query,
    results: [],
    disabled: true,
    message,
  };
}

function summarizeBody(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 280 ? `${normalized.slice(0, 280)}...` : normalized;
}

export async function webSearch(params: WebSearchParams): Promise<WebSearchResult> {
  const query = params.query.trim();
  if (!query) {
    return {
      success: false,
      provider: 'brave',
      query,
      results: [],
      message: 'query is required',
    };
  }

  if (!isEnabled()) {
    return disabledResult(
      query,
      'web_search disabled. Set SHIPYARD_ENABLE_WEB_SEARCH=true to enable outbound search.',
    );
  }

  const apiKey = readApiKey();
  if (!apiKey) {
    return disabledResult(
      query,
      'web_search enabled but BRAVE_SEARCH_API_KEY is missing.',
    );
  }

  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(clampCount(params.count)));
  if (params.country?.trim()) url.searchParams.set('country', params.country.trim());
  if (params.search_lang?.trim()) url.searchParams.set('search_lang', params.search_lang.trim());
  if (params.freshness?.trim()) url.searchParams.set('freshness', params.freshness.trim());

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
      const body = summarizeBody(await response.text());
      return {
        success: false,
        provider: 'brave',
        query,
        results: [],
        status_code: response.status,
        message: body
          ? `Brave search failed (${response.status}): ${body}`
          : `Brave search failed with status ${response.status}.`,
      };
    }

    const payload = await response.json() as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
          age?: string;
          language?: string;
        }>;
      };
    };

    const results = (payload.web?.results ?? [])
      .filter((item) => item.url && item.title)
      .map((item) => ({
        title: item.title ?? item.url ?? 'Untitled',
        url: item.url ?? '',
        description: item.description ?? '',
        age: item.age,
        language: item.language,
      }));

    return {
      success: true,
      provider: 'brave',
      query,
      results,
      message: results.length === 0 ? 'No search results found.' : undefined,
    };
  } catch (error) {
    return {
      success: false,
      provider: 'brave',
      query,
      results: [],
      message: error instanceof Error ? error.message : 'Unknown web search error',
    };
  }
}
