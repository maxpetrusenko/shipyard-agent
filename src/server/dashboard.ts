/**
 * Visual dashboard served at GET /
 */

import type { Request, Response } from 'express';
import type { InstructionLoop } from '../runtime/loop.js';
import { ProjectInstructionLoop } from '../runtime/project-loop.js';
import { execSync } from 'node:child_process';
import {
  NAV_STYLES,
  SHIPYARD_BADGE_STYLES,
  SHIPYARD_BASE_STYLES,
  SHIPYARD_THEME_VARS,
  getSharedHelperScript,
} from './html-shared.js';
import { getTimelineScript } from './dashboard-timeline.js';
import {
  getSettingsModalHtml,
  getSettingsModalScript,
  getSettingsModalStyles,
} from './dashboard-settings.js';
import {
  getShortcutsHtml,
  getShortcutsScript,
  getShortcutsStyles,
} from './dashboard-shortcuts.js';
import {
  DASHBOARD_ANTHROPIC_KEY_STORAGE_KEY,
  DASHBOARD_GITHUB_REPO_STORAGE_KEY,
  DASHBOARD_OPENAI_KEY_STORAGE_KEY,
  getDashboardPreferenceScript,
  getProjectPreferencesScript,
} from './dashboard-preferences.js';
import {
  getRetryStyles,
  getRetryHtml,
  getRetryScript,
} from './dashboard-retry.js';
import { getHeaderStyles, getHeaderHtml, getHeaderScript } from './dashboard-header.js';
import { getSidebarHtml, getSidebarStyles, getSidebarScript } from './dashboard-sidebar.js';
import { getComposerHtml, getComposerStyles, getComposerScript, getProjectHeroHtml } from './dashboard-composer.js';
import {
  getDetailPanelHtml,
  getDetailPanelStyles,
  getDetailPanelScript,
  getRightRailHtml,
  getRightRailStyles,
  getRightRailScript,
} from './dashboard-detail.js';
import {
  RUN_DEBUG_STYLES,
  getRunDebugModalHtml,
  getRunDebugScript,
} from './dashboard-debug.js';

const DASHBOARD_RUN_HISTORY_LIMIT = 200;

