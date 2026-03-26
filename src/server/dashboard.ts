/**
 * Visual dashboard served at GET /
 */

import type { Request, Response } from 'express';
import type { InstructionLoop } from '../runtime/loop.js';
import { execSync } from 'node:child_process';
import { NAV_STYLES, topNav, getSharedHelperScript } from './html-shared.js';
import { WORK_DIR } from '../config/work-dir.js';
import { getTimelineScript } from './dashboard-timeline.js';
import {
  RUN_DEBUG_STYLES,
  getRunDebugModalHtml,
  getRunDebugScript,
} from './dashboard-debug.js';
import {
  DASHBOARD_ANTHROPIC_KEY_STORAGE_KEY,
  DASHBOARD_GITHUB_REPO_STORAGE_KEY,
  DASHBOARD_GITHUB_TOKEN_STORAGE_KEY,
  DASHBOARD_OPENAI_KEY_STORAGE_KEY,
  getDashboardPreferenceScript,
} from './dashboard-preferences.js';
import {
  getRetryStyles,
  getRetryHtml,
  getRetryScript,
} from './dashboard-retry.js';

export function dashboardHandler(loop: InstructionLoop) {
  return async (_req: Request, res: Response) => {
    const status = loop.getStatus();
    let runs: Awaited<ReturnType<InstructionLoop['getRunsForListingAsync']>>;
    try {
      runs = await loop.getRunsForListingAsync(30, 0);
    } catch (err) {
      console.error('[dashboard] getRunsForListingAsync failed:', err);
      runs = loop.getAllRuns()
        .sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''))
        .slice(0, 30);
    }

    let repoBranch = 'unknown';
    let repoLastCommit = 'unknown';
    try {
      repoBranch = execSync(`git -C "${WORK_DIR}" branch --show-current`, { encoding: 'utf-8' }).trim();
      repoLastCommit = execSync(`git -C "${WORK_DIR}" log -1 --format="%h %s" --no-walk`, { encoding: 'utf-8' }).trim();
    } catch { /* not a git repo */ }

    const runsJson = JSON.stringify(
      runs.map((r) => ({
        runId: r.runId,
        phase: r.phase,
        steps: r.steps ?? [],
        fileEdits: r.fileEdits ?? [],
        toolCallHistory: r.toolCallHistory ?? [],
        messages: r.messages ?? [],
        tokenUsage: r.tokenUsage,
        traceUrl: r.traceUrl,
        error: r.error,
        verificationResult: r.verificationResult ?? null,
        reviewFeedback: r.reviewFeedback ?? null,
        nextActions: r.nextActions ?? [],
        durationMs: r.durationMs,
        threadKind: r.threadKind ?? null,
        completionStatus: r.completionStatus ?? null,
        savedAt: r.savedAt,
        instruction:
          ((r.messages ?? []) as Array<{ role: string; content: string }>).find(
            (m) => m.role === 'user',
          )?.content ?? '',
      })),
    ).replace(/</g, '\\u003c');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shipyard Agent</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#060a12;--bg2:#0a0e17;--card:#111827;--card2:#1a2035;--border:#2a3250;--border-bright:#3a4570;--text:#e2e8f0;--text-bright:#f1f5f9;--dim:#6b7a90;--muted:#4a5568;--accent:#818cf8;--accent-dim:rgba(129,140,248,.25);--accent-glow:rgba(129,140,248,.12);--green:#10b981;--green-dim:rgba(16,185,129,.2);--red:#ef4444;--red-dim:rgba(239,68,68,.2);--yellow:#f59e0b;--yellow-dim:rgba(245,158,11,.2);--cyan:#22d3ee;--purple:#a78bfa;--pink:#f472b6;--mono:'JetBrains Mono',monospace;--sans:'Space Grotesk',sans-serif;--radius:8px;--radius-lg:14px;--shadow:0 4px 20px rgba(0,0,0,.4);--shadow-glow:0 0 40px var(--accent-glow);--shadow-lg:0 10px 40px rgba(0,0,0,.5);--shadow-ring:0 0 0 3px var(--accent-dim);--radius-xl:18px;--z-header:40;--z-composer:30;--z-modal:100;--z-overlay:90;--text-xs:9px;--text-sm:10px;--text-base:11px;--text-md:12px;--text-lg:13px;--text-xl:14px;--transition:.15s ease}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:var(--mono);font-size:13px;min-height:100vh;height:100dvh;overflow:hidden;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--dim)}
