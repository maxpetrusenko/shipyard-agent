/**
 * Per-tool input/output redactors for LangSmith trace spans.
 *
 * Ensures no raw file contents, large stdout, or sensitive data
 * leak into trace payloads — especially when traces are public.
 */

import { createHash } from 'node:crypto';

type KVMap = Record<string, unknown>;

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

function preview(text: string, maxChars = 500): { text: string; truncated: boolean } {
  if (!text || text.length <= maxChars) return { text: text ?? '', truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

function previewLines(text: string, firstN: number, lastN: number): string {
  if (!text) return '';
  const lines = text.split('\n');
  if (lines.length <= firstN + lastN) return text;
  return [
    ...lines.slice(0, firstN),
    `... (${lines.length - firstN - lastN} lines omitted) ...`,
    ...lines.slice(-lastN),
  ].join('\n');
}

function previewPaths(paths: string[], maxCount: number): { paths: string[]; truncated: boolean } {
  if (!paths || paths.length <= maxCount) return { paths: paths ?? [], truncated: false };
  return { paths: paths.slice(0, maxCount), truncated: true };
}

// ---------------------------------------------------------------------------
// Input redaction
// ---------------------------------------------------------------------------

export function redactToolInput(name: string, input: KVMap): KVMap {
  switch (name) {
    case 'read_file':
      return { file_path: input['file_path'], offset: input['offset'], limit: input['limit'] };

    case 'write_file': {
      const content = (input['content'] as string) ?? '';
      return {
        file_path: input['file_path'],
        lineCount: lineCount(content),
        contentHash: contentHash(content),
      };
    }

    case 'edit_file': {
      const oldStr = (input['old_string'] as string) ?? '';
      const newStr = (input['new_string'] as string) ?? '';
      return {
        file_path: input['file_path'],
        old_string_length: oldStr.length,
        new_string_length: newStr.length,
      };
    }

    case 'bash': {
      const cmd = (input['command'] as string) ?? '';
      return {
        command: cmd.length > 200 ? cmd.slice(0, 200) + '...' : cmd,
        commandLength: cmd.length,
        timeout: input['timeout'],
        cwd: input['cwd'],
      };
    }

    case 'grep':
      return { pattern: input['pattern'], path: input['path'], glob: input['glob'], max_results: input['max_results'] };

    case 'glob':
      return { pattern: input['pattern'], cwd: input['cwd'] };

    case 'ls':
      return { path: input['path'] };

    case 'spawn_agent': {
      const task = (input['task'] as string) ?? '';
      return {
        task: task.length > 200 ? task.slice(0, 200) + '...' : task,
        role: input['role'],
      };
    }

    case 'ask_user': {
      const q = (input['question'] as string) ?? '';
      return { question: q.length > 200 ? q.slice(0, 200) + '...' : q };
    }

    case 'revert_changes':
      return { scope: input['scope'], strategy: input['strategy'], dry_run: input['dry_run'] };

    case 'commit_and_open_pr':
      return {
        title: input['title'],
        branch_name: input['branch_name'],
        base_branch: input['base_branch'],
        draft: input['draft'],
      };

    case 'inject_context': {
      const content = (input['content'] as string) ?? '';
      return { label: input['label'], content_length: content.length };
    }

    default:
      return { _note: 'unrecognized tool', name };
  }
}

// ---------------------------------------------------------------------------
// Output redaction
// ---------------------------------------------------------------------------

export function redactToolOutput(name: string, result: KVMap): KVMap {
  const success = result['success'] ?? !result['error'];

  switch (name) {
    case 'read_file': {
      const content = (result['content'] as string) ?? '';
      return {
        success,
        lineCount: lineCount(content),
        charCount: content.length,
        contentHash: contentHash(content),
        truncated: content.length > 1000,
      };
    }

    case 'write_file':
      return { success, message: result['message'] };

    case 'edit_file':
      return { success, tier: result['tier'], message: result['message'] };

    case 'bash': {
      const stdout = (result['stdout'] as string) ?? '';
      const stderr = (result['stderr'] as string) ?? '';
      return {
        success,
        exit_code: result['exit_code'],
        duration_ms: result['duration_ms'],
        stdout_length: stdout.length,
        stderr_length: stderr.length,
        truncated: stdout.length > 500,
      };
    }

    case 'grep': {
      const matches = result['matches'] as unknown[];
      const count = Array.isArray(matches) ? matches.length : result['match_count'] ?? 0;
      return {
        success,
        match_count: count,
        truncated: typeof count === 'number' && count > 20,
      };
    }

    case 'glob': {
      const files = (result['files'] as string[]) ?? [];
      const p = previewPaths(files, 10);
      return {
        success,
        file_count: files.length,
        first_paths: p.paths,
        truncated: p.truncated,
      };
    }

    case 'ls':
      return {
        success,
        entry_count: Array.isArray(result['entries']) ? (result['entries'] as unknown[]).length : 0,
      };

    case 'spawn_agent':
      return { success, result_summary: result['summary'] ?? result['message'] };

    default:
      return { success, truncated: false };
  }
}
