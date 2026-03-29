import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { InstructionLoop } from '../../src/runtime/loop.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp(new InstructionLoop());
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('GET /dashboard', () => {
  it('includes the runs link in top nav', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('href="/runs"');
    expect(html).toContain('>Runs<');
    expect(html).toContain('href="/benchmarks"');
    expect(html).not.toContain('aria-label="Site"');
    expect(html).not.toContain('href="/settings"');
    expect(html).not.toContain('>Settings<');
  });

  it('keeps delete chat controls in the sidebar, not the thread header', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-action="deleteChat"');
    expect(html).not.toContain('data-chat-header-action="delete"');
  });

  it('ships the run debug modal shell', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="runDebugModal"');
    expect(html).toContain('id="runDebugBody"');
    expect(html).toContain('Run debug');
  });

  it('wires debug ui affordances back into the dashboard timeline', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-action="openDebug"');
    expect(html).toContain("fetch('/api/runs/' + encodeURIComponent(runId) + '/debug')");
    expect(html).toContain('copyDebugLink');
    expect(html).not.toContain('detailDebug');
    expect(html).not.toContain('data-tab="debug"');
    expect(html).toContain('Open run JSON');
  });

  it('renders ask plan and agent controls in the composer', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('shipyard_dashboard_mode');
    expect(html).toContain('id="uiModeSel"');
    expect(html).toContain('id="modeSegCtrl"');
    expect(html).toContain('data-action="setMode"');
    expect(html).toContain('>Ask<');
    expect(html).toContain('>Plan<');
    expect(html).toContain('>Agent<');
  });

  it('keeps the plan doc toggle icon-only', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('aria-label="Toggle plan doc"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false')");
    expect(html).not.toContain('Attach plan document');
    expect(html).not.toContain('Hide plan document');
  });

  it('keeps send and stop as separate controls', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="stopBtn"');
    expect(html).not.toContain("btn.dataset.action = 'stop'");
  });

  it('treats any selected thread as a follow-up target', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('return !!(r && r.threadKind);');
  });

  it('sends model and selected ui mode in follow-up requests', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("var followupBody = { instruction: inst }");
    expect(html).toContain('followupBody.uiMode = composerModeValue()');
    expect(html).toContain("followupBody.model = followupModelEl.value");
  });

  it('loads deeper run history into the dashboard shell', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('var DASHBOARD_RUN_HISTORY_LIMIT = 200;');
    expect(html).toContain("fetch('/api/runs?limit=' + DASHBOARD_RUN_HISTORY_LIMIT)");
  });

  it('preserves richer run history when dashboard merges updates', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('function mergeRunRecord(prev, next)');
    expect(html).toContain("if (typeof syncTimelineFromRun === 'function') syncTimelineFromRun(run.runId, merged);");
    expect(html).toContain('toolCallHistory: preferRicherArray(nextRun.toolCallHistory, prevRun.toolCallHistory)');
    expect(html).toContain('fileEdits: preferRicherArray(nextRun.fileEdits, prevRun.fileEdits)');
  });

  it('propagates late trace urls from state updates into the selected run', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('traceUrl: s.traceUrl !== undefined ? s.traceUrl : existing.traceUrl');
    expect(html).toContain("if (typeof syncTimelineFromRun === 'function' && (Array.isArray(s.messages) || s.traceUrl !== undefined)) {");
  });

  it('re-fetches the selected run after stop so tool history survives cancel', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("if (selectedRunId) void refreshRunDetails(selectedRunId);");
  });

  it('seeds the live timeline with the user turn and keeps it after completion', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('function seedTimelineFromMessages(runId, messages)');
    expect(html).toContain("if (typeof syncTimelineFromRun === 'function') syncTimelineFromRun(d.runId, runsMap[d.runId]);");
    expect(html).not.toContain('clearRunTimeline(s.runId);');
  });

  it('syncs selected project chrome across sidebar, hero, and composer', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="sidebarProjects"');
    expect(html).toContain('id="composerProjectLabel"');
    expect(html).toContain('id="projectHeroTitle"');
    expect(html).toContain('function renderProjectList()');
    expect(html).toContain('function syncProjectChrome()');
  });

  it('wires keyboard shortcuts for search and new task', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("key === 'k'");
    expect(html).toContain("key === 'n'");
    expect(html).toContain("toggleSidebarSearch()");
    expect(html).toContain("newChat()");
  });

  it('reselects the live run after async refresh and re-syncs task layout', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('if (curRunId && runsMap[curRunId]) {');
    expect(html).toContain('syncDashboardState();');
    expect(html).toContain("if (typeof updateRightRail === 'function') updateRightRail();");
  });

  it('includes responsive shell toggles and backdrop', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="hdrSidebarToggle"');
    expect(html).toContain('id="hdrInspectorToggle"');
    expect(html).toContain('id="sidebarRailToggle"');
    expect(html).toContain('id="rightRailToggle"');
    expect(html).toContain('id="shellBackdrop"');
    expect(html).toContain('function syncResponsiveShell()');
    expect(html).toContain('function toggleSidebarRail()');
    expect(html).toContain('function toggleRightRail()');
    expect(html).toContain('left-rail-collapsed');
    expect(html).toContain('right-rail-collapsed');
    expect(html).toContain('shipyard_sidebar_collapsed');
    expect(html).toContain('shipyard_right_rail_collapsed');
    expect(html).toContain('compact-shell');
    expect(html).toContain('closeResponsivePanels');
  });

  it('removes dead top mode and sidebar tab code', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('data-action="headerMode"');
    expect(html).not.toContain('>Cowork<');
    expect(html).not.toContain('>Code<');
    expect(html).not.toContain('>Chat<');
    expect(html).not.toContain('data-action="sideTab"');
    expect(html).not.toContain('shipyard_selected_sidebar_tab');
    expect(html).not.toContain('function switchSideTab(');
  });

  it('ships one copy of extracted dashboard helpers', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(countOccurrences(html, 'function humanTitle(')).toBe(1);
    expect(countOccurrences(html, 'function confirmPlanForRun(')).toBe(1);
    expect(countOccurrences(html, 'function settingsStatusText(')).toBe(1);
  });

  it('defaults the composer model to GPT-5.4 Mini and enables send via disabled state', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<option value="gpt-5.4-mini" selected>GPT-5.4 Mini</option>');
    expect(html).not.toContain('<option value="gpt-5.1-codex">');
    expect(html).not.toContain('<option value="gpt-5.3-codex">');
    expect(html).not.toContain('<option value="">Auto</option>');
    expect(html).toContain('btn.disabled = !has;');
  });

  it('ships shared html escaping helper for extracted dashboard modules', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('function esc(s)');
  });

  it('serves inline dashboard script without syntax errors', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(match?.[1]).toBeTruthy();
    expect(() => new Function(match![1])).not.toThrow();
  });

  it('initializes the home state class on first sync', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("var dashboardState = '';");
    expect(html).toContain("document.body.classList.contains('state-' + state)");
  });

  it('keeps GitHub connector focused on the GitHub App flow', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('GitHub PAT (fallback)');
    expect(html).not.toContain('id="ghTokenInput"');
    expect(html).toContain('GitHub App Config');
  });

  it('forces light color scheme for dashboard chrome and controls', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('color-scheme:light;');
    expect(html).toContain('html{color-scheme:light}');
    expect(html).toContain('input,textarea,select,button{color-scheme:light}');
  });

  it('uses state classes for detail width instead of hardcoded inline grid columns', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("document.body.classList.add('detail-open')");
    expect(html).not.toContain("gridTemplateColumns = '240px 1fr 320px 340px'");
  });
});