.wrap{max-width:1100px;height:100%;margin:0 auto;padding:20px 20px 16px;display:flex;flex-direction:column;overflow:hidden}
h1{font-family:var(--sans);font-size:24px;font-weight:700;letter-spacing:-.03em}
h1 span{color:var(--accent);text-shadow:0 0 24px var(--accent-dim)}
.lbl{font-size:var(--text-sm);text-transform:uppercase;letter-spacing:2px;color:var(--dim);font-family:var(--mono)}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 18px;box-shadow:var(--shadow)}
/* header */
.hdr{display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap;padding:6px 0 12px;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:30;background:rgba(6,10,18,.9);backdrop-filter:blur(8px)}
.hdr::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--accent-dim),transparent)}
.pill{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:4px 12px;font-size:var(--text-base);color:var(--dim);font-family:var(--mono)}
.pill span{color:var(--accent)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.wsdot{width:6px;height:6px;border-radius:50%;display:inline-block}
.wsdot.on{background:var(--green);box-shadow:0 0 6px var(--green-dim)}
.wsdot.off{background:var(--red);box-shadow:0 0 6px var(--red-dim)}
/* per-run perf */
.run-perf{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.run-perf .mini{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;box-shadow:var(--shadow)}
.run-perf .mini svg{display:block;margin-top:4px;max-width:100%;height:auto}
/* graph */
.graph-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 20px;margin-bottom:16px;overflow-x:auto;box-shadow:var(--shadow)}
/* submit */
.sub-card{background:linear-gradient(135deg,var(--card),var(--card2));border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px 20px;margin-bottom:16px;box-shadow:var(--shadow)}
.sub-card textarea{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;font-family:var(--mono);font-size:var(--text-lg);resize:vertical;outline:none;line-height:1.5;transition:border-color var(--transition)}
.sub-card textarea:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-glow)}
.composer-row{display:flex;align-items:flex-end;gap:10px;margin-bottom:10px}
.composer-ta{flex:1;min-height:52px;max-height:min(38dvh,260px);resize:vertical}
.composer-send{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;min-width:44px;padding:0;border-radius:50%;font-size:17px;line-height:1;flex-shrink:0}
.composer-send-hidden{display:none!important}
.composer-toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:4px}
.btn{border:none;padding:7px 18px;border-radius:var(--radius);font-family:var(--mono);font-size:var(--text-md);cursor:pointer;font-weight:700;transition:all var(--transition)}
.btn:hover{opacity:.88;transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
.btn-p{background:var(--accent);color:#fff;box-shadow:0 2px 12px var(--accent-dim)}
.btn-d{background:var(--red-dim);color:var(--red);border:1px solid rgba(239,68,68,.3)}
.btn-g{background:var(--accent-glow);color:var(--accent);border:1px solid var(--border)}
/* runs */
.runs-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:16px;box-shadow:var(--shadow)}
.run-row{border-bottom:1px solid var(--border)}
.run-row:last-child{border-bottom:none}
.run-hdr{display:grid;grid-template-columns:86px 100px 1fr auto 18px;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;user-select:none;transition:background var(--transition)}
.run-hdr:hover{background:var(--card2)}
.chev{color:var(--dim);font-size:var(--text-sm);transition:transform .2s}
.chev.open{transform:rotate(90deg)}
.pbadge{display:inline-block;padding:3px 8px;border-radius:var(--radius);font-size:var(--text-sm);font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.pp-done{background:var(--green-dim);color:var(--green)}
.pp-error{background:var(--red-dim);color:var(--red)}
.pp-planning{background:var(--accent-glow);color:var(--accent)}
.pp-executing{background:var(--yellow-dim);color:var(--yellow)}
.pp-verifying,.pp-reviewing{background:rgba(34,211,238,.12);color:var(--cyan)}
.pp-awaiting_confirmation{background:rgba(167,139,250,.12);color:var(--purple)}
.pp-paused{background:rgba(244,114,182,.12);color:var(--pink)}
.pp-routing{background:rgba(34,211,238,.12);color:var(--cyan)}
.pp-idle{background:rgba(75,85,99,.2);color:var(--dim)}
.pp-thread-ask{font-size:var(--text-xs);color:#93c5fd;margin-left:4px;font-weight:600}
.ask-followup{margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
.run-details{display:none;border-top:1px solid var(--border);background:var(--bg2)}
.run-details.open{display:block}
.rtabs{display:flex;border-bottom:1px solid var(--border);background:var(--card)}
.rtab{padding:8px 16px;font-size:var(--text-sm);color:var(--dim);cursor:pointer;border-bottom:2px solid transparent;text-transform:uppercase;letter-spacing:1px;transition:color var(--transition);font-family:var(--mono)}
.rtab:hover{color:var(--text)}
.rtab.active{color:var(--accent);border-bottom-color:var(--accent)}
.rtc{display:none;padding:14px 16px}
.rtc.active{display:block}
/* phases */
.psec{border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;overflow:hidden}
.psec-hd{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;background:var(--card);transition:background var(--transition)}
.psec-hd:hover{background:var(--card2)}
.psec-bd{display:none;padding:10px 12px;background:var(--bg2)}
.psec-bd.open{display:block}
.step-row{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)}
.step-row:last-child{border-bottom:none}
.step-n{color:var(--dim);font-size:var(--text-base);width:18px;flex-shrink:0;padding-top:1px}
.sstatus{font-size:var(--text-sm);font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:4px;flex-shrink:0}
.ss-done{background:var(--green-dim);color:var(--green)}
.ss-pending{background:rgba(75,85,99,.2);color:var(--dim)}
.ss-in_progress{background:var(--yellow-dim);color:var(--yellow)}
.ss-failed{background:var(--red-dim);color:var(--red)}
.step-files{font-size:var(--text-sm);color:var(--dim);margin-top:2px}
/* diffs */
.dblock{border:1px solid var(--border);border-radius:var(--radius);margin-bottom:7px;overflow:hidden}
.dfh{padding:6px 12px;background:var(--card);font-size:var(--text-base);color:var(--accent);border-bottom:1px solid var(--border);display:flex;justify-content:space-between}
.dfb{padding:6px 12px;font-size:var(--text-base);line-height:1.55;overflow-x:auto;max-height:160px;overflow-y:auto;background:var(--bg)}
.da{color:var(--green)}
.dd{color:var(--red)}
.dc{color:var(--dim)}
/* tool rows */
.trow{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:var(--text-base)}
.trow:last-child{border-bottom:none}
.tname{color:var(--accent);font-weight:700;min-width:90px;flex-shrink:0}
/* live feed (legacy, kept for compat) */
.lfeed{max-height:360px;overflow-y:auto}
/* error */
.errbox{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:var(--radius);padding:12px 14px;font-size:var(--text-md);color:var(--red);white-space:pre-wrap;word-break:break-all}
.run-phase-error{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.15);border-radius:var(--radius);padding:12px 14px;font-size:var(--text-md);color:#f87171;margin-bottom:12px;white-space:pre-wrap;word-break:break-word}
.run-phase-error strong{color:#fca5a5;font-size:var(--text-sm);text-transform:uppercase;letter-spacing:.06em}
.ver-out,.ver-summary{font-size:var(--text-base);line-height:1.45;color:var(--text);max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px;margin-top:6px}
.ver-summary{color:var(--dim);max-height:none}
/* misc */
.run-inst{font-size:var(--text-base);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:380px}
.run-meta{font-size:var(--text-sm);color:var(--dim);margin-top:2px}
.rctls{display:flex;gap:6px}
code{background:var(--card2);padding:2px 6px;border-radius:4px;font-size:var(--text-base)}
a{color:var(--accent);text-decoration:none;transition:color var(--transition)}
a:hover{color:var(--text-bright);text-decoration:none}
.ldot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--yellow);box-shadow:0 0 6px var(--yellow-dim);animation:pulse 1.5s infinite;vertical-align:middle;margin-right:4px}
.nav-link{font-size:var(--text-base);border:1px solid var(--border);border-radius:var(--radius);padding:5px 14px;color:var(--dim);text-decoration:none;transition:all var(--transition);font-family:var(--mono)}
.nav-link:hover{border-color:var(--accent);color:var(--accent);box-shadow:0 0 12px var(--accent-glow);text-decoration:none}
.thread-fold{margin-bottom:10px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.thread-fold-hd{width:100%;text-align:left;padding:8px 12px;background:var(--card2);border:none;color:var(--text);font-family:var(--mono);font-size:11px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background var(--transition)}
.thread-fold-hd:hover{background:var(--card)}
.thread-fold-chev{color:var(--accent);font-size:10px;width:14px;flex-shrink:0}
.thread-fold-bd{padding:10px 12px;background:var(--bg2);font-size:11px;border-top:1px solid var(--border)}
.side-tabs{display:flex;gap:6px;margin-bottom:8px}
.side-tab{flex:1;border:1px solid var(--border);background:var(--card);color:var(--dim);border-radius:var(--radius);padding:6px 8px;font-size:10px;font-family:var(--mono);cursor:pointer;text-transform:uppercase;letter-spacing:.06em}
.side-tab.active{border-color:var(--accent);background:var(--accent-glow);color:var(--text)}
.side-panel{display:none}
.side-panel.active{display:block}
.side-panel#sidePanelChats{display:none}
.side-panel#sidePanelChats.active{display:flex;flex-direction:column;min-height:0}
.side-card{border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:var(--card2);margin-bottom:8px}
.side-label{display:block;font-size:10px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em}
.side-input,.side-select{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:6px 8px;font-size:11px;font-family:var(--mono)}
.side-select{cursor:pointer}
.side-input:focus,.side-select:focus{outline:none;border-color:var(--accent)}
.side-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.side-note{font-size:10px;color:var(--dim);line-height:1.35}
.side-status{font-size:10px;color:var(--dim);line-height:1.35;word-break:break-word}
.side-btn{font-size:10px;padding:5px 8px}
.side-checklist{font-size:10px;color:var(--dim);line-height:1.45;padding-left:16px}
.side-checklist li{margin:3px 0}
.side-badge{display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;border:1px solid var(--border);font-size:9px;text-transform:uppercase;letter-spacing:.08em}
.side-badge.ok{color:var(--green);border-color:rgba(16,185,129,.35);background:rgba(16,185,129,.12)}
.side-badge.warn{color:var(--yellow);border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.12)}
.side-badge.off{color:var(--red);border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.12)}
.side-alert{font-size:10px;line-height:1.4;color:#fca5a5;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.28);border-radius:var(--radius);padding:8px 9px}
${NAV_STYLES}
${RUN_DEBUG_STYLES}
${getRetryStyles()}
</style>
</head>
<body>
<div class="wrap">

  <div class="hdr">
    <h1><a href="/" style="color:inherit;text-decoration:none"><span>Shipyard</span> Agent</a></h1>
    ${topNav('chat')}
    <div class="pill"><span>${repoBranch}</span> &middot; ${repoLastCommit.slice(0, 55)}</div>
    <button type="button" class="btn btn-g" data-action="openRetry" style="font-size:10px;padding:5px 12px;margin-left:auto">Retry Events</button>
    <div style="display:flex;align-items:center;gap:6px">
      <span class="wsdot off" id="wsDot"></span>
      <span id="wsLbl" style="font-size:11px;color:var(--dim)">connecting</span>
    </div>
  </div>

  <div class="chat-layout">
  <aside class="chat-side" aria-label="Chats">
    <div class="side-tabs" role="tablist" aria-label="Sidebar tabs">
      <button type="button" class="side-tab active" id="sideTabChats" data-action="sideTab" data-tab="chats" role="tab" aria-selected="true">Chats</button>
      <button type="button" class="side-tab" id="sideTabSettings" data-action="sideTab" data-tab="settings" role="tab" aria-selected="false">Config</button>
    </div>
    <div class="side-panel active" id="sidePanelChats" role="tabpanel" aria-labelledby="sideTabChats">
      <div class="side-hd" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <span>Chats</span>
        <button type="button" class="btn btn-g" id="newChatBtn" data-action="newChat" style="font-size:10px;padding:4px 10px">+ New</button>
      </div>
      <div id="chatList" style="max-height:min(70vh,560px);overflow-y:auto;padding-right:4px"></div>
    </div>
    <div class="side-panel" id="sidePanelSettings" role="tabpanel" aria-labelledby="sideTabSettings">
      <div class="side-card">
        <div class="side-hd">Model Keys</div>
        <label class="side-label" for="anthropicKeyInput">Anthropic key</label>
        <input class="side-input" id="anthropicKeyInput" type="password" placeholder="sk-ant-..." autocomplete="off">
        <label class="side-label" for="openaiKeyInput" style="margin-top:8px">OpenAI key</label>
        <input class="side-input" id="openaiKeyInput" type="password" placeholder="sk-..." autocomplete="off">
        <div class="side-row" style="margin-top:8px">
          <button type="button" class="btn btn-p side-btn" data-action="saveModelKeys">Apply Keys</button>
        </div>
        <div id="modelKeyStatus" class="side-status" style="margin-top:6px"></div>
      </div>
      <div class="side-card">
        <div class="side-hd">Checkpoints</div>
        <div class="side-note" style="margin-bottom:8px">Create and restore local workspace snapshots without git reset.</div>
        <div class="side-row">
          <button type="button" class="btn btn-g side-btn" data-action="refreshCheckpoints">Refresh</button>
          <button type="button" class="btn btn-p side-btn" data-action="createCheckpoint">Create</button>
          <button type="button" class="btn btn-d side-btn" data-action="rollbackCheckpoint">Rollback</button>
        </div>
        <label class="side-label" for="checkpointSel" style="margin-top:8px">Latest checkpoints</label>
        <select id="checkpointSel" class="side-select">
          <option value="">(none)</option>
        </select>
        <div id="checkpointStatus" class="side-status" style="margin-top:6px"></div>
      </div>
      <div class="side-card">
        <div class="side-hd">GitHub Connect</div>
        <div class="side-note" style="margin-bottom:8px">Manage GitHub connector and repository access in Settings.</div>
        <a href="/settings/connectors/github" class="btn btn-g side-btn" style="text-decoration:none;display:inline-flex">Open GitHub Settings</a>
      </div>
    </div>
  </aside>
  <div class="chat-center">
  <div class="chat-shell">
    <div class="chat-thread" id="chatThread" aria-live="polite"></div>
    <div class="chat-composer">
  <div class="sub-card" style="margin-bottom:0">
    <div id="composerHint" style="display:none;font-size:10px;color:var(--dim);margin-bottom:8px;line-height:1.45"></div>
    <div class="composer-row">
      <textarea id="instr" class="composer-ta" rows="2" placeholder="Message…" autocomplete="off"></textarea>
      <button type="button" class="btn btn-p composer-send composer-send-hidden" id="subBtn" data-action="submit" aria-label="Send" title="Send (Ctrl+Enter)"><span class="composer-btn-icon" aria-hidden="true">&#9654;</span></button>
    </div>
    <div style="margin-top:4px">
      <div data-action="togglePlanDoc" style="font-size:11px;color:var(--accent);cursor:pointer;user-select:none">+ Attach plan document</div>
      <div id="planDocWrap" style="display:none;margin-top:6px">
        <textarea id="planDoc" rows="5" placeholder="Paste requirements, spec, or plan document here. The planner will use it as context to scope the work."></textarea>
      </div>
    </div>
    <div class="composer-toolbar">
      <label style="font-size:11px;color:var(--dim);display:flex;align-items:center;gap:6px">
        <span>Mode</span>
        <select id="uiModeSel" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:5px 10px;font-size:11px;font-family:var(--mono);cursor:pointer;transition:border-color var(--transition)" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
          <option value="ask">Ask</option>
          <option value="plan">Plan</option>
          <option value="agent">Agent</option>
          <option value="">Auto (classify)</option>
        </select>
      </label>
      <label style="font-size:11px;color:var(--dim);display:flex;align-items:center;gap:6px" title="Optional whole-run model override. When set, this model is used for the run across planning, coding, review, and chat stages.">
        <span>Model</span>
        <select id="modelSel" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:5px 10px;font-size:11px;font-family:var(--mono);cursor:pointer;transition:border-color var(--transition)" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
          <option value="">(none)</option>
          <option value="gpt-5.4">GPT-5.4 (OpenAI)</option>
          <option value="gpt-5.4-mini">GPT-5.4 Mini (OpenAI)</option>
          <option value="gpt-5.4-nano">GPT-5.4 Nano (OpenAI)</option>
        </select>
      </label>
      <button type="button" class="btn btn-d" id="stopBtn" data-action="stop" style="display:none">Stop</button>
      <span id="subSt" style="font-size:11px;color:var(--dim)"></span>
    </div>
  </div>
    </div>
  </div>
  </div>
  </div>

</div>
${getRunDebugModalHtml()}
${getRetryHtml()}
<script>
var WORK_DIR = ${JSON.stringify(WORK_DIR)};
var SEED = ${runsJson};
var ANTHROPIC_KEY_STORAGE = ${JSON.stringify(DASHBOARD_ANTHROPIC_KEY_STORAGE_KEY)};
var OPENAI_KEY_STORAGE = ${JSON.stringify(DASHBOARD_OPENAI_KEY_STORAGE_KEY)};
var GH_REPO_STORAGE = ${JSON.stringify(DASHBOARD_GITHUB_REPO_STORAGE_KEY)};
var GH_TOKEN_STORAGE = ${JSON.stringify(DASHBOARD_GITHUB_TOKEN_STORAGE_KEY)};
var GH_APP_SLUG_STORAGE = 'shipyard_dashboard_github_app_slug';
var GH_APP_ID_STORAGE = 'shipyard_dashboard_github_app_id';
var GH_APP_PK_STORAGE = 'shipyard_dashboard_github_app_pk';
${getTimelineScript()}
${getRunDebugScript()}

var runsMap = {};
var titleOverrides = {};
var selectedRunId = null;
var selectedSideTab = 'chats';
var lastState = {};
var curRunId = null;
var SELECTED_RUN_STORAGE_KEY = 'shipyard_selected_run_id';
var SELECTED_SIDETAB_STORAGE_KEY = 'shipyard_selected_sidebar_tab';

var __srvSt = ${JSON.stringify({ processing: status.processing, currentRunId: status.currentRunId })};
if (__srvSt.processing && __srvSt.currentRunId) {
  curRunId = __srvSt.currentRunId;
  lastState = { runId: __srvSt.currentRunId, phase: 'routing' };
}

try {
  var savedTitles = localStorage.getItem('shipyard_titles');
  if (savedTitles) titleOverrides = JSON.parse(savedTitles);
} catch(e) {}

try {
  var savedSelectedRunId = localStorage.getItem(SELECTED_RUN_STORAGE_KEY);
  if (savedSelectedRunId) selectedRunId = savedSelectedRunId;
} catch(e) {}

try {
  var savedSideTab = localStorage.getItem(SELECTED_SIDETAB_STORAGE_KEY);
  if (savedSideTab === 'settings' || savedSideTab === 'chats') selectedSideTab = savedSideTab;
} catch(e) {}

var threadExpand = {};
var settingsStatus = {
  workDir: WORK_DIR,
  repoBranch: null,
  repoRemote: null,
  ghAuthenticated: false,
  githubConnected: false,
  githubLogin: null,
  githubOAuthConfigured: false,
  githubInstallConfigured: false,
  githubAppConfigured: false,
  githubAppSlug: null,
  githubInstallationId: null,
};

${getDashboardPreferenceScript()}

function preferDefined(nextVal, prevVal) {
  return nextVal !== undefined ? nextVal : prevVal;
}

function preferRicherArray(nextVal, prevVal) {
  if (Array.isArray(nextVal) && nextVal.length > 0) return nextVal;
  if (Array.isArray(prevVal) && prevVal.length > 0) return prevVal;
  if (Array.isArray(nextVal)) return nextVal;
  return Array.isArray(prevVal) ? prevVal : [];
}

function runInstruction(run) {
  var msgs = Array.isArray(run && run.messages) ? run.messages : [];
  return ((msgs.find(function(m){ return m.role === 'user'; }) || {}).content || run.instruction || '');
}

function mergeRunRecord(prev, next) {
  var prevRun = prev || {};
  var nextRun = next || {};
  return {
    runId: preferDefined(nextRun.runId, prevRun.runId),
    phase: preferDefined(nextRun.phase, prevRun.phase),
    steps: preferRicherArray(nextRun.steps, prevRun.steps),
    fileEdits: preferRicherArray(nextRun.fileEdits, prevRun.fileEdits),
    toolCallHistory: preferRicherArray(nextRun.toolCallHistory, prevRun.toolCallHistory),
    messages: preferRicherArray(nextRun.messages, prevRun.messages),
    tokenUsage: preferDefined(nextRun.tokenUsage, prevRun.tokenUsage),
    traceUrl: preferDefined(nextRun.traceUrl, prevRun.traceUrl),
    error: preferDefined(nextRun.error, prevRun.error),
    verificationResult: preferDefined(nextRun.verificationResult, prevRun.verificationResult),
    reviewFeedback: preferDefined(nextRun.reviewFeedback, prevRun.reviewFeedback),
    nextActions: preferRicherArray(nextRun.nextActions, prevRun.nextActions),
    durationMs: preferDefined(nextRun.durationMs, prevRun.durationMs),
    threadKind: preferDefined(nextRun.threadKind, prevRun.threadKind),
    savedAt: preferDefined(nextRun.savedAt, prevRun.savedAt),
    startedAt: preferDefined(nextRun.startedAt, prevRun.startedAt),
    queuedAt: preferDefined(nextRun.queuedAt, prevRun.queuedAt),
    executionPath: preferDefined(nextRun.executionPath, prevRun.executionPath),
    runMode: preferDefined(nextRun.runMode, prevRun.runMode),
    modelOverride: preferDefined(nextRun.modelOverride, prevRun.modelOverride),
    modelFamily: preferDefined(nextRun.modelFamily, prevRun.modelFamily),
    modelOverrides: preferDefined(nextRun.modelOverrides, prevRun.modelOverrides),
    resolvedModels: preferDefined(nextRun.resolvedModels, prevRun.resolvedModels),
    completionStatus: preferDefined(nextRun.completionStatus, prevRun.completionStatus),
    instruction: runInstruction({
      instruction: preferDefined(nextRun.instruction, prevRun.instruction),
      messages: preferRicherArray(nextRun.messages, prevRun.messages),
    }),
  };
}

function mergeRunIntoMap(run) {
  if (!run || !run.runId) return null;
  var merged = mergeRunRecord(runsMap[run.runId], run);
  runsMap[run.runId] = merged;
  if (typeof syncTimelineFromRun === 'function') syncTimelineFromRun(run.runId, merged);
  return merged;
}

function saveSelectedRunId() {
  try {
    if (selectedRunId) localStorage.setItem(SELECTED_RUN_STORAGE_KEY, selectedRunId);
    else localStorage.removeItem(SELECTED_RUN_STORAGE_KEY);
  } catch(e) {}
}

function sortedRuns() {
  return Object.values(runsMap).sort(function(a,b){ return (b.savedAt||'').localeCompare(a.savedAt||''); });
}

function ensureSelectedRun() {
  if (selectedRunId && runsMap[selectedRunId]) return;
  var all = sortedRuns();
  selectedRunId = all.length ? all[0].runId : null;
  saveSelectedRunId();
}

function refreshRunDetails(runId) {
  if (!runId) return Promise.resolve();
  return fetch('/api/runs/' + runId)
    .then(function(res){ return res.json(); })
    .then(function(run){
      mergeRunIntoMap(run);
      renderChatList();
      if (selectedRunId === run.runId) renderChatThread();
      syncComposerUi();
    })
    .catch(function(){});
}

for (var si = 0; si < SEED.length; si++) runsMap[SEED[si].runId] = SEED[si];

function refreshRunsFromApi() {
  fetch('/api/runs?limit=50')
    .then(function(r){ return r.json(); })
    .then(function(list){
      for (var i = 0; i < list.length; i++) {
        mergeRunIntoMap(list[i]);
      }
      ensureSelectedRun();
      renderChatList();
      if (selectedRunId && runsMap[selectedRunId]) renderChatThread();
    }).catch(function(){});
}

function humanTitle(r) {
  if (titleOverrides[r.runId]) return titleOverrides[r.runId];
  var ins = (r.instruction || '').trim();
  if (!ins) return 'Untitled chat';
  var line = ins.split('\\n')[0].trim();
  if (line.length > 58) line = line.slice(0, 55) + '\\u2026';
  return line;
}

function renameChat(runId) {
  var current = humanTitle(runsMap[runId] || { runId: runId });
  var newName = prompt('Rename chat:', current);
  if (newName === null) return;
  newName = newName.trim();
  if (!newName) {
    delete titleOverrides[runId];
  } else {
    titleOverrides[runId] = newName;
  }
  try { localStorage.setItem('shipyard_titles', JSON.stringify(titleOverrides)); } catch(e) {}
  renderChatList();
  if (selectedRunId === runId) renderChatThread();
}

function deleteChat(runId) {
  if (!runId) return;
  fetch('/api/runs/' + encodeURIComponent(runId), { method: 'DELETE' })
    .then(function (r) {
      return r.json().then(function (body) {
        return { ok: r.ok, status: r.status, body: body };
      });
    })
    .then(function (x) {
      if (!x.ok) {
        var msg = (x.body && x.body.error) ? x.body.error : 'Delete failed';
        var st = document.getElementById('subSt');
        if (st) st.textContent = msg;
        return;
      }
      var stOk = document.getElementById('subSt');
      if (stOk) stOk.textContent = '';
      delete titleOverrides[runId];
      try { localStorage.setItem('shipyard_titles', JSON.stringify(titleOverrides)); } catch (e) {}
      delete runsMap[runId];
      if (typeof clearRunTimeline === 'function') clearRunTimeline(runId);
      if (selectedRunId === runId) selectedRunId = null;
      ensureSelectedRun();
      renderChatList();
      renderChatThread();
      syncComposerUi();
    })
    .catch(function () {
      var st = document.getElementById('subSt');
      if (st) st.textContent = 'Delete failed';
    });
}

function renderChatList() {
  var el = document.getElementById('chatList');
  if (!el) return;
  var all = sortedRuns();
  if (all.length === 0) {
    el.innerHTML = renderEmptyState('No chats yet. Send a message below.');
    return;
  }
  el.innerHTML = all.map(function(r) {
    var sa = startedAt(r);
    var startStr = sa ? fmtDate(sa) : (r.savedAt ? fmtDate(r.savedAt) : '—');
    var title = esc(humanTitle(r));
    var kind = r.threadKind ? (' · ' + r.threadKind) : '';
    var sub = esc(r.phase) + kind + ' · ' + startStr;
    var active = selectedRunId === r.runId ? ' active' : '';
    return '<div class="chat-item-wrap' + active + '">' +
      '<button type="button" class="chat-item-body" data-action="selectChat" data-rid="' + esc(r.runId) + '">' +
        '<div class="chat-item-title">' + title + '</div>' +
        '<div class="chat-item-sub">' + sub + '</div>' +
      '</button>' +
      '<div class="chat-item-actions">' +
        '<button type="button" class="chat-act" data-action="renameChat" data-rid="' + esc(r.runId) + '">Rename</button>' +
        '<button type="button" class="chat-act chat-act-del" data-action="deleteChat" data-rid="' + esc(r.runId) + '">Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function followupMode() {
  var r = selectedRunId ? runsMap[selectedRunId] : null;
  return !!(r && r.threadKind);
}

function updateComposerSendVisibility() {
  var ta = document.getElementById('instr');
  var btn = document.getElementById('subBtn');
  if (!ta || !btn) return;
  var has = ta.value.trim().length > 0;
  if (has) btn.classList.remove('composer-send-hidden');
  else btn.classList.add('composer-send-hidden');
}

function syncComposerPrimaryButton() {
  var btn = document.getElementById('subBtn');
  if (!btn) return;
  var icon = btn.querySelector('.composer-btn-icon');
  if (!icon) {
    btn.innerHTML = '<span class="composer-btn-icon" aria-hidden="true"></span>';
    icon = btn.querySelector('.composer-btn-icon');
  }
  btn.dataset.action = 'submit';
  btn.className = 'btn btn-p composer-send composer-send-hidden';
  icon.textContent = '\\u25b6';
  if (followupMode()) {
    btn.setAttribute('aria-label', 'Send follow-up');
    btn.setAttribute('title', 'Send follow-up (Ctrl+Enter)');
  } else {
    btn.setAttribute('aria-label', 'Submit run');
    btn.setAttribute('title', 'Submit run (Ctrl+Enter)');
  }
  updateComposerSendVisibility();
}

function syncStopButton() {
  var btn = document.getElementById('stopBtn');
  if (!btn) return;
  var ph = lastState.phase;
  var active = ph && ['done', 'error', 'idle'].indexOf(ph) < 0;
  var awaiting = ph === 'awaiting_confirmation';
  var show = !!(active && curRunId && selectedRunId === curRunId && !awaiting);
  btn.style.display = show ? 'inline-flex' : 'none';
}

function syncComposerUi() {
  var ta = document.getElementById('instr');
  var hint = document.getElementById('composerHint');
  var r = selectedRunId ? runsMap[selectedRunId] : null;
  if (followupMode()) {
    var kind = r && r.threadKind ? String(r.threadKind) : 'selected';
    if (ta) ta.placeholder = 'Follow up in this ' + kind + ' thread…';
    if (hint) {
      hint.style.display = 'block';
      hint.textContent = 'Follow-ups append to the selected ' + kind + ' thread.';
    }
  } else {
    if (ta) ta.placeholder = 'Message…';
    if (hint) hint.style.display = 'none';
  }
  syncComposerPrimaryButton();
  syncStopButton();
}

function threadFoldOpen(runId, section, defaultOpen) {
  var k = runId + ':' + section;
  if (threadExpand[k] === undefined) return defaultOpen;
  return threadExpand[k];
}

function renderCollapsible(runId, section, title, inner, defaultOpen) {
  var open = threadFoldOpen(runId, section, defaultOpen);
  var chev = open ? '&#9660;' : '&#9654;';
  var display = open ? 'block' : 'none';
  return '<div class="thread-fold">' +
    '<button type="button" class="thread-fold-hd" data-action="toggleThread" data-section="' + esc(section) + '" data-rid="' + esc(runId) + '">' +
    '<span class="thread-fold-chev">' + chev + '</span><span>' + esc(title) + '</span></button>' +
    '<div class="thread-fold-bd" style="display:' + display + '">' + inner + '</div></div>';
}

function renderToolHistory(r) {
  var tch = r.toolCallHistory || [];
  if (!tch.length) return '<span style="color:var(--muted)">No tool calls recorded</span>';
  var h = '<div>';
  for (var i = 0; i < tch.length; i++) {
    var tc = tch[i];
    var ok = !(tc.tool_result || '').startsWith('Error');
    var fp = tc.tool_input && tc.tool_input.file_path ? esc(shortP(String(tc.tool_input.file_path))) : '';
    var inp = fp || esc(JSON.stringify(tc.tool_input || {}).slice(0, 120));
    h += '<div class="trow">' +
      '<span class="tname">' + esc(tc.tool_name) + '</span>' +
      '<span style="color:' + (ok ? 'var(--green)' : 'var(--red)') + ';font-size:10px">' + (ok ? 'ok' : 'fail') + '</span>' +
      '<span style="color:var(--dim);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + inp + '</span>' +
      '<span style="color:var(--dim);font-size:10px;flex-shrink:0">' + (tc.duration_ms || 0) + 'ms</span></div>';
  }
  h += '</div>';
  return h;
}

function renderChatThread() {
  renderTimeline();
}

function selectChat(runId) {
  if (!runId) return;
  selectedRunId = runId;
  saveSelectedRunId();
  renderChatList();
  renderChatThread();
  void refreshRunDetails(runId);
}

function newChat() {
  selectedRunId = null;
  saveSelectedRunId();
  renderChatList();
  renderChatThread();
  syncComposerUi();
}

function switchSideTab(tab) {
  var chatsTab = document.getElementById('sideTabChats');
  var settingsTab = document.getElementById('sideTabSettings');
  var chatsPanel = document.getElementById('sidePanelChats');
  var settingsPanel = document.getElementById('sidePanelSettings');
  var showSettings = tab === 'settings';
  if (chatsTab) {
    chatsTab.classList.toggle('active', !showSettings);
    chatsTab.setAttribute('aria-selected', showSettings ? 'false' : 'true');
  }
  if (settingsTab) {
    settingsTab.classList.toggle('active', showSettings);
    settingsTab.setAttribute('aria-selected', showSettings ? 'true' : 'false');
  }
  if (chatsPanel) chatsPanel.classList.toggle('active', !showSettings);
  if (settingsPanel) settingsPanel.classList.toggle('active', showSettings);
  if (showSettings) refreshCheckpoints();
  selectedSideTab = showSettings ? 'settings' : 'chats';
  try { localStorage.setItem(SELECTED_SIDETAB_STORAGE_KEY, selectedSideTab); } catch(e) {}
}

function settingsStatusText() {
  var branch = settingsStatus.repoBranch ? settingsStatus.repoBranch : 'unknown';
  var remote = settingsStatus.repoRemote ? settingsStatus.repoRemote : 'none';
  var gh = settingsStatus.ghAuthenticated ? 'yes' : 'no';
  return 'workdir: ' + settingsStatus.workDir + '\\nbranch: ' + branch + '\\norigin: ' + remote + '\\ngh cli auth: ' + gh;
}

function renderSettingsStatus() {
  var ghStatus = document.getElementById('ghStatus');
  var ghAuth = document.getElementById('ghAuthStatus');
  var ghConnBadge = document.getElementById('ghConnBadge');
  var ghSetupAlert = document.getElementById('ghSetupAlert');
  var ghStepServer = document.getElementById('ghStepServer');
  var ghStepAuth = document.getElementById('ghStepAuth');
  var ghStepRepo = document.getElementById('ghStepRepo');
  var oauthBtn = document.querySelector('[data-action="startGithubOAuth"]');
  var repoSel = document.getElementById('ghRepoSel');
  var hasRepoSel = !!(repoSel && repoSel.value);
  if (ghAuth) {
    if (!settingsStatus.githubInstallConfigured) {
      ghAuth.textContent = 'GitHub App install flow not configured. Add GITHUB_APP_SLUG and setup URL.';
    } else if (settingsStatus.githubConnected && settingsStatus.githubInstallationId) {
      ghAuth.textContent = 'GitHub App installed' + (settingsStatus.githubLogin ? (' as @' + settingsStatus.githubLogin) : '') + ' (installation #' + settingsStatus.githubInstallationId + ')';
    } else if (settingsStatus.githubConnected) {
      ghAuth.textContent = 'Connected as @' + (settingsStatus.githubLogin || 'unknown');
    } else {
      ghAuth.textContent = 'Not connected';
    }
  }
  if (ghConnBadge) {
    setBadge(ghConnBadge, settingsStatus.githubConnected ? 'Connected' : 'Disconnected', settingsStatus.githubConnected ? 'ok' : 'off');
  }
  if (ghStepServer) ghStepServer.textContent = settingsStatus.githubInstallConfigured ? 'Server config: GitHub App install ready' : 'Server config: missing GITHUB_APP_SLUG / setup URL';
  if (ghStepAuth) ghStepAuth.textContent = settingsStatus.githubConnected ? ('GitHub auth: @' + (settingsStatus.githubLogin || 'connected')) : 'GitHub auth: not connected';
  if (ghStepRepo) ghStepRepo.textContent = hasRepoSel ? ('Repository selected: ' + repoSel.value) : 'Repository selected: none';
  if (oauthBtn) {
    oauthBtn.disabled = false;
    oauthBtn.title = settingsStatus.githubInstallConfigured ? 'Install/select repos via GitHub App' : 'Configure GitHub App first';
  }
  if (ghSetupAlert) {
    if (!settingsStatus.githubInstallConfigured) {
      ghSetupAlert.style.display = 'block';
      ghSetupAlert.textContent = 'Proper auth setup: 1) set GITHUB_APP_SLUG, 2) set GitHub App Setup URL to /api/github/install/callback, 3) set GITHUB_APP_CLIENT_ID (or GITHUB_APP_ID) + GITHUB_APP_PRIVATE_KEY. Optional identity link: GITHUB_APP_CLIENT_SECRET.';
    } else {
      ghSetupAlert.style.display = 'none';
      ghSetupAlert.textContent = '';
    }
  }
  if (ghStatus) ghStatus.textContent = settingsStatusText();
}

function restoreSettingsInputs() {
  // Do not restore secrets from browser storage.
  restoreDashboardInput('ghAppSlugInput', GH_APP_SLUG_STORAGE);
  restoreDashboardInput('ghAppIdInput', GH_APP_ID_STORAGE);
}

function persistSettingsInputs() {
  // Do not persist secrets to browser storage.
  persistDashboardInput('ghAppSlugInput', GH_APP_SLUG_STORAGE);
  persistDashboardInput('ghAppIdInput', GH_APP_ID_STORAGE);
}

function refreshSettingsStatus() {
  return fetch('/api/settings/status')
    .then(function(res){ return res.json(); })
    .then(function(data){
      settingsStatus = {
        workDir: data.workDir || WORK_DIR,
        repoBranch: data.repoBranch || null,
        repoRemote: data.repoRemote || null,
        ghAuthenticated: !!data.ghAuthenticated,
        githubConnected: !!data.githubConnected,
        githubLogin: data.githubLogin || null,
        githubOAuthConfigured: !!data.githubOAuthConfigured,
        githubInstallConfigured: !!data.githubInstallConfigured,
        githubAppConfigured: !!data.githubAppConfigured,
        githubAppSlug: data.githubAppSlug || null,
        githubInstallationId: data.githubInstallationId || null,
      };
      WORK_DIR = settingsStatus.workDir || WORK_DIR;
      renderSettingsStatus();
    })
    .catch(function(){});
}

function saveModelKeys() {
  var anth = document.getElementById('anthropicKeyInput');
  var oai = document.getElementById('openaiKeyInput');
  var st = document.getElementById('modelKeyStatus');
  persistSettingsInputs();
  var body = {
    anthropicApiKey: anth ? anth.value.trim() : '',
    openaiApiKey: oai ? oai.value.trim() : '',
  };
  fetch('/api/settings/model-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function(res){ return res.json(); })
    .then(function(data){
      if (!data.ok) {
        if (st) st.textContent = 'Key update failed';
        return;
      }
      if (st) st.textContent = 'Keys applied (runtime only for current server process).';
    })
    .catch(function(err){
      if (st) st.textContent = 'Key update failed: ' + err.message;
    });
}

function refreshCheckpoints() {
  var sel = document.getElementById('checkpointSel');
  var st = document.getElementById('checkpointStatus');
  if (st) st.textContent = 'Loading checkpoints...';
  return fetch('/api/checkpoints?limit=20')
    .then(function(res){ return res.json(); })
    .then(function(data){
      var cps = Array.isArray(data.checkpoints) ? data.checkpoints : [];
      if (sel) {
        sel.innerHTML = cps.length
          ? cps.map(function(cp){
              var label = cp.label ? ('[' + cp.label + '] ') : '';
              var text = label + cp.checkpoint_id + ' · files=' + cp.file_count;
              return '<option value="' + esc(cp.checkpoint_id) + '">' + esc(text) + '</option>';
            }).join('')
          : '<option value="">(none)</option>';
      }
      if (st) st.textContent = cps.length ? ('Loaded ' + cps.length + ' checkpoint(s).') : 'No checkpoints yet.';
    })
    .catch(function(err){
      if (st) st.textContent = 'Checkpoint load failed: ' + err.message;
    });
}

function createCheckpointUi() {
  var st = document.getElementById('checkpointStatus');
  if (st) st.textContent = 'Creating checkpoint...';
  fetch('/api/checkpoints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
    .then(function(res){ return res.json().then(function(body){ return { ok: res.ok, body: body }; }); })
    .then(function(x){
      if (!x.ok) throw new Error(x.body && x.body.message ? x.body.message : (x.body && x.body.error ? x.body.error : 'Failed'));
      if (st) st.textContent = x.body.message || 'Checkpoint created.';
      refreshCheckpoints();
    })
    .catch(function(err){
      if (st) st.textContent = 'Checkpoint create failed: ' + err.message;
    });
}

function rollbackCheckpointUi() {
  var sel = document.getElementById('checkpointSel');
  var st = document.getElementById('checkpointStatus');
  var checkpointId = sel ? sel.value : '';
  if (!checkpointId) {
    if (st) st.textContent = 'Select a checkpoint first.';
    return;
  }
  if (!window.confirm('Rollback workspace files from checkpoint ' + checkpointId + '?')) return;
  if (st) st.textContent = 'Rolling back checkpoint...';
  fetch('/api/checkpoints/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkpointId: checkpointId }),
  })
    .then(function(res){ return res.json().then(function(body){ return { ok: res.ok, body: body }; }); })
    .then(function(x){
      if (!x.ok) throw new Error(x.body && x.body.message ? x.body.message : (x.body && x.body.error ? x.body.error : 'Failed'));
      if (st) st.textContent = x.body.message || 'Rollback completed.';
      refreshCheckpoints();
    })
    .catch(function(err){
      if (st) st.textContent = 'Rollback failed: ' + err.message;
    });
}

function startGithubOAuth() {
  var st = document.getElementById('ghStatus');
  if (!settingsStatus.githubInstallConfigured) {
    var wrap = document.getElementById('ghAppCfgWrap');
    if (wrap) wrap.style.display = 'block';
    if (st) st.textContent = 'Configure and save GitHub App fields first.';
    return;
  }
  var w = window.open('/api/github/install/start', 'shipyard_github_oauth', 'width=760,height=860');
  if (!w) {
    if (st) st.textContent = 'Popup blocked. Allow popups and retry.';
    return;
  }
  if (st) st.textContent = 'Waiting for GitHub App install...';
}

function toggleGithubAppConfig() {
  var wrap = document.getElementById('ghAppCfgWrap');
  if (!wrap) return;
  wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
}

function saveGithubAppConfig() {
  var slugEl = document.getElementById('ghAppSlugInput');
  var idEl = document.getElementById('ghAppIdInput');
  var pkEl = document.getElementById('ghAppPkInput');
  var st = document.getElementById('ghAppCfgStatus');
  persistSettingsInputs();
  fetch('/api/settings/github-app', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: slugEl ? slugEl.value.trim() : '',
      appId: idEl ? idEl.value.trim() : '',
      privateKey: pkEl ? pkEl.value.trim() : '',
    }),
  })
    .then(function(res){ return res.json(); })
    .then(function(data){
      if (!data.ok) {
        if (st) st.textContent = 'Save failed';
        return;
      }
      if (st) st.textContent = 'Saved. You can now click Connect GitHub.';
      refreshSettingsStatus();
    })
    .catch(function(err){
      if (st) st.textContent = 'Save failed: ' + err.message;
    });
}

function logoutGithubOAuth() {
  var st = document.getElementById('ghStatus');
  fetch('/api/github/install/logout', { method: 'POST' })
    .then(function(res){ return res.json(); })
    .then(function(data){
      if (!data.ok) {
        if (st) st.textContent = 'Logout failed';
        return;
      }
      if (st) st.textContent = 'Disconnected GitHub OAuth session.';
      refreshSettingsStatus();
      var sel = document.getElementById('ghRepoSel');
      if (sel) sel.innerHTML = '<option value="">(load repos first)</option>';
    })
    .catch(function(err){
      if (st) st.textContent = 'Logout failed: ' + err.message;
    });
}

function githubFallbackToken() {
  return '';
}

function loadGithubRepos() {
  var queryEl = document.getElementById('ghRepoSearchInput');
  var query = queryEl ? queryEl.value.trim() : '';
  var sel = document.getElementById('ghRepoSel');
  var st = document.getElementById('ghStatus');
  if (st) st.textContent = 'Loading repositories...';
  fetch('/api/github/repos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query }),
  })
    .then(function(res){
      return res.json().then(function(body){ return { ok: res.ok, body: body }; });
    })
    .then(function(x){
      if (!x.ok) throw new Error(x.body && x.body.error ? x.body.error : 'Failed to load repositories');
      var data = x.body || {};
      var repos = Array.isArray(data.repos) ? data.repos : [];
      if (sel) {
        sel.innerHTML = repos.length
          ? repos.map(function(r){ return '<option value="' + esc(r.full_name) + '">' + esc(r.full_name) + '</option>'; }).join('')
          : '<option value="">(no repos found)</option>';
      }
      var saved = loadDashboardPref(GH_REPO_STORAGE);
      if (saved && sel) {
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === saved) sel.value = saved;
        }
      }
      renderSettingsStatus();
      if (st) st.textContent = repos.length ? ('Loaded ' + repos.length + ' repos.') : 'No repos found. Try a different query or check repository permissions.';
    })
    .catch(function(err){
      if (st) st.textContent = 'Repo load failed: ' + err.message;
    });
}

