/**
 * Blast-radius analysis: detect how many files import a given module
 * and whether an edit changes exported symbols.
 *
 * Used by the execute node to prevent cascade type errors from editing
 * widely-imported hub files.
 */

import { basename, dirname, relative } from 'node:path';
import { runBash } from './bash.js';

// ---------------------------------------------------------------------------
// Import counting
// ---------------------------------------------------------------------------

/**
 * Count how many .ts/.tsx files import from a given file path.
 * Uses grep to search for import statements referencing the file's basename.
 */
export async function countImporters(
  filePath: string,
  workDir: string,
): Promise<number> {
  const rel = relative(workDir, filePath);
  const base = basename(filePath).replace(/\.(ts|tsx)$/, '');
  const dir = dirname(rel);

  // Build patterns to match various import styles:
  // import { X } from './foo'  |  import { X } from '../lib/foo.js'  |  require('./foo')
  const patterns = [
    `from ['"].*${escapeForGrep(base)}['"]`,
    `from ['"].*${escapeForGrep(base)}\\.js['"]`,
    `require\\(['"].*${escapeForGrep(base)}['"]\\)`,
  ];
  const pattern = patterns.join('|');

  const result = await runBash({
    command: `grep -rlE '${pattern}' '${workDir}/src' '${workDir}/api/src' '${workDir}/lib' --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v '${escapeForGrep(rel)}' | wc -l`,
    timeout: 10_000,
    cwd: workDir,
  });

  if (!result.success) return 0;
  const count = parseInt(result.stdout.trim(), 10);
  return Number.isFinite(count) ? count : 0;
}

function escapeForGrep(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Export change detection
// ---------------------------------------------------------------------------

/** Regex patterns that identify exported symbols. */
const EXPORT_PATTERNS = [
  /export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum|abstract)\s+(\w+)/g,
  /export\s*\{([^}]+)\}/g,
  /export\s+default\s/g,
];

/**
 * Extract exported symbol names from a code string.
 */
export function extractExportedSymbols(code: string): Set<string> {
  const symbols = new Set<string>();

  for (const pattern of EXPORT_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      if (match[1]) {
        // Named export: could be single name or comma-separated list in braces
        const names = match[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()?.trim());
        for (const name of names) {
          if (name) symbols.add(name);
        }
      } else {
        symbols.add('default');
      }
    }
  }

  return symbols;
}

/**
 * Detect whether an edit (old_string -> new_string) removes or renames
 * exported symbols. Returns the list of removed export names.
 */
export function detectExportChanges(
  oldString: string,
  newString: string,
): string[] {
  const oldExports = extractExportedSymbols(oldString);
  const newExports = extractExportedSymbols(newString);

  const removed: string[] = [];
  for (const sym of oldExports) {
    if (!newExports.has(sym)) {
      removed.push(sym);
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Blast radius guard (composite check)
// ---------------------------------------------------------------------------

export interface BlastRadiusResult {
  allowed: boolean;
  importerCount: number;
  removedExports: string[];
  message: string | null;
}

/** Default threshold: files imported by more than this many files are "hub" files. */
export const BLAST_RADIUS_THRESHOLD = 8;

/**
 * Check whether an edit to a TypeScript file is safe from a cascade perspective.
 *
 * Returns allowed=false with a descriptive message if the edit would remove
 * exports from a widely-imported hub file.
 */
export async function checkBlastRadius(params: {
  filePath: string;
  oldString: string;
  newString: string;
  workDir: string;
  threshold?: number;
}): Promise<BlastRadiusResult> {
  const { filePath, oldString, newString, workDir } = params;
  const threshold = params.threshold ?? BLAST_RADIUS_THRESHOLD;

  // Only check .ts/.tsx files
  if (!/\.(ts|tsx)$/.test(filePath)) {
    return { allowed: true, importerCount: 0, removedExports: [], message: null };
  }

  // Skip if old_string is empty (new file or append)
  if (!oldString || oldString.trim() === '') {
    return { allowed: true, importerCount: 0, removedExports: [], message: null };
  }

  const removedExports = detectExportChanges(oldString, newString);
  if (removedExports.length === 0) {
    return { allowed: true, importerCount: 0, removedExports: [], message: null };
  }

  const importerCount = await countImporters(filePath, workDir);
  if (importerCount <= threshold) {
    return { allowed: true, importerCount, removedExports, message: null };
  }

  return {
    allowed: false,
    importerCount,
    removedExports,
    message:
      `Blast radius guard: ${filePath} is imported by ${importerCount} files (threshold: ${threshold}). ` +
      `This edit would remove exports: [${removedExports.join(', ')}]. ` +
      `Use the adapter/re-export pattern instead: create a new implementation file, then update the hub file to re-export.`,
  };
}