export function dashboardHandler(loop: InstructionLoop) {
  return async (_req: Request, res: Response) => {
    const workDir = loop.getWorkDir();
    const status = loop.getStatus();
    let runs: Awaited<ReturnType<InstructionLoop['getRunsForListingAsync']>>;
    try {
      runs = await loop.getRunsForListingAsync(DASHBOARD_RUN_HISTORY_LIMIT, 0);
    } catch (err) {
      console.error('[dashboard] getRunsForListingAsync failed:', err);
      runs = loop.getAllRuns()
        .sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''))
        .slice(0, DASHBOARD_RUN_HISTORY_LIMIT);
    }

    let repoBranch = 'unknown';
    let repoLastCommit = 'unknown';
    try {
      repoBranch = execSync(`git -C "${workDir}" branch --show-current`, { encoding: 'utf-8' }).trim();
      repoLastCommit = execSync(`git -C "${workDir}" log -1 --format="%h %s" --no-walk`, { encoding: 'utf-8' }).trim();
    } catch { /* not a git repo */ }

    const projectsJson = JSON.stringify(
      loop instanceof ProjectInstructionLoop
        ? loop.listProjects()
        : [{ id: 'default', label: 'Default Project', workDir }],
    ).replace(/</g, '\\u003c');

    const runsJson = JSON.stringify(
      runs.map((r) => ({
        runId: r.runId,
        workDir: r.workDir ?? null,
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
        requestedUiMode: r.requestedUiMode ?? null,
        threadKind: r.threadKind ?? null,
        runMode: r.runMode ?? null,
        campaignId: r.campaignId ?? null,
        rootRunId: r.rootRunId ?? null,
        parentRunId: r.parentRunId ?? null,
        executionPath: r.executionPath ?? null,
        completionStatus: r.completionStatus ?? null,
        projectContext: r.projectContext ?? null,
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
${SHIPYARD_THEME_VARS}
${SHIPYARD_BASE_STYLES}
body{font-size:13px;min-height:100vh;height:100dvh;overflow:hidden}
.wrap{width:100%;height:100%;margin:0;padding:0;display:flex;flex-direction:column;overflow:hidden}
h1{font-family:var(--sans);font-size:24px;font-weight:700;letter-spacing:-.03em}
h1 span{color:var(--accent)}
.lbl{font-size:var(--text-sm);text-transform:uppercase;letter-spacing:2px;color:var(--dim);font-family:var(--mono)}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 18px;box-shadow:var(--shadow)}
/* header: styles from getHeaderStyles() */
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
/* composer-row, composer-ta, composer-send, composer-toolbar now in dashboard-composer.ts */
.btn{border:none;padding:7px 18px;border-radius:var(--radius);font-family:var(--mono);font-size:var(--text-md);cursor:pointer;font-weight:700;transition:all var(--transition)}
.btn:hover{opacity:.88;transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
.btn-p{background:var(--accent);color:var(--text-inverse);box-shadow:var(--btn-accent-shadow)}
.btn-d{background:var(--red-dim);color:var(--red);border:1px solid var(--danger-border-strong)}
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
.pp-verifying,.pp-reviewing{background:var(--cyan-dim);color:var(--cyan)}
.pp-awaiting_confirmation{background:var(--purple-dim);color:var(--purple)}
.pp-paused{background:var(--pink-dim);color:var(--pink)}
.pp-routing{background:var(--cyan-dim);color:var(--cyan)}
.pp-idle{background:var(--neutral-dim);color:var(--dim)}
.pp-thread-ask{font-size:var(--text-xs);color:var(--text-link-soft);margin-left:4px;font-weight:600}
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
.ss-pending{background:var(--neutral-dim);color:var(--dim)}
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
.errbox{background:var(--danger-bg-med);border:1px solid var(--danger-border-soft);border-radius:var(--radius);padding:12px 14px;font-size:var(--text-md);color:var(--red);white-space:pre-wrap;word-break:break-all}
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
/* sidebar-footer styles now in dashboard-sidebar.ts */
.side-alert{font-size:10px;line-height:1.4;color:var(--red-softer);background:var(--danger-bg-strong);border:1px solid var(--danger-border-panel);border-radius:var(--radius);padding:8px 9px}
${NAV_STYLES}
${SHIPYARD_BADGE_STYLES}
${getHeaderStyles()}
${getSidebarStyles()}
${getComposerStyles()}
${getSettingsModalStyles()}
${getShortcutsStyles()}
${getRetryStyles()}
${getDetailPanelStyles()}
${getRightRailStyles()}
${RUN_DEBUG_STYLES}
</style>
</head>
<body>
<div class="wrap">

  ${getHeaderHtml(repoBranch, repoLastCommit)}

  <div class="chat-layout">
  ${getSidebarHtml()}
  <div class="chat-center">
  ${getProjectHeroHtml()}
  <div class="chat-shell">
    <div class="chat-thread" id="chatThread" aria-live="polite"></div>
    <div class="chat-composer">
  ${getComposerHtml()}
    </div>
  </div>
  </div>
  ${getRightRailHtml()}
  ${getDetailPanelHtml()}
  </div>
  <button type="button" class="shell-backdrop" id="shellBackdrop" data-action="closeResponsivePanels" aria-label="Close panels"></button>

</div>
${getRetryHtml()}
${getSettingsModalHtml()}
${getShortcutsHtml()}
${getRunDebugModalHtml()}
<script>
var WORK_DIR = ${JSON.stringify(workDir)};
var PROJECTS_SEED = ${projectsJson};
var SEED = ${runsJson};
var ANTHROPIC_KEY_STORAGE = ${JSON.stringify(DASHBOARD_ANTHROPIC_KEY_STORAGE_KEY)};
var OPENAI_KEY_STORAGE = ${JSON.stringify(DASHBOARD_OPENAI_KEY_STORAGE_KEY)};
var GH_REPO_STORAGE = ${JSON.stringify(DASHBOARD_GITHUB_REPO_STORAGE_KEY)};
var GH_APP_SLUG_STORAGE = 'shipyard_dashboard_github_app_slug';
var GH_APP_ID_STORAGE = 'shipyard_dashboard_github_app_id';
var GH_APP_PK_STORAGE = 'shipyard_dashboard_github_app_pk';
var ACTIVE_PHASES = ['planning','executing','verifying','reviewing','routing','awaiting_confirmation'];
var DASHBOARD_RUN_HISTORY_LIMIT = ${DASHBOARD_RUN_HISTORY_LIMIT};
${getSharedHelperScript()}
${getHeaderScript()}
${getDetailPanelScript()}
${getRightRailScript()}
${getTimelineScript()}

var runsMap = {};
var titleOverrides = {};
var selectedRunId = null;
var benchmarkSummary = null;
var lastState = {};
var curRunId = null;
var SELECTED_RUN_STORAGE_KEY = 'shipyard_selected_run_id';
var SIDEBAR_COLLAPSED_STORAGE_KEY = 'shipyard_sidebar_collapsed';
var RIGHT_RAIL_COLLAPSED_STORAGE_KEY = 'shipyard_right_rail_collapsed';

var __srvSt = ${JSON.stringify({ processing: status.processing, currentRunId: status.currentRunId })};
if (__srvSt.processing && __srvSt.currentRunId) {
  curRunId = __srvSt.currentRunId;
  lastState = { runId: __srvSt.currentRunId, phase: 'routing' };
}

/* ---- Dashboard state management ---- */
var dashboardState = '';

function setDashboardState(state) {
  if (state === dashboardState && document.body.classList.contains('state-' + state)) return;
  dashboardState = state;
  document.body.classList.remove('state-home', 'state-task');
  document.body.classList.add('state-' + state);
  if (typeof updateRightRail === 'function') updateRightRail();
  if (typeof syncResponsiveShell === 'function') syncResponsiveShell();
}

function isCompactShell() {
  return window.matchMedia('(max-width: 860px)').matches;
}

function restoreDesktopRailPrefs() {
  var body = document.body;
  if (!body) return;
  try {
    body.classList.toggle('left-rail-collapsed', localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1');
    body.classList.toggle('right-rail-collapsed', localStorage.getItem(RIGHT_RAIL_COLLAPSED_STORAGE_KEY) === '1');
  } catch (e) {}
}

function syncRailToggleButton(buttonId, iconId, collapsed, collapseLabel, expandLabel, compact) {
  var btn = document.getElementById(buttonId);
  if (!btn) return;
  if (compact) {
    btn.setAttribute('hidden', 'hidden');
    return;
  }
  btn.removeAttribute('hidden');
  btn.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  btn.setAttribute('aria-label', collapsed ? expandLabel : collapseLabel);
  var icon = document.getElementById(iconId);
  if (icon) {
    if (buttonId === 'sidebarRailToggle') icon.textContent = collapsed ? '\u203A' : '\u2039';
    else icon.textContent = collapsed ? '\u2039' : '\u203A';
  }
}

function syncDesktopRailButtons() {
  var body = document.body;
  if (!body) return;
  var compact = body.classList.contains('compact-shell');
  syncRailToggleButton('sidebarRailToggle', 'sidebarRailToggleIcon', body.classList.contains('left-rail-collapsed'), 'Collapse chats', 'Expand chats', compact);
  syncRailToggleButton('rightRailToggle', 'rightRailToggleIcon', body.classList.contains('right-rail-collapsed'), 'Collapse panels', 'Expand panels', compact);
}

function setDesktopRailCollapsed(side, collapsed) {
  var body = document.body;
  if (!body) return;
  var isLeft = side === 'left';
  body.classList.toggle(isLeft ? 'left-rail-collapsed' : 'right-rail-collapsed', !!collapsed);
  try {
    localStorage.setItem(isLeft ? SIDEBAR_COLLAPSED_STORAGE_KEY : RIGHT_RAIL_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch (e) {}
  syncResponsiveShell();
}

function syncResponsiveShell() {
  var body = document.body;
  if (!body) return;
  var compact = isCompactShell();
  body.classList.toggle('compact-shell', compact);
  if (!compact) {
    body.classList.remove('sidebar-open');
    body.classList.remove('rail-open');
  }
  var sidebarBtn = document.getElementById('hdrSidebarToggle');
  var inspectorBtn = document.getElementById('hdrInspectorToggle');
  if (sidebarBtn) sidebarBtn.setAttribute('aria-expanded', compact ? (body.classList.contains('sidebar-open') ? 'true' : 'false') : (body.classList.contains('left-rail-collapsed') ? 'false' : 'true'));
  if (inspectorBtn) inspectorBtn.setAttribute('aria-expanded', compact ? ((body.classList.contains('rail-open') || body.classList.contains('detail-open')) ? 'true' : 'false') : (body.classList.contains('right-rail-collapsed') ? 'false' : 'true'));
  syncDesktopRailButtons();
}

function closeResponsivePanels() {
  var body = document.body;
  if (!body) return;
  body.classList.remove('sidebar-open');
  body.classList.remove('rail-open');
  if (body.classList.contains('compact-shell')) {
    body.classList.remove('detail-open');
    var panel = document.getElementById('detailPanel');
    if (panel) panel.classList.remove('open');
  }
  syncResponsiveShell();
}

function toggleSidebarPanel() {
  if (!isCompactShell()) {
    setDesktopRailCollapsed('left', !document.body.classList.contains('left-rail-collapsed'));
    return;
  }
  var body = document.body;
  body.classList.toggle('sidebar-open');
  body.classList.remove('rail-open');
  if (body.classList.contains('sidebar-open')) {
    body.classList.remove('detail-open');
    var panel = document.getElementById('detailPanel');
    if (panel) panel.classList.remove('open');
  }
  syncResponsiveShell();
}

function toggleInspectorPanel() {
  if (!isCompactShell()) {
    setDesktopRailCollapsed('right', !document.body.classList.contains('right-rail-collapsed'));
    return;
  }
  var body = document.body;
  if (body.classList.contains('detail-open')) {
    closeDetailPanel();
    return;
  }
  body.classList.toggle('rail-open');
  body.classList.remove('sidebar-open');
  syncResponsiveShell();
}

function toggleSidebarRail() {
  if (isCompactShell()) {
    toggleSidebarPanel();
    return;
  }
  setDesktopRailCollapsed('left', !document.body.classList.contains('left-rail-collapsed'));
}

function toggleRightRail() {
  if (isCompactShell()) {
    toggleInspectorPanel();
    return;
  }
  setDesktopRailCollapsed('right', !document.body.classList.contains('right-rail-collapsed'));
}

function syncDashboardState() {
  var hasActiveRun = !!(curRunId && selectedRunId === curRunId);
  var hasSelectedRun = !!(selectedRunId && runsMap[selectedRunId]);
  if (hasActiveRun || hasSelectedRun) {
    setDashboardState('task');
  } else {
    setDashboardState('home');
  }
}

try {
  var savedTitles = localStorage.getItem('shipyard_titles');
  if (savedTitles) titleOverrides = JSON.parse(savedTitles);
} catch(e) {}

try {
  var savedSelectedRunId = localStorage.getItem(SELECTED_RUN_STORAGE_KEY);
  if (savedSelectedRunId) selectedRunId = savedSelectedRunId;
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
  githubInstallMissing: [],
  githubAppMissing: [],
  githubAppSlug: null,
  githubInstallCallbackUrl: null,
  githubInstallationId: null,
};

${getDashboardPreferenceScript()}
${getProjectPreferencesScript()}

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
    requestedUiMode: preferDefined(nextRun.requestedUiMode, prevRun.requestedUiMode),
    threadKind: preferDefined(nextRun.threadKind, prevRun.threadKind),
    campaignId: preferDefined(nextRun.campaignId, prevRun.campaignId),
    rootRunId: preferDefined(nextRun.rootRunId, prevRun.rootRunId),
    parentRunId: preferDefined(nextRun.parentRunId, prevRun.parentRunId),
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
    projectContext: preferDefined(nextRun.projectContext, prevRun.projectContext),
    workDir: preferDefined(nextRun.workDir, prevRun.workDir),
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
  if (typeof renderProjectList === 'function') renderProjectList();
  return merged;
}

function saveSelectedRunId() {
  try {
    if (selectedRunId) localStorage.setItem(SELECTED_RUN_STORAGE_KEY, selectedRunId);
    else localStorage.removeItem(SELECTED_RUN_STORAGE_KEY);
  } catch(e) {}
}

function runProjectId(run) {
  if (run && run.projectContext && run.projectContext.projectId) return run.projectContext.projectId;
  return 'default';
}

function sortedRuns(options) {
  var all = Object.values(runsMap).sort(function(a,b){ return (b.savedAt||'').localeCompare(a.savedAt||''); });
  if (options && options.selectedOnly === false) return all;
  var selected = typeof getSelectedProject === 'function' ? getSelectedProject() : null;
  var selectedId = selected && selected.id ? selected.id : 'default';
  return all.filter(function(run){ return runProjectId(run) === selectedId; });
}

function ensureSelectedRun() {
  if (selectedRunId && runsMap[selectedRunId]) return;
  if (curRunId && runsMap[curRunId]) {
    selectedRunId = curRunId;
    saveSelectedRunId();
    return;
  }
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
  fetch('/api/runs?limit=' + DASHBOARD_RUN_HISTORY_LIMIT)
    .then(function(r){ return r.json(); })
    .then(function(list){
      for (var i = 0; i < list.length; i++) {
        mergeRunIntoMap(list[i]);
      }
      ensureSelectedRun();
      syncDashboardState();
      renderChatList();
      if (typeof renderProjectList === 'function') renderProjectList();
      if (selectedRunId && runsMap[selectedRunId]) renderChatThread();
      syncComposerUi();
      if (typeof updateRightRail === 'function') updateRightRail();
    }).catch(function(){});
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


// ---- event delegation ----
document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  var action = btn.dataset.action;
  if (handleRetryAction(action)) return;
  if (typeof handleSettingsAction === 'function' && handleSettingsAction(action)) return;
  if (action === 'showShortcuts') {
    e.preventDefault();
    showShortcuts();
    return;
  }
  if (action === 'focusProjectList') {
    e.preventDefault();
    var activeProject = document.querySelector('#sidebarProjects .sidebar-project-item.selected') || document.querySelector('#sidebarProjects .sidebar-project-item');
    if (activeProject) activeProject.focus();
    return;
  }
  if (action === 'toggleSidebar') {
    e.preventDefault();
    toggleSidebarPanel();
    return;
  }
  if (action === 'toggleSidebarCollapse') {
    e.preventDefault();
    toggleSidebarRail();
    return;
  }
  if (action === 'toggleInspector') {
    e.preventDefault();
    toggleInspectorPanel();
    return;
  }
  if (action === 'toggleRightRailCollapse') {
    e.preventDefault();
    toggleRightRail();
    return;
  }
  if (action === 'closeResponsivePanels') {
    e.preventDefault();
    closeResponsivePanels();
    return;
  }
  if (action === 'submit') { e.preventDefault(); submitRun(); return; }
  if (action === 'newChat') { e.preventDefault(); newChat(); return; }
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
  if (action === 'selectChat') {
    var selId = btn.dataset.rid;
    if (selId) selectChat(selId);
    return;
  }
  if (action === 'rrToggleAllFiles') { e.preventDefault(); rrShowAllFiles = !rrShowAllFiles; if (typeof updateRightRail === 'function') updateRightRail(); return; }
  if (action === 'rrToggleSection') { e.preventDefault(); if (typeof rrToggleSection === 'function') rrToggleSection(btn.dataset.section); return; }
  if (action === 'closeDetail') { e.preventDefault(); closeDetailPanel(); return; }
  if (action === 'detailTab') { e.preventDefault(); switchDetailTab(btn.dataset.tab || 'diff'); return; }
  if (action === 'togglePlanDoc') {
    var pw = document.getElementById('planDocWrap');
    var nextOpen = !!(pw && pw.style.display === 'none');
    if (pw) pw.style.display = nextOpen ? 'block' : 'none';
    btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    btn.setAttribute('title', nextOpen ? 'Hide plan doc' : 'Show plan doc');
    btn.setAttribute('aria-label', nextOpen ? 'Hide plan doc' : 'Show plan doc');
    if (nextOpen) {
      var pd = document.getElementById('planDoc');
      if (pd && typeof pd.focus === 'function') pd.focus();
    }
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
  if (action === 'openDebug') {
    e.preventDefault();
    e.stopPropagation();
    openRunDebug(btn.dataset.rid || selectedRunId || '');
    return;
  }
  if (action === 'closeRunDebug') {
    e.preventDefault();
    closeRunDebug();
    return;
  }
  if (action === 'openDebugLink') {
    e.preventDefault();
    var debugUrl = btn.dataset.url || '';
    if (debugUrl) window.open(debugUrl, '_blank', 'noopener');
    return;
  }
  if (action === 'copyDebugLink') {
    e.preventDefault();
    copyRunDebugLink(btn.dataset.url || '');
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
  var row = btn.closest('[data-rid]');
  var runId = row ? row.dataset.rid : null;
  if (action === 'stop') { e.stopPropagation(); e.preventDefault(); stopRun(); return; }
  if (action === 'resume' && runId) { e.stopPropagation(); resumeRunById(runId); }
});


// ---- WS ----
function connectWs() {
  var proto = location.protocol==='https:' ? 'wss:' : 'ws:';
  var ws = new WebSocket(proto + '//' + location.host + '/ws');
  var dot = document.getElementById('wsDot');
  ws.onopen = function(){ dot.className='wsdot on'; if (typeof ws._reconnected !== 'undefined') showToast('Reconnected', 'success'); ws._reconnected = true; };
  ws.onclose = function(){ dot.className='wsdot off'; setTimeout(connectWs, 3000); };
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
        traceUrl: s.traceUrl !== undefined ? s.traceUrl : existing.traceUrl,
        error: s.error !== undefined ? s.error : existing.error,
        verificationResult: s.verificationResult !== undefined ? s.verificationResult : existing.verificationResult,
        reviewFeedback: s.reviewFeedback !== undefined ? s.reviewFeedback : existing.reviewFeedback,
        nextActions: s.nextActions !== undefined ? s.nextActions : existing.nextActions,
        messages: Array.isArray(s.messages) ? (s.messages.length ? s.messages : (existing.messages || [])) : (existing.messages || []),
        requestedUiMode: s.requestedUiMode !== undefined ? s.requestedUiMode : existing.requestedUiMode,
        threadKind: s.threadKind || existing.threadKind,
        completionStatus: s.completionStatus || existing.completionStatus,
        projectContext: s.projectContext !== undefined ? s.projectContext : existing.projectContext,
      });
      if (typeof syncTimelineFromRun === 'function' && (Array.isArray(s.messages) || s.traceUrl !== undefined)) {
        syncTimelineFromRun(s.runId, runsMap[s.runId]);
      }
    } else {
      void refreshRunDetails(s.runId);
    }
    if (existing && s.phase === 'done') {
      void refreshRunDetails(s.runId);
      showToast('Task completed', 'success');
    } else if (existing && s.phase === 'error') {
      void refreshRunDetails(s.runId);
      showToast('Task failed', 'error');
    }
    renderChatList();
    if (typeof renderProjectList === 'function') renderProjectList();
    if (selectedRunId === s.runId) renderChatThread();
    syncComposerUi();
    if (typeof syncHeaderStatus === 'function') syncHeaderStatus();
    if (typeof renderDetailContent === 'function') renderDetailContent();
    syncDashboardState();
    if (typeof updateRightRail === 'function') updateRightRail();
  }
}

${getRetryScript()}
${getSettingsModalScript()}
${getShortcutsScript()}
${getRunDebugScript()}

/* Module scripts — override old inline functions above */
${getSidebarScript()}
${getComposerScript()}

// ---- init ----
ensureSelectedRun();
renderChatList();
renderChatThread();
refreshRunsFromApi();
if (typeof initComposer === 'function') initComposer();
syncDashboardState();
restoreDesktopRailPrefs();
syncResponsiveShell();
if (typeof updateRightRail === 'function') updateRightRail();
if (typeof rrInitInstructions === 'function') rrInitInstructions();
if (typeof rrUpdateHomeContext === 'function') rrUpdateHomeContext();
if (typeof initSettings === 'function') initSettings();
var modelSelEl = document.getElementById('modelSel');
if (modelSelEl) modelSelEl.addEventListener('change', persistDashboardModelSel);
document.addEventListener('keydown', function(ev) {
  var key = (ev.key || '').toLowerCase();
  if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && key === 'k') {
    ev.preventDefault();
    if (typeof toggleSidebarSearch === 'function') toggleSidebarSearch();
    var searchEl = document.getElementById('sidebarSearch');
    if (searchEl) searchEl.focus();
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && key === 'n') {
    ev.preventDefault();
    newChat();
    var instr = document.getElementById('instr');
    if (instr) instr.focus();
    return;
  }
  if (ev.key !== 'Escape') return;
  closeResponsivePanels();
  closeRetryPanel();
  closeDetailPanel();
  if (typeof closeSettings === 'function') closeSettings();
  if (typeof hideShortcuts === 'function') hideShortcuts();
  closeRunDebug();
});
document.addEventListener('click', function(ev) {
  var retryModal = document.getElementById('retryModal');
  if (retryModal && ev.target === retryModal) closeRetryPanel();
  var settingsModal = document.getElementById('settingsModal');
  if (settingsModal && ev.target === settingsModal) closeSettings();
  var kbdOverlay = document.getElementById('kbdOverlay');
  if (kbdOverlay && ev.target === kbdOverlay) hideShortcuts();
  var runDebugModal = document.getElementById('runDebugModal');
  if (runDebugModal && ev.target === runDebugModal) closeRunDebug();
});
window.addEventListener('resize', syncResponsiveShell);
connectWs();
setInterval(refreshRunsFromApi, 60000);
</script>
</body>
</html>`;
    res.type('html').send(html);
  };
}
