import { afterEach, describe, expect, it, vi } from 'vitest';
import { webSearch } from '../../src/tools/web-search.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('webSearch', () => {
  it('returns disabled result when feature flag is off', async () => {
    delete process.env['SHIPYARD_ENABLE_WEB_SEARCH'];
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await webSearch({ query: 'vite exact error' });

    expect(result.success).toBe(false);
    expect(result.disabled).toBe(true);
    expect(result.message).toContain('SHIPYARD_ENABLE_WEB_SEARCH=true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns disabled result when api key is missing', async () => {
    process.env['SHIPYARD_ENABLE_WEB_SEARCH'] = 'true';
    delete process.env['BRAVE_SEARCH_API_KEY'];

    const result = await webSearch({ query: 'tsx exact error' });

    expect(result.success).toBe(false);
    expect(result.disabled).toBe(true);
    expect(result.message).toContain('BRAVE_SEARCH_API_KEY');
  });

  it('calls Brave and normalizes results when enabled', async () => {
    process.env['SHIPYARD_ENABLE_WEB_SEARCH'] = 'true';
    process.env['BRAVE_SEARCH_API_KEY'] = 'test-key';

    const json = vi.fn().mockResolvedValue({
      web: {
        results: [
          {
            title: 'Bun release notes',
            url: 'https://bun.sh/blog',
            description: 'Latest Bun release notes',
            age: '2026-03-27',
            language: 'en',
          },
        ],
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json });
    vi.stubGlobal('fetch', fetchMock);

    const result = await webSearch({ query: 'latest bun release', count: 20, country: 'us' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, { headers: Record<string, string> }];
    expect(url.toString()).toContain('q=latest+bun+release');
    expect(url.toString()).toContain('count=10');
    expect(url.toString()).toContain('country=us');
    expect(init.headers['X-Subscription-Token']).toBe('test-key');
    expect(result.success).toBe(true);
    expect(result.results[0]?.title).toBe('Bun release notes');
  });
});
