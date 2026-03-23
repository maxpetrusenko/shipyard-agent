/**
 * Context store: in-memory registry for injected context.
 *
 * Contexts are markdown sections injected into the system prompt.
 */

import type { ContextEntry } from '../graph/state.js';

export class ContextStore {
  private entries: Map<string, ContextEntry> = new Map();

  add(entry: ContextEntry): void {
    this.entries.set(entry.label, entry);
  }

  remove(label: string): boolean {
    return this.entries.delete(label);
  }

  getAll(): ContextEntry[] {
    return Array.from(this.entries.values());
  }

  get(label: string): ContextEntry | undefined {
    return this.entries.get(label);
  }

  clear(): void {
    this.entries.clear();
  }

  toMarkdown(): string {
    return this.getAll()
      .map((c) => `## ${c.label}\n\n${c.content}`)
      .join('\n\n---\n\n');
  }
}