function connectGithubRepo() {
  var sel = document.getElementById('ghRepoSel');
  var repo = sel ? sel.value : '';
  var st = document.getElementById('ghStatus');
  if (!repo) {
    if (st) st.textContent = 'Select a repository first.';
    return;
  }
  saveDashboardPref(GH_REPO_STORAGE, repo);
  if (st) st.textContent = 'Connecting ' + repo + '...';
  fetch('/api/github/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoFullName: repo }),
  })
    .then(function(res){
      return res.json().then(function(body){ return { ok: res.ok, body: body }; });
    })
    .then(function(x){
      if (!x.ok) {
        if (st) st.textContent = (x.body && x.body.error) ? x.body.error : 'Connect failed';
        return;
      }
      var data = x.body || {};
      settingsStatus.workDir = data.workDir;
      settingsStatus.repoBranch = data.branch || null;
      settingsStatus.repoRemote = 'https://github.com/' + repo + '.git';
      WORK_DIR = data.workDir || WORK_DIR;
      renderSettingsStatus();
      refreshRunsFromApi();
      if (st) st.textContent = 'Connected to ' + repo + ' at ' + data.workDir;
    })
    .catch(function(err){
      if (st) st.textContent = 'Connect failed: ' + err.message;
    });
}

// ---- helpers ----
${getSharedHelperScript()}
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/\\x3c/g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function shortP(p) {
  if (!p) return '';
  return (WORK_DIR && p.indexOf(WORK_DIR) === 0) ? p.slice(WORK_DIR.length).replace(/^\\//, '') : p;
}
function fmtDur(ms) {
  if (!ms) return '—';
  return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
}
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    var d = new Date(iso);
    return d.toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch(e) { return iso; }
}
function startedAt(r) {
  if (!r.savedAt || !r.durationMs) return null;
  return new Date(new Date(r.savedAt).getTime() - r.durationMs).toISOString();
}
function phCls(p) {
  var m = { done:'pp-done', error:'pp-error', routing:'pp-routing', planning:'pp-planning', executing:'pp-executing', verifying:'pp-verifying', reviewing:'pp-reviewing', idle:'pp-idle', awaiting_confirmation:'pp-awaiting_confirmation', paused:'pp-paused' };
  return m[p] || 'pp-idle';
}

