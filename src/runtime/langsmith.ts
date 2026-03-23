/**
 * LangSmith tracing helpers.
 *
 * Automatic via env vars when LANGCHAIN_TRACING_V2=true.
 * This module provides trace URL resolution for sharing.
 */

export function isTracingEnabled(): boolean {
  return process.env['LANGCHAIN_TRACING_V2'] === 'true';
}

export function getTraceProject(): string {
  return process.env['LANGCHAIN_PROJECT'] ?? 'shipyard';
}

/**
 * Build a LangSmith trace URL from a run ID.
 * Requires LANGCHAIN_API_KEY + LANGCHAIN_PROJECT to be set.
 */
export function buildTraceUrl(runId: string): string | null {
  if (!isTracingEnabled()) return null;

  const project = getTraceProject();
  // LangSmith URL pattern
  return `https://smith.langchain.com/o/default/projects/p/${project}/r/${runId}`;
}
