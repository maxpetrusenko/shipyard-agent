import { execSync } from 'node:child_process';
import type { Request, Response } from 'express';
import { WORK_DIR } from '../config/work-dir.js';
import type { InstructionLoop, RunResult } from '../runtime/loop.js';
import { NAV_STYLES, topNav } from './html-shared.js';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortPath(filePath: string): string {
  if (!filePath) return '';
  if (filePath.startsWith(WORK_DIR)) {
    return filePath.slice(WORK_DIR.length).replace(/^\/+/, '') || '.';
  }
  return filePath;
}

function fmtDate(iso?: string): string {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDuration(ms: number): string {
  if (!ms) return '0ms';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function phaseClass(phase: string): string {
  const map: Record<string, string> = {
    done: 'ph-done',
    error: 'ph-error',
    planning: 'ph-planning',
    executing: 'ph-executing',
    verifying: 'ph-verifying',
    reviewing: 'ph-verifying',
    awaiting_confirmation: 'ph-awaiting',
    paused: 'ph-paused',
    routing: 'ph-routing',
  };
  return map[phase] ?? 'ph-idle';
}

function firstUserInstruction(run: RunResult): string {
  return run.messages.find((msg) => msg.role === 'user')?.content?.trim() || '';
}

function firstStepDescription(run: RunResult): string {
  return run.steps.find((step) => step.description?.trim())?.description?.trim() || '';
}

function firstTouchedPath(run: RunResult): string {
  const fileEdit = run.fileEdits.find((edit) => edit.file_path?.trim())?.file_path?.trim();
  if (fileEdit) return shortPath(fileEdit);
  const toolFile = run.toolCallHistory
    .map((item) => item.tool_input?.file_path)
    .find((filePath): filePath is string => typeof filePath === 'string' && filePath.trim().length > 0);
  return toolFile ? shortPath(toolFile) : '';
}

function displayTitle(run: RunResult): string {
  const user = firstUserInstruction(run);
  if (user) return user;
  const step = firstStepDescription(run);
  if (step) return step;
  const path = firstTouchedPath(run);
  if (path) return `Changed ${path}`;
  return 'Untitled run';
}

function hasDisplayTitle(run: RunResult): boolean {
  return displayTitle(run) !== 'Untitled run';
}

function firstAssistantReply(run: RunResult): string {
  return run.messages.find((msg) => msg.role === 'assistant')?.content?.trim() || '';
}

function uniqueToolNames(run: RunResult): string[] {
  return Array.from(
    new Set(
      (run.toolCallHistory ?? [])
        .map((item) => item.tool_name)
        .filter((name): name is string => !!name),
    ),
  );
}

function hasRecordedWorkEvidence(run: RunResult): boolean {
  return uniqueToolNames(run).length > 0 || touchedFiles(run).length > 0;
}

function touchedFiles(run: RunResult): string[] {
  return Array.from(
    new Set(
      (run.fileEdits ?? [])
        .map((item) => item.file_path)
        .filter((filePath): filePath is string => !!filePath),
    ),
  );
}

function isRefactoringRun(run: RunResult): boolean {
  if (run.threadKind === 'plan' || run.threadKind === 'agent') return true;
  if (run.runMode === 'code') return true;
  if (run.executionPath === 'graph') return true;
  if ((run.steps?.length ?? 0) > 0) return true;
  if ((run.fileEdits?.length ?? 0) > 0) return true;
  if ((run.toolCallHistory?.length ?? 0) > 0) return true;
  if (run.verificationResult || run.reviewFeedback) return true;
  return false;
}

function repoMeta(): { branch: string; lastCommit: string } {
  try {
    return {
      branch: execSync(`git -C "${WORK_DIR}" branch --show-current`, { encoding: 'utf-8' }).trim() || 'unknown',
      lastCommit: execSync(`git -C "${WORK_DIR}" log -1 --format="%h %s" --no-walk`, { encoding: 'utf-8' }).trim() || 'unknown',
    };
  } catch {
    return { branch: 'unknown', lastCommit: 'unknown' };
  }
}

function renderRunCard(run: RunResult): string {
  const files = touchedFiles(run);
  const tools = uniqueToolNames(run);
  const instruction = displayTitle(run);
  const assistant = firstAssistantReply(run);
  const tokenInput = run.tokenUsage?.input ?? 0;
  const tokenOutput = run.tokenUsage?.output ?? 0;
  return `<article class="run-card">
    <div class="run-top">
      <div>
        <div class="run-kicker">${esc(fmtDate(run.savedAt))}</div>
        <h2>${esc(instruction)}</h2>
      </div>
      <div class="run-badges">
        <span class="phase ${phaseClass(run.phase)}">${esc(run.phase)}</span>
        ${run.threadKind ? `<span class="thread">${esc(run.threadKind)}</span>` : ''}
      </div>
    </div>
    <div class="run-meta">
      <span>${esc(fmtDuration(run.durationMs))}</span>
      <span>${files.length} file${files.length === 1 ? '' : 's'}</span>
      <span>${(run.toolCallHistory ?? []).length} tool call${(run.toolCallHistory ?? []).length === 1 ? '' : 's'}</span>
      <span>${tokenInput + tokenOutput} tokens</span>
    </div>
    ${assistant ? `<p class="assistant">${esc(assistant.slice(0, 280))}</p>` : ''}
    <div class="grid">
      <section class="mini">
        <div class="mini-label">Files Changed</div>
        ${
          files.length
            ? `<ul>${files.slice(0, 6).map((filePath) => `<li><code>${esc(shortPath(filePath))}</code></li>`).join('')}</ul>`
            : '<div class="empty">No file edits captured</div>'
        }
      </section>
      <section class="mini">
        <div class="mini-label">Calls Used</div>
        ${
          tools.length
            ? `<ul>${tools.slice(0, 6).map((tool) => `<li><code>${esc(tool)}</code></li>`).join('')}</ul>`
            : '<div class="empty">No tool history captured</div>'
        }
      </section>
    </div>
    <div class="run-links">
      <a href="/api/runs/${encodeURIComponent(run.runId)}">Run JSON</a>
      <a href="/api/runs/${encodeURIComponent(run.runId)}/debug">Debug</a>
      ${run.traceUrl ? `<a href="${esc(run.traceUrl)}" target="_blank" rel="noreferrer noopener">Trace</a>` : ''}
    </div>
  </article>`;
}

export function runsHandler(loop: InstructionLoop) {
  return async (req: Request, res: Response) => {
    let allRuns: RunResult[];
    try {
      allRuns = await loop.getRunsForListingAsync(500, 0);
    } catch (err) {
      console.error('[runs] getRunsForListingAsync failed:', err);
      allRuns = loop.getAllRuns().sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
    }

    const visibleRuns = allRuns.filter((run) => hasDisplayTitle(run) && hasRecordedWorkEvidence(run));
    const refactoringRuns = visibleRuns.filter(isRefactoringRun);
    const showAll = req.query['all'] === '1' || req.query['all'] === 'true';
    const runs = showAll ? visibleRuns : refactoringRuns;
    const hiddenCount = Math.max(0, allRuns.length - refactoringRuns.length);
    const meta = repoMeta();
    const totalFiles = runs.reduce((sum, run) => sum + touchedFiles(run).length, 0);
    const totalToolCalls = runs.reduce((sum, run) => sum + (run.toolCallHistory?.length ?? 0), 0);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Refactoring Runs</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#071018;--bg2:#0d1723;--card:#101b28;--card2:#152233;--border:#27384d;--text:#d9e4f2;--dim:#7f91a7;--muted:#5f7188;--accent:#7dd3fc;--accent2:#f59e0b;--green:#34d399;--red:#f87171;--purple:#a78bfa;--radius:10px;--radius-lg:18px;--shadow:0 18px 50px rgba(0,0,0,.32);--mono:'JetBrains Mono',monospace;--sans:'Space Grotesk',sans-serif}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(circle at top,rgba(125,211,252,.08),transparent 32%),linear-gradient(180deg,var(--bg2),var(--bg));color:var(--text);font:13px/1.5 var(--mono);min-height:100vh}
a{color:var(--accent);text-decoration:none}
a:hover{color:#fff}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 56px}
.hdr{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding-bottom:18px;border-bottom:1px solid var(--border);margin-bottom:22px}
.brand{font:700 24px/1 var(--sans);letter-spacing:-.04em}
.brand span{color:var(--accent)}
.pill{margin-left:auto;border:1px solid var(--border);border-radius:999px;padding:7px 12px;color:var(--dim);background:rgba(16,27,40,.75)}
.lead{display:grid;grid-template-columns:1.3fr .9fr;gap:18px;margin-bottom:18px}
.hero,.stats{background:linear-gradient(180deg,rgba(21,34,51,.94),rgba(16,27,40,.94));border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow)}
.hero{padding:22px}
.hero h1{margin:0 0 10px;font:700 34px/1 var(--sans);letter-spacing:-.05em}
.hero p{margin:0;color:var(--dim);max-width:60ch}
.hero-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.btn{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:999px;padding:9px 14px;background:rgba(255,255,255,.02);color:var(--text)}
.btn:hover{border-color:var(--accent);color:#fff}
.btn.active{background:rgba(125,211,252,.12);border-color:rgba(125,211,252,.45)}
.stats{padding:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.stat{padding:14px;border:1px solid var(--border);border-radius:var(--radius);background:rgba(7,16,24,.42)}
.stat-v{font:700 28px/1 var(--sans);letter-spacing:-.04em}
.stat-k{margin-top:6px;color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.08em}
.list{display:grid;gap:14px}
.run-card{padding:18px;border:1px solid var(--border);border-radius:var(--radius-lg);background:linear-gradient(180deg,rgba(16,27,40,.95),rgba(10,18,28,.95));box-shadow:var(--shadow)}
.run-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:10px}
.run-top h2{margin:4px 0 0;font:600 18px/1.25 var(--sans);letter-spacing:-.03em}
.run-kicker{color:var(--accent2);font-size:10px;letter-spacing:.12em;text-transform:uppercase}
.run-badges{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.phase,.thread{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;border:1px solid var(--border)}
.thread{color:var(--accent);background:rgba(125,211,252,.08)}
.ph-done{background:rgba(52,211,153,.12);color:var(--green)}
.ph-error{background:rgba(248,113,113,.12);color:var(--red)}
.ph-planning,.ph-routing{background:rgba(125,211,252,.12);color:var(--accent)}
.ph-executing{background:rgba(245,158,11,.12);color:var(--accent2)}
.ph-verifying{background:rgba(167,139,250,.12);color:var(--purple)}
.ph-awaiting,.ph-paused,.ph-idle{background:rgba(127,145,167,.12);color:var(--dim)}
.run-meta{display:flex;gap:12px;flex-wrap:wrap;color:var(--dim);font-size:11px;margin-bottom:12px}
.assistant{margin:0 0 14px;color:var(--text)}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.mini{padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:rgba(7,16,24,.48)}
.mini-label{margin-bottom:8px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.mini ul{margin:0;padding-left:18px}
.mini li{margin:0 0 6px}
.mini li:last-child{margin-bottom:0}
.empty{color:var(--muted)}
.run-links{display:flex;gap:12px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}
.empty-state{padding:36px;border:1px dashed var(--border);border-radius:var(--radius-lg);text-align:center;color:var(--dim)}
code{background:rgba(255,255,255,.04);padding:2px 6px;border-radius:6px}
${NAV_STYLES}
@media(max-width:900px){.lead,.grid{grid-template-columns:1fr}.pill{margin-left:0}}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <div class="brand"><a href="/" style="color:inherit"><span>Shipyard</span> Agent</a></div>
    ${topNav('runs')}
    <div class="pill"><strong>${esc(meta.branch)}</strong> &nbsp; ${esc(meta.lastCommit.slice(0, 64))}</div>
  </div>

  <section class="lead">
    <div class="hero">
      <h1>Refactoring Runs</h1>
      <p>Repo-touching run history for <code>${esc(WORK_DIR)}</code>. Pure ask-only chats are hidden by default so this view stays focused on the calls and edits used to modify the repo.</p>
      <div class="hero-actions">
        <a class="btn ${showAll ? '' : 'active'}" href="/runs">Refactoring Only</a>
        <a class="btn ${showAll ? 'active' : ''}" href="/runs?all=1">Show All Runs</a>
        <a class="btn" href="/dashboard">Open Chat</a>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-v">${runs.length}</div><div class="stat-k">${showAll ? 'Runs Shown' : 'Refactoring Runs'}</div></div>
      <div class="stat"><div class="stat-v">${hiddenCount}</div><div class="stat-k">Ask Chats Hidden</div></div>
      <div class="stat"><div class="stat-v">${totalFiles}</div><div class="stat-k">File Touches</div></div>
      <div class="stat"><div class="stat-v">${totalToolCalls}</div><div class="stat-k">Tool Calls</div></div>
    </div>
  </section>

  <section class="list">
    ${runs.length ? runs.map(renderRunCard).join('') : '<div class="empty-state">No runs match this view yet.</div>'}
  </section>
</div>
</body>
</html>`;

    res.status(200).type('html').send(html);
  };
}