// ---- event delegation ----
document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  var action = btn.dataset.action;
  if (handleRetryAction(action)) return;
  if (action === 'submit') { e.preventDefault(); submitRun(); return; }
  if (action === 'newChat') { e.preventDefault(); newChat(); return; }
  if (action === 'sideTab') {
    e.preventDefault();
    switchSideTab(btn.dataset.tab || 'chats');
    return;
  }
  if (action === 'saveModelKeys') {
    e.preventDefault();
    saveModelKeys();
    return;
  }
  if (action === 'refreshCheckpoints') {
    e.preventDefault();
    refreshCheckpoints();
    return;
  }
  if (action === 'createCheckpoint') {
    e.preventDefault();
    createCheckpointUi();
    return;
  }
  if (action === 'rollbackCheckpoint') {
    e.preventDefault();
    rollbackCheckpointUi();
    return;
  }
  if (action === 'loadGithubRepos') {
    e.preventDefault();
    loadGithubRepos();
    return;
  }
  if (action === 'connectGithubRepo') {
    e.preventDefault();
    connectGithubRepo();
    return;
  }
  if (action === 'startGithubOAuth') {
    e.preventDefault();
    startGithubOAuth();
    return;
  }
  if (action === 'logoutGithubOAuth') {
    e.preventDefault();
    logoutGithubOAuth();
    return;
  }
  if (action === 'toggleGithubAppConfig') {
    e.preventDefault();
    toggleGithubAppConfig();
    return;
  }
  if (action === 'saveGithubAppConfig') {
    e.preventDefault();
    saveGithubAppConfig();
    return;
  }
  if (action === 'renameChat') {
    e.preventDefault();
    e.stopPropagation();
    var renId = btn.dataset.rid;
    if (renId) renameChat(renId);
    return;
  }
  if (action === 'deleteChat') {
    e.preventDefault();
    e.stopPropagation();
    var delId = btn.dataset.rid;
    if (delId) deleteChat(delId);
    return;
  }
  if (action === 'openDebug') {
    e.preventDefault();
    e.stopPropagation();
    openRunDebug(btn.dataset.rid || selectedRunId);
    return;
  }
  if (action === 'closeRunDebug') {
    e.preventDefault();
    closeRunDebug();
    return;
  }
  if (action === 'openDebugLink') {
    e.preventDefault();
    e.stopPropagation();
    if (btn.dataset.url) window.open(btn.dataset.url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (action === 'copyDebugLink') {
    e.preventDefault();
    e.stopPropagation();
    copyRunDebugLink(btn.dataset.url || '');
    return;
  }
  if (action === 'selectChat') {
    var selId = btn.dataset.rid;
    if (selId) selectChat(selId);
    return;
  }
  if (action === 'togglePlanDoc') {
    var pw = document.getElementById('planDocWrap');
    if (pw) pw.style.display = pw.style.display === 'none' ? 'block' : 'none';
    btn.textContent = pw && pw.style.display !== 'none' ? '— Hide plan document' : '+ Attach plan document';
    return;
  }
  if (action === 'confirmPlan') {
    var rid = btn.dataset.rid;
    if (rid) confirmPlanForRun(rid);
    return;
  }
  if (action === 'toggleTl') {
    var row = document.getElementById('tl-' + btn.dataset.idx);
    if (row) row.classList.toggle('collapsed');
    return;
  }
  if (action === 'toggleThread') {
    e.preventDefault();
    var trid = btn.dataset.rid;
    var sec = btn.dataset.section;
    var bd = btn.nextElementSibling;
    if (!bd || !trid || !sec) return;
    var isOpen = bd.style.display !== 'none';
    var nowOpen = !isOpen;
    bd.style.display = nowOpen ? 'block' : 'none';
    threadExpand[trid + ':' + sec] = nowOpen;
    var chev = btn.querySelector('.thread-fold-chev');
    if (chev) chev.textContent = nowOpen ? '\u25BC' : '\u25B6';
    return;
  }
  if (action === 'applyNextAction') {
    e.preventDefault();
    e.stopPropagation();
    var prompt = btn.dataset.prompt || '';
    var ta = document.getElementById('instr');
    if (ta && prompt) {
      ta.value = prompt;
      ta.focus();
      updateComposerSendVisibility();
    }
    return;
  }
  if (action === 'toggleProgressMetrics') {
    e.preventDefault();
    if (typeof progressMetricsVisible !== 'undefined') {
      progressMetricsVisible = !progressMetricsVisible;
      if (typeof renderTimeline === 'function') renderTimeline();
    }
    return;
  }
  var row = btn.closest('[data-rid]');
  var runId = row ? row.dataset.rid : null;
  if (action === 'stop') { e.stopPropagation(); e.preventDefault(); stopRun(); return; }
  if (action === 'resume' && runId) { e.stopPropagation(); resumeRunById(runId); }
});

