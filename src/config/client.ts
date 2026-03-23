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
  if (apiKey && apiKey !== 'dummy' && apiKey !== 'oauth') {
    _client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    _isOAuth = false;
    return _client;
  }

  // Mode 2: explicit OAuth token env var
  if (authToken) {
    _client = new Anthropic({
      authToken,
      defaultHeaders: { 'anthropic-beta': OAUTH_BETA_HEADERS },
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
    });
    _isOAuth = true;
    return _client;
  }

  throw new Error(
    'No Anthropic credentials found. Set ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or log in with Claude Code.',
  );
}

type SystemPrompt = string | Anthropic.TextBlockParam[];

/**
 * Wrap system prompt for OAuth compatibility.
 *
 * OAuth requires the system prompt to be an ARRAY of text blocks where the
 * first block is the exact required prefix. Concatenating into a single
 * string is rejected by the API.
 *
 * For standard API keys, returns the prompt string unchanged.
 */
export function wrapSystemPrompt(prompt: string): SystemPrompt {
  if (!_isOAuth) return prompt;

  return [
    { type: 'text' as const, text: OAUTH_SYSTEM_PREFIX },
    { type: 'text' as const, text: prompt },
  ];
}
