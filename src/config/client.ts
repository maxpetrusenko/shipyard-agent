/**
 * Shared Anthropic client factory.
 *
 * Supports three auth modes (checked in order):
 * 1. ANTHROPIC_API_KEY  – standard API key
 * 2. ANTHROPIC_AUTH_TOKEN – OAuth bearer token (e.g. from Claude Code Max plan)
 * 3. macOS Keychain – extracts Claude Code OAuth token automatically
 *
 * When using OAuth, the required beta header and system prompt prefix are
 * added automatically. The system prompt MUST be an array of text blocks
 * (not a single string) for OAuth — Anthropic rejects concatenated strings.
 */

import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'node:child_process';

/** Required system prompt prefix for OAuth-authenticated requests. */
const OAUTH_SYSTEM_PREFIX =
  "You are Claude Code, Anthropic's official CLI for Claude.";

const OAUTH_BETA_HEADERS = 'oauth-2025-04-20,claude-code-20250219';

let _client: Anthropic | null = null;
let _isOAuth = false;

function extractKeychainToken(): string | null {
  try {
    const raw = execSync(
      "security find-generic-password -s 'Claude Code-credentials' -w",
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    const parsed = JSON.parse(raw) as {
      claudeAiOauth?: { accessToken?: string };
    };
    return parsed.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

export function isOAuthMode(): boolean {
  return _isOAuth;
}

export function getClient(): Anthropic {
  if (_client) return _client;

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const authToken = process.env['ANTHROPIC_AUTH_TOKEN'];
  const baseURL = process.env['ANTHROPIC_BASE_URL'];

  // Mode 1: standard API key (non-dummy, non-placeholder)
  const retryOpts = {
    maxRetries: 8,
    timeout: 600_000,
  } as const;

  if (apiKey && apiKey !== 'dummy' && apiKey !== 'oauth') {
    _client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...retryOpts,
    });
    _isOAuth = false;
    return _client;
  }

  // Mode 2: explicit OAuth token env var
  if (authToken) {
    _client = new Anthropic({
      authToken,
      defaultHeaders: { 'anthropic-beta': OAUTH_BETA_HEADERS },
      ...retryOpts,
    });
    _isOAuth = true;
    return _client;
  }

  // Mode 3: extract from macOS Keychain
  const keychainToken = extractKeychainToken();
  if (keychainToken) {
    _client = new Anthropic({
      authToken: keychainToken,
      defaultHeaders: { 'anthropic-beta': OAUTH_BETA_HEADERS },
      ...retryOpts,
    });
    _isOAuth = true;
    return _client;
  }

  throw new Error(
    'No Anthropic credentials found. Set ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or log in with Claude Code.',
  );
}

// ---------------------------------------------------------------------------
// Prompt caching helpers
// ---------------------------------------------------------------------------

/** Reusable cache-control marker for Anthropic's prompt caching. */
export const CACHE_CONTROL: Anthropic.CacheControlEphemeral = {
  type: 'ephemeral',
};

/**
 * Wrap system prompt as TextBlockParam[] with layered cache breakpoints.
 *
 * When `dynamicContext` is provided, the static prompt and dynamic context
 * get SEPARATE cache breakpoints. This means:
 * - Static prompt (PLAN_SYSTEM, EXECUTE_SYSTEM, etc.) is cached across ALL
 *   runs of the same node type, even when context changes.
 * - Dynamic context (repo map, injected contexts) is cached independently
 *   and invalidates on its own schedule (~5min repo map TTL).
 *
 * Without context, uses a single breakpoint on the static prompt.
 *
 * For OAuth: prepends the required system prefix as a separate block.
 */
export function wrapSystemPrompt(
  prompt: string,
  dynamicContext?: string,
): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [];

  if (_isOAuth) {
    blocks.push({ type: 'text' as const, text: OAUTH_SYSTEM_PREFIX });
  }

  if (dynamicContext) {
    // Two breakpoints: static prompt cached independently from context
    blocks.push({
      type: 'text' as const,
      text: prompt,
      cache_control: CACHE_CONTROL,
    });
    blocks.push({
      type: 'text' as const,
      text: dynamicContext,
      cache_control: CACHE_CONTROL,
    });
  } else {
    blocks.push({
      type: 'text' as const,
      text: prompt,
      cache_control: CACHE_CONTROL,
    });
  }

  return blocks;
}

/**
 * Clone a tools array with `cache_control` on the last tool definition.
 *
 * This creates a cache breakpoint after the tool schemas so the entire
 * system prompt + tools prefix is cached across agentic loop iterations.
 */
export function withCachedTools(
  tools: Anthropic.Tool[],
): Anthropic.Tool[] {
  if (tools.length === 0) return tools;
  return tools.map((t, i) =>
    i === tools.length - 1 ? { ...t, cache_control: CACHE_CONTROL } : t,
  );
}