// ---- controls ----
function stopRun() {
  var st = document.getElementById('subSt');
  fetch('/api/cancel', { method:'POST' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (st) st.textContent = d.cancelled ? 'Stop requested' : 'No active run to stop';
      fetch('/api/runs?limit=30')
        .then(function (r2) { return r2.json(); })
        .then(function (list) {
          for (var i = 0; i < list.length; i++) {
            mergeRunIntoMap(list[i]);
          }
          renderChatList();
          if (selectedRunId) renderChatThread();
          if (selectedRunId) void refreshRunDetails(selectedRunId);
        })
        .catch(function () {});
    })
    .catch(function () { if (st) st.textContent = 'Stop failed'; });
}
function resumeRunById(runId) {
  fetch('/api/runs/' + runId + '/resume', { method:'POST' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      document.getElementById('subSt').textContent = d.runId ? ('Resumed ' + d.runId.slice(0,8)) : ('Error: ' + (d.error||'unknown'));
    }).catch(function(e){ document.getElementById('subSt').textContent = 'Error: ' + e.message; });
}
function submitRun() {
  var ta = document.getElementById('instr');
  var btn = document.getElementById('subBtn');
  var st = document.getElementById('subSt');
  var pdTa = document.getElementById('planDoc');
  var inst = ta.value.trim();
  if (!inst) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  st.textContent = '';
  if (followupMode()) {
    var fuId = selectedRunId;
    var followupBody = { instruction: inst };
    var followupModelEl = document.getElementById('modelSel');
    followupBody.model = '';
    if (followupModelEl) followupBody.model = followupModelEl.value;
    fetch('/api/runs/' + fuId + '/followup', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(followupBody) })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d.queued) {
          st.textContent = '';
          if (d.phase === 'done' && Array.isArray(d.messages)) {
            var cur = runsMap[fuId] || { runId: fuId };
            curRunId = null;
            lastState = Object.assign({}, lastState, { runId: fuId, phase: 'done' });
            runsMap[fuId] = mergeRunRecord(cur, {
              runId: fuId,
              phase: d.phase,
              threadKind: d.threadKind || cur.threadKind || 'ask',
              messages: d.messages,
              traceUrl: d.traceUrl !== undefined ? d.traceUrl : cur.traceUrl,
              tokenUsage: d.tokenUsage !== undefined ? d.tokenUsage : cur.tokenUsage,
              error: d.error !== undefined ? d.error : cur.error,
              verificationResult: d.verificationResult !== undefined ? d.verificationResult : cur.verificationResult,
              reviewFeedback: d.reviewFeedback !== undefined ? d.reviewFeedback : cur.reviewFeedback,
              nextActions: d.nextActions !== undefined ? d.nextActions : cur.nextActions,
              durationMs: cur.durationMs,
            });
          } else {
            var ex = runsMap[fuId] || { runId: fuId };
            var prev = Array.isArray(ex.messages) ? ex.messages.slice() : [];
            var queuedPhase = ex.threadKind === 'ask' ? 'routing' : 'planning';
            prev.push({ role: 'user', content: inst });
            curRunId = fuId;
            lastState = Object.assign({}, lastState, { runId: fuId, phase: queuedPhase });
            runsMap[fuId] = mergeRunRecord(ex, { runId: fuId, messages: prev, phase: queuedPhase });
            if (typeof syncTimelineFromRun === 'function') syncTimelineFromRun(fuId, runsMap[fuId]);
          }
          ta.value = '';
          renderChatList();
          renderChatThread();
        } else st.textContent = 'Error: ' + (d.error||'unknown');
      })
      .catch(function(e){ st.textContent = 'Error: ' + e.message; })
      .finally(function(){ btn.disabled = false; btn.removeAttribute('aria-busy'); syncComposerUi(); });
    return;
  }
  var body = { instruction: inst };
  var pdVal = pdTa ? pdTa.value.trim() : '';
  if (pdVal) body.planDoc = pdVal;
  var uiEl = document.getElementById('uiModeSel');
  if (uiEl && uiEl.value) body.uiMode = uiEl.value;
  else body.runMode = 'auto';
  var mdEl = document.getElementById('modelSel');
  if (mdEl && mdEl.value) body.model = mdEl.value;
  persistDashboardModeSel();
  persistDashboardModelSel();
  fetch('/api/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.runId) {
        selectedRunId = d.runId;
        saveSelectedRunId();
        st.textContent = '';
        var initPhase = d.phase || (d.runMode === 'code' ? 'planning' : 'routing');
        curRunId = d.runId;
        lastState = Object.assign({}, lastState, { runId: d.runId, phase: initPhase });
        var existing = runsMap[d.runId] || {};
        runsMap[d.runId] = mergeRunRecord(existing, {
          runId: d.runId,
          phase: initPhase,
          threadKind: d.threadKind || existing.threadKind || ((d.runMode === 'chat' || d.phase === 'done') ? 'ask' : undefined),
          instruction: inst,
          messages: Array.isArray(d.messages) ? d.messages : [{ role: 'user', content: inst }],
          traceUrl: d.traceUrl !== undefined ? d.traceUrl : existing.traceUrl,
          tokenUsage: d.tokenUsage !== undefined ? d.tokenUsage : existing.tokenUsage,
          error: d.error !== undefined ? d.error : existing.error,
          verificationResult: d.verificationResult !== undefined ? d.verificationResult : existing.verificationResult,
          reviewFeedback: d.reviewFeedback !== undefined ? d.reviewFeedback : existing.reviewFeedback,
          nextActions: d.nextActions !== undefined ? d.nextActions : existing.nextActions,
          savedAt: new Date().toISOString()
        });
        if (typeof syncTimelineFromRun === 'function') syncTimelineFromRun(d.runId, runsMap[d.runId]);
        renderChatList();
        renderChatThread();
        ta.value = '';
        if (pdTa) pdTa.value = '';
      }
      else st.textContent = 'Error: ' + (d.error||'unknown');
    })
    .catch(function(e){ st.textContent = 'Error: ' + e.message; })
    .finally(function(){ btn.disabled=false; btn.removeAttribute('aria-busy'); syncComposerUi(); });
}

