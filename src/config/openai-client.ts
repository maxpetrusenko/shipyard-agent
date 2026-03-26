/**
 * OpenAI client for execute-node when a gpt-* model override is selected.
 *
 * Env: OPENAI_API_KEY (required for OpenAI models). Optional: OPENAI_PROJECT_ID
 * or OPENAI_PROJECT, OPENAI_ORGANIZATION or OPENAI_ORG_ID, OPENAI_BASE_URL.
 */
import OpenAI from 'openai';
import { wrapOpenAI } from 'langsmith/wrappers/openai';
import { ensureEnvLoaded } from './bootstrap-env.js';

let _client: OpenAI | null = null;

export function resetOpenAIClient(): void {
  _client = null;
}

export function getOpenAIClient(): OpenAI {
  ensureEnvLoaded();
  if (_client) return _client;

  const apiKey = process.env['OPENAI_API_KEY']?.trim();
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required when using an OpenAI model (e.g. gpt-5.1-codex from the dashboard).',
    );
  }

  const organization =
    process.env['OPENAI_ORGANIZATION']?.trim() ??
    process.env['OPENAI_ORG_ID']?.trim();
  const project =
    process.env['OPENAI_PROJECT_ID']?.trim() ??
    process.env['OPENAI_PROJECT']?.trim();
  const baseURL = process.env['OPENAI_BASE_URL']?.trim();

  _client = new OpenAI({
    apiKey,
    ...(organization ? { organization } : {}),
    ...(project ? { project } : {}),
    ...(baseURL ? { baseURL } : {}),
    maxRetries: 0,
    timeout: 600_000,
  });
  _client = wrapOpenAI(_client) as unknown as OpenAI;
  return _client;
}
