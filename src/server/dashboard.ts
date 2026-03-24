/**
 * Minimal visual dashboard served at GET /
 * Shows agent architecture, live status, and recent runs.
 */

import type { Request, Response } from 'express';
import type { InstructionLoop } from '../runtime/loop.js';

export function dashboardHandler(loop: InstructionLoop) {
  return (_req: Request, res: Response) => {
    const status = loop.getStatus();
    const runs = loop.getAllRuns().slice(-20).reverse();

    const runsHtml = runs.length === 0
      ? '<tr><td colspan="5" style="text-align:center;opacity:.5">No runs yet</td></tr>'
      : runs.map(r => {
          const phase = r.phase;
          const color = phase === 'done' ? '#4ade80' : phase === 'error' ? '#f87171' : '#facc15';
          const dur = r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '-';
          const steps = r.steps?.length ?? 0;
          const edits = r.fileEdits?.length ?? 0;
          return `<tr>
            <td><code>${r.runId.slice(0, 8)}</code></td>
            <td><span style="color:${color};font-weight:700">${phase}</span></td>
            <td>${steps} steps / ${edits} edits</td>
            <td>${dur}</td>
            <td>${r.traceUrl ? `<a href="${r.traceUrl}" target="_blank">trace</a>` : '-'}</td>
          </tr>`;
        }).join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shipyard Agent</title>
<style>
  :root { --bg: #0a0a0f; --card: #12121a; --border: #1e1e2e; --text: #e0e0e8; --dim: #6b6b80; --accent: #818cf8; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:'JetBrains Mono','SF Mono','Fira Code',monospace; font-size:14px; min-height:100vh; }
  .container { max-width:960px; margin:0 auto; padding:40px 24px; }
  h1 { font-size:28px; font-weight:800; letter-spacing:-1px; margin-bottom:8px; }
  h1 span { color:var(--accent); }
  .subtitle { color:var(--dim); margin-bottom:32px; font-size:13px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:32px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:20px; }
  .card h2 { font-size:11px; text-transform:uppercase; letter-spacing:2px; color:var(--dim); margin-bottom:12px; }
  .status-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:8px; }
  .status-dot.idle { background:#4ade80; }
  .status-dot.busy { background:#facc15; animation:pulse 1.5s infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }
  .metric { font-size:24px; font-weight:700; }
  .metric-label { font-size:11px; color:var(--dim); margin-top:4px; }
  .arch { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:20px; margin-bottom:32px; }
  .arch pre { font-size:12px; line-height:1.6; color:var(--accent); overflow-x:auto; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:1.5px; color:var(--dim); padding:8px 12px; border-bottom:1px solid var(--border); }
  td { padding:10px 12px; border-bottom:1px solid var(--border); font-size:13px; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }
  .footer { margin-top:40px; text-align:center; color:var(--dim); font-size:11px; }
  code { background:#1a1a2e; padding:2px 6px; border-radius:4px; }
  .node-list { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
  .node-tag { background:#1a1a2e; border:1px solid var(--border); padding:4px 10px; border-radius:6px; font-size:12px; }
  .node-tag .model { color:var(--accent); font-size:10px; display:block; }
</style>
</head>
<body>
<div class="container">
  <h1><span>Shipyard</span> Agent</h1>
  <p class="subtitle">Autonomous coding agent powered by LangGraph + Anthropic Claude</p>

  <div class="grid">
    <div class="card">
      <h2>Status</h2>
      <div>
        <span class="status-dot ${status.processing ? 'busy' : 'idle'}"></span>
        <span style="font-weight:700">${status.processing ? 'Processing' : 'Idle'}</span>
      </div>
      ${status.currentRunId ? `<div style="margin-top:8px;font-size:12px;color:var(--dim)">Run: <code>${status.currentRunId.slice(0, 8)}</code></div>` : ''}
      <div style="margin-top:8px;font-size:12px;color:var(--dim)">Queue: ${status.queueLength} pending</div>
    </div>
    <div class="card">
      <h2>Metrics</h2>
      <div class="metric">${runs.length}</div>
      <div class="metric-label">Total Runs</div>
      <div style="margin-top:8px">
        <span style="color:#4ade80;font-weight:700">${runs.filter(r => r.phase === 'done').length}</span> done
        <span style="margin:0 8px;color:var(--dim)">/</span>
        <span style="color:#f87171;font-weight:700">${runs.filter(r => r.phase === 'error').length}</span> errors
      </div>
    </div>
  </div>

  <div class="arch">
    <h2 style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--dim);margin-bottom:12px;">Graph Architecture</h2>
    <pre>START -> plan -> execute -> verify -> review
                                         |-> continue -> execute (next step)
                                         |-> done -> report -> END
                                         |-> retry -> plan (with feedback)
                                         |-> escalate -> error_recovery</pre>
    <div class="node-list">
      <div class="node-tag">plan<span class="model">Opus 4.6</span></div>
      <div class="node-tag">execute<span class="model">Sonnet 4.5</span></div>
      <div class="node-tag">verify<span class="model">bash</span></div>
      <div class="node-tag">review<span class="model">Opus 4.6</span></div>
      <div class="node-tag">report<span class="model">Sonnet 4.5</span></div>
    </div>
  </div>

  <div class="card">
    <h2>Recent Runs</h2>
    <table>
      <thead><tr><th>ID</th><th>Phase</th><th>Work</th><th>Duration</th><th>Trace</th></tr></thead>
      <tbody>${runsHtml}</tbody>
    </table>
  </div>

  <div class="card" style="margin-top:16px">
    <h2>API Endpoints</h2>
    <table>
      <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
      <tbody>
        <tr><td><code>GET</code></td><td>/api/health</td><td>Health check</td></tr>
        <tr><td><code>POST</code></td><td>/api/run</td><td>Submit instruction</td></tr>
        <tr><td><code>GET</code></td><td>/api/runs</td><td>List runs (paginated)</td></tr>
        <tr><td><code>GET</code></td><td>/api/runs/:id</td><td>Get run details</td></tr>
        <tr><td><code>POST</code></td><td>/api/inject</td><td>Inject context mid-run</td></tr>
        <tr><td><code>POST</code></td><td>/api/cancel</td><td>Cancel current run</td></tr>
        <tr><td><code>WS</code></td><td>/ws</td><td>Real-time state updates</td></tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    Shipyard v1.0 &middot; LangGraph + Claude &middot; 226 tests &middot;
    <a href="https://github.com/maxpetrusenko/shipyard-agent">GitHub</a>
  </div>
</div>

<script>
  // Auto-refresh every 5s when a run is in progress
  setTimeout(() => location.reload(), ${status.processing ? '5000' : '30000'});
</script>
</body>
</html>`;

    res.type('html').send(html);
  };
}