function confirmPlanForRun(runId) {
  var st = document.getElementById('subSt');
  fetch('/api/runs/' + runId + '/confirm', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({})
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.confirmed) {
        if (st) st.textContent = 'Plan confirmed, executing…';
        if (runId) selectChat(runId);
      }
      else { if (st) st.textContent = 'Error: ' + (d.error||'unknown'); }
    })
    .catch(function(e){ if (st) st.textContent = 'Error: ' + e.message; });
}

// ---- WS ----
function connectWs() {
  var proto = location.protocol==='https:' ? 'wss:' : 'ws:';
  var ws = new WebSocket(proto + '//' + location.host + '/ws');
  var dot = document.getElementById('wsDot');
  var lbl = document.getElementById('wsLbl');
  ws.onopen = function(){ dot.className='wsdot on'; lbl.textContent='live'; };
  ws.onclose = function(){ dot.className='wsdot off'; lbl.textContent='reconnecting'; setTimeout(connectWs, 3000); };
  ws.onerror = function(){ ws.close(); };
  ws.onmessage = function(e){
    try {
      var msg = JSON.parse(e.data);
      if (msg.type==='file_edit') onFeedEvent({ type:'file_edit', data:msg.data });
      else if (msg.type==='tool_activity') onFeedEvent({ type:'tool_activity', data:msg.data });
      else if (msg.type==='text_chunk') onTextChunk(msg.data);
      else if (msg.type==='state_update') onStateUpdate(msg.data);
    } catch(ex){}
  };
}

