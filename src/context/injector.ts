/**
 * Context injector: builds system prompt sections from context store.
 */

import type { ContextStore } from './store.js';

export function buildSystemContext(store: ContextStore): string {
  const entries = store.getAll();
  if (entries.length === 0) return '';

  const sections = entries.map((e) => `## ${e.label}\n\n${e.content}`);
  return `# Injected Context\n\n${sections.join('\n\n---\n\n')}`;
}
