/**
 * Repo map: generates a compact file tree + key signatures for the target repo.
 *
 * Injected as a system context so the plan node can skip 3-8 rounds of
 * glob/grep exploration on every run.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { ContextEntry } from '../graph/state.js';
import { WORK_DIR } from '../config/work-dir.js';

let cachedMap: string | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function run(cmd: string): string {
  try {
    return execSync(cmd, {
      cwd: WORK_DIR,
      encoding: 'utf-8',
      timeout: 10_000,
      maxBuffer: 512 * 1024,
    }).trim();
  } catch {
    return '';
  }
}

function generateRepoMap(): string {
  if (!existsSync(WORK_DIR)) return `(WORK_DIR not found: ${WORK_DIR})`;

  const parts: string[] = [`# Repo Map: ${WORK_DIR}`];

  const tree = run(
    `find . -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.json" -o -name "*.md" -o -name "*.sql" -o -name "*.sh" \\) ` +
    `-not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/.next/*" ` +
    `-not -path "*/coverage/*" -not -path "*/.turbo/*" | sort`,
  );
  if (tree) {
    parts.push('\n## File Tree\n```');
    parts.push(tree);
    parts.push('```');
  }

  const exports = run(
    `grep -rn "^export " --include="*.ts" --include="*.tsx" . ` +
    `--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next ` +
    `| grep -E "^\\./src/" | head -120`,
  );
  if (exports) {
    parts.push('\n## Key Exports (src/)\n```');
    parts.push(exports);
    parts.push('```');
  }

  const pkg = run(`cat package.json 2>/dev/null | head -30`);
  if (pkg) {
    parts.push('\n## package.json (head)\n```json');
    parts.push(pkg);
    parts.push('```');
  }

  return parts.join('\n');
}

/**
 * Get the repo map as a ContextEntry, cached for 5 minutes.
 * Returns null if the work dir doesn't exist.
 */
export function getRepoMapContext(): ContextEntry | null {
  if (!existsSync(WORK_DIR)) return null;

  const now = Date.now();
  if (!cachedMap || now - cachedAt > CACHE_TTL_MS) {
    cachedMap = generateRepoMap();
    cachedAt = now;
  }

  return {
    label: 'Repo Map',
    content: cachedMap,
    source: 'system',
  };
}

/** Force-refresh the cached repo map. */
export function invalidateRepoMap(): void {
  cachedMap = null;
  cachedAt = 0;
}