function onStateUpdate(s) {
  lastState = Object.assign({}, lastState, s);
  if (s.runId) curRunId = s.runId;
  var ph = lastState.phase;
  var active = ph && ['done', 'error', 'idle'].indexOf(ph) < 0;
  if (!active) {
    curRunId = null;
  }
  // Push timeline entries for phase/verification/review
  if (s.runId && s.phase) pushPhaseEntry(s.runId, s.phase);
  if (s.runId && s.verificationResult) pushVerificationEntry(s.runId, s.verificationResult);
  if (s.runId && s.reviewFeedback) pushReviewEntry(s.runId, s.reviewFeedback);
  // Update run in map
  if (s.runId) {
    var existing = runsMap[s.runId];
    if (existing) {
      runsMap[s.runId] = mergeRunRecord(existing, {
        runId: s.runId,
        phase: s.phase || existing.phase,
        steps: s.steps || existing.steps,
        fileEdits: s.fileEdits || existing.fileEdits,
        toolCallHistory: s.toolCallHistory || existing.toolCallHistory,
        tokenUsage: s.tokenUsage || existing.tokenUsage,
        error: s.error !== undefined ? s.error : existing.error,
        verificationResult: s.verificationResult !== undefined ? s.verificationResult : existing.verificationResult,
        reviewFeedback: s.reviewFeedback !== undefined ? s.reviewFeedback : existing.reviewFeedback,
        nextActions: s.nextActions !== undefined ? s.nextActions : existing.nextActions,
        messages: Array.isArray(s.messages) ? (s.messages.length ? s.messages : (existing.messages || [])) : (existing.messages || []),
        threadKind: s.threadKind || existing.threadKind,
        completionStatus: s.completionStatus || existing.completionStatus,
      });
    } else {
      void refreshRunDetails(s.runId);
    }
    if (existing && (s.phase === 'done' || s.phase === 'error')) {
      void refreshRunDetails(s.runId);
    }
    renderChatList();
    if (selectedRunId === s.runId) renderChatThread();
    syncComposerUi();
  }
}

