import type { Request, Response } from 'express';
import { NAV_STYLES, topNav } from './html-shared.js';

export function settingsGithubHandler() {
  return (_req: Request, res: Response) => {
    res.type('html').send(PAGE_HTML);
  };
}

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shipyard Settings - GitHub</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#060a12;--bg2:#0a0e17;--card:#111827;--card2:#1a2035;--border:#2a3250;--border-bright:#3a4570;--text:#e2e8f0;--text-bright:#f1f5f9;--dim:#6b7a90;--muted:#4a5568;--accent:#818cf8;--accent-dim:rgba(129,140,248,.25);--accent-glow:rgba(129,140,248,.12);--green:#10b981;--red:#ef4444;--yellow:#f59e0b;--mono:'JetBrains Mono',monospace;--sans:'Space Grotesk',sans-serif;--radius:8px;--radius-lg:14px;--shadow:0 4px 20px rgba(0,0,0,.4);--transition:.15s ease}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:var(--mono);font-size:13px;min-height:100vh;-webkit-font-smoothing:antialiased}
.wrap{max-width:1280px;margin:0 auto;padding:26px 20px}
.hdr{display:flex;align-items:center;gap:14px;margin-bottom:18px;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid var(--border)}
h1{font-family:var(--sans);font-size:24px;font-weight:700;letter-spacing:-.03em}
h1 span{color:var(--accent)}
.layout{display:grid;grid-template-columns:220px 1fr;gap:16px}
@media(max-width:980px){.layout{grid-template-columns:1fr}}
.side{border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px;background:var(--card);height:fit-content}
.side-hd{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin:2px 0 8px}
.side a{display:block;border:1px solid transparent;color:var(--dim);text-decoration:none;border-radius:var(--radius);padding:8px 10px;font-size:11px}
.side a.active{border-color:var(--accent);background:var(--accent-glow);color:var(--text)}
.main{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--card);padding:18px 20px;box-shadow:var(--shadow)}
.title{font-size:16px;font-family:var(--sans);font-weight:700;margin-bottom:4px}
.sub{font-size:11px;color:var(--dim);margin-bottom:14px}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.status-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;border:1px solid var(--border)}
.status-badge.ok{color:var(--green);border-color:rgba(16,185,129,.35);background:rgba(16,185,129,.12)}
.status-badge.off{color:var(--red);border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.12)}
.status-badge.warn{color:var(--yellow);border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.12)}
.sec{border:1px solid var(--border);border-radius:var(--radius);padding:12px;background:var(--card2);margin-bottom:12px}
.sec-hd{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px}
.label{display:block;font-size:10px;color:var(--muted);margin:8px 0 4px;text-transform:uppercase;letter-spacing:.06em}
.input,.select,.textarea{width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:8px 9px;font-size:12px;font-family:var(--mono)}
.textarea{min-height:110px;resize:vertical}
.btn{border:none;padding:7px 12px;border-radius:var(--radius);font-family:var(--mono);font-size:11px;cursor:pointer;font-weight:700;transition:all var(--transition)}
.btn:hover{opacity:.9;transform:translateY(-1px)}
.btn-p{background:var(--accent);color:#fff}
.btn-g{background:var(--accent-glow);border:1px solid var(--border);color:var(--accent)}
.btn-d{background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.35);color:#f87171}
.note{font-size:10px;color:var(--dim);line-height:1.4;margin-top:6px}
.status{font-size:11px;color:var(--dim);line-height:1.4;white-space:pre-wrap}
.alert{font-size:11px;line-height:1.4;color:#fca5a5;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);border-radius:var(--radius);padding:8px 10px;margin-top:8px}
${NAV_STYLES}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>Shipyard <span>Settings</span></h1>
    ${topNav('chat')}
  </div>

  <div class="layout">
    <aside class="side">
      <div class="side-hd">Project</div>
      <a href="/settings/connectors/github" class="active" aria-current="page">Connectors / GitHub</a>
      <a href="/dashboard">Back to Chat</a>
    </aside>

    <main class="main">
      <div class="title">GitHub Connector</div>
      <div class="sub">Click <code>Connect GitHub</code>, approve app installation + repository access in popup, then pick repository.</div>

      <div class="sec">
        <div class="sec-hd">Connection</div>
        <div class="row" style="justify-content:space-between">
          <div class="row">
            <span id="connBadge" class="status-badge off">Disconnected</span>
            <span id="connSummary" class="status">Not connected</span>
          </div>
          <div class="row">
            <button type="button" class="btn btn-g" id="connectBtn">Connect GitHub</button>
            <button type="button" class="btn btn-d" id="disconnectBtn">Disconnect</button>
          </div>
        </div>
        <div id="setupAlert" class="alert" style="display:none"></div>
      </div>

      <div class="sec">
        <div class="sec-hd">Repository Connection</div>
        <div class="row" style="margin-top:8px">
          <input class="input" id="query" placeholder="Filter repositories" style="flex:1">
          <button type="button" class="btn btn-g" id="loadBtn">Load</button>
        </div>
        <label class="label" for="repoSel">Repository</label>
        <select class="select" id="repoSel"><option value="">(load repos first)</option></select>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn btn-p" id="connectRepoBtn">Connect Repo</button>
        </div>
        <div id="repoStatus" class="status" style="margin-top:8px"></div>
      </div>
    </main>
  </div>
</div>

<script>
var LS = {
  repo: 'shipyard_settings_gh_repo'
};
var st = { githubInstallConfigured:false, githubConnected:false, githubInstallationId:null };
function g(id){ return document.getElementById(id); }
function lget(k){ try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } }
function lset(k,v){ try{ if(v) localStorage.setItem(k,v); else localStorage.removeItem(k);}catch(e){} }
function updateUi() {
  var badge = g('connBadge');
  var summary = g('connSummary');
  var alert = g('setupAlert');
  badge.className = 'status-badge ' + (st.githubConnected ? 'ok' : 'off');
  badge.textContent = st.githubConnected ? 'Connected' : 'Disconnected';
  if (st.githubConnected) {
    summary.textContent = st.githubInstallationId
      ? ('GitHub App installed (installation #' + st.githubInstallationId + ')')
      : 'Connected';
  } else {
    summary.textContent = 'Not connected';
  }
  if (!st.githubInstallConfigured) {
    alert.style.display = 'block';
    alert.textContent = 'GitHub App connector is not configured on server.';
  } else {
    alert.style.display = 'none';
    alert.textContent = '';
  }
}
function refreshStatus() {
  return fetch('/api/settings/status')
    .then(function(r){ return r.json(); })
    .then(function(x){
      st = {
        githubInstallConfigured: !!x.githubInstallConfigured,
        githubConnected: !!x.githubConnected,
        githubInstallationId: x.githubInstallationId || null,
      };
      updateUi();
    }).catch(function(){});
}
function startInstallFlow() {
  if (!st.githubInstallConfigured) {
    g('repoStatus').textContent = 'GitHub connector is not enabled on server.';
    return;
  }
  var w = window.open('/api/github/install/start', 'shipyard_github_install', 'width=760,height=860');
  if (!w) { g('repoStatus').textContent = 'Popup blocked.'; return; }
  g('repoStatus').textContent = 'Waiting for GitHub app install...';
}
function logout() {
  fetch('/api/github/install/logout', { method:'POST' })
    .then(function(r){ return r.json(); })
    .then(function(){ g('repoStatus').textContent = 'Disconnected.'; refreshStatus(); })
    .catch(function(e){ g('repoStatus').textContent = 'Disconnect failed: ' + e.message; });
}
function loadRepos() {
  g('repoStatus').textContent = 'Loading repositories...';
  fetch('/api/github/repos', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ query: g('query').value.trim() })
  }).then(function(r){
    return r.json().then(function(b){ return { ok: r.ok, body: b }; });
  }).then(function(x){
    if (!x.ok) throw new Error((x.body && x.body.error) || 'Load failed');
    var repos = Array.isArray(x.body.repos) ? x.body.repos : [];
    var sel = g('repoSel');
    sel.innerHTML = repos.length
      ? repos.map(function(r){ return '<option value="' + r.full_name + '">' + r.full_name + '</option>'; }).join('')
      : '<option value="">(no repos found)</option>';
    var saved = lget(LS.repo);
    if (saved) {
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === saved) sel.value = saved;
    }
    g('repoStatus').textContent = repos.length ? ('Loaded ' + repos.length + ' repos.') : 'No repos found.';
  }).catch(function(e){ g('repoStatus').textContent = 'Load failed: ' + e.message; });
}
function connectRepo() {
  var repo = g('repoSel').value;
  if (!repo) { g('repoStatus').textContent = 'Select repository.'; return; }
  lset(LS.repo, repo);
  g('repoStatus').textContent = 'Connecting ' + repo + '...';
  fetch('/api/github/connect', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ repoFullName: repo })
  }).then(function(r){ return r.json().then(function(b){ return { ok:r.ok, body:b }; }); })
    .then(function(x){
      if (!x.ok) throw new Error((x.body && x.body.error) || 'Connect failed');
      g('repoStatus').textContent = 'Connected to ' + repo + ' at ' + x.body.workDir;
      refreshStatus();
    }).catch(function(e){ g('repoStatus').textContent = 'Connect failed: ' + e.message; });
}
window.addEventListener('message', function(ev){
  var data = ev && ev.data;
  if (!data || data.type !== 'shipyard_github_install') return;
  g('repoStatus').textContent = data.ok ? 'GitHub install completed.' : ('Install failed: ' + (data.message || 'unknown'));
  refreshStatus();
  if (data.ok) loadRepos();
});
refreshStatus();
g('connectBtn').addEventListener('click', startInstallFlow);
g('disconnectBtn').addEventListener('click', logout);
g('loadBtn').addEventListener('click', loadRepos);
g('connectRepoBtn').addEventListener('click', connectRepo);
g('repoSel').addEventListener('change', function(){ lset(LS.repo, g('repoSel').value || ''); });
</script>
</body>
</html>`;