${getRetryScript()}

// ---- init ----
ensureSelectedRun();
switchSideTab(selectedSideTab);
renderChatList();
renderChatThread();
refreshRunsFromApi();
restoreDashboardModeSel();
restoreDashboardModelSel();
restoreSettingsInputs();
syncComposerUi();
renderSettingsStatus();
void refreshSettingsStatus();
var uisel = document.getElementById('uiModeSel');
if (uisel) uisel.addEventListener('change', function(){ persistDashboardModeSel(); syncComposerUi(); });
var modelSelEl = document.getElementById('modelSel');
if (modelSelEl) modelSelEl.addEventListener('change', persistDashboardModelSel);
var anthKeyEl = document.getElementById('anthropicKeyInput');
if (anthKeyEl) anthKeyEl.addEventListener('change', persistSettingsInputs);
var oaiKeyEl = document.getElementById('openaiKeyInput');
if (oaiKeyEl) oaiKeyEl.addEventListener('change', persistSettingsInputs);
var ghTokenEl = document.getElementById('ghTokenInput');
if (ghTokenEl) ghTokenEl.addEventListener('change', persistSettingsInputs);
var ghAppSlugEl = document.getElementById('ghAppSlugInput');
if (ghAppSlugEl) ghAppSlugEl.addEventListener('change', persistSettingsInputs);
var ghAppIdEl = document.getElementById('ghAppIdInput');
if (ghAppIdEl) ghAppIdEl.addEventListener('change', persistSettingsInputs);
var ghAppPkEl = document.getElementById('ghAppPkInput');
if (ghAppPkEl) ghAppPkEl.addEventListener('change', persistSettingsInputs);
var ghRepoSel = document.getElementById('ghRepoSel');
if (ghRepoSel) ghRepoSel.addEventListener('change', function(){ saveDashboardPref(GH_REPO_STORAGE, ghRepoSel.value || ''); renderSettingsStatus(); });
window.addEventListener('message', function(ev){
  var data = ev && ev.data;
  if (!data || (data.type !== 'shipyard_github_oauth' && data.type !== 'shipyard_github_install')) return;
  var st = document.getElementById('ghStatus');
  if (data.ok) {
    if (st) st.textContent = 'GitHub connected as @' + (data.login || 'unknown');
    refreshSettingsStatus();
    loadGithubRepos();
  } else {
    if (st) st.textContent = data.message || 'GitHub OAuth failed';
    refreshSettingsStatus();
  }
});
var instrEl = document.getElementById('instr');
if (instrEl) {
  instrEl.addEventListener('input', updateComposerSendVisibility);
  instrEl.addEventListener('keydown', function(ev) {
    if (ev.key !== 'Enter' || (!ev.ctrlKey && !ev.metaKey)) return;
    ev.preventDefault();
    if (instrEl.value.trim()) submitRun();
  });
}
document.addEventListener('keydown', function(ev) {
  if (ev.key === 'Escape') closeRunDebug();
});
document.addEventListener('click', function(ev) {
  var modal = document.getElementById('runDebugModal');
  if (modal && ev.target === modal) closeRunDebug();
});
connectWs();
setInterval(refreshRunsFromApi, 60000);
</script>
</body>
</html>`;
    res.type('html').send(html);
  };
}
