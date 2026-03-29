import type { Request, Response } from 'express';
import {
  NAV_STYLES,
  SHIPYARD_BADGE_STYLES,
  SHIPYARD_BASE_STYLES,
  SHIPYARD_THEME_VARS,
  topNav,
} from './html-shared.js';

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
${SHIPYARD_THEME_VARS}
${SHIPYARD_BASE_STYLES}
body{font-size:13px;min-height:100vh}
.wrap{max-width:1280px;margin:0 auto;padding:26px 20px}
.hdr{display:flex;align-items:center;gap:14px;margin-bottom:18px;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid var(--border)}
h1{font-family:var(--sans);font-size:24px;font-weight:700;letter-spacing:-.03em}
h1 span{color:var(--accent)}
.layout{display:grid;grid-template-columns:220px 1fr;gap:16px}
@media(max-width:980px){.layout{grid-template-columns:1fr}}
.side{border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px;background:var(--card);height:fit-content;box-shadow:var(--shadow)}
.side-hd{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin:2px 0 8px}
.side a{display:block;border:1px solid transparent;color:var(--dim);text-decoration:none;border-radius:var(--radius);padding:8px 10px;font-size:11px}
.side a.active{border-color:var(--accent);background:var(--accent-glow);color:var(--text)}
.main{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--card);padding:18px 20px;box-shadow:var(--shadow)}
.title{font-size:16px;font-family:var(--sans);font-weight:700;margin-bottom:4px}
.sub{font-size:11px;color:var(--dim);margin-bottom:14px}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sec{border:1px solid var(--border);border-radius:var(--radius);padding:12px;background:var(--card2);margin-bottom:12px}
.sec-hd{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px}
.label{display:block;font-size:10px;color:var(--muted);margin:8px 0 4px;text-transform:uppercase;letter-spacing:.06em}
.input,.select,.textarea{width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:8px 9px;font-size:12px;font-family:var(--mono)}
.textarea{min-height:110px;resize:vertical}
.btn{border:none;padding:7px 12px;border-radius:var(--radius);font-family:var(--mono);font-size:11px;cursor:pointer;font-weight:700;transition:all var(--transition)}
.btn:hover{opacity:.9;transform:translateY(-1px)}
.btn-p{background:var(--accent);color:var(--text-inverse)}
.btn-g{background:var(--accent-glow);border:1px solid var(--border);color:var(--accent)}
.btn-d{background:var(--red-dim);border:1px solid var(--danger-border-strong);color:var(--red)}
.note{font-size:10px;color:var(--dim);line-height:1.4;margin-top:6px}
.status{font-size:11px;color:var(--dim);line-height:1.4;white-space:pre-wrap}
.alert{font-size:11px;line-height:1.4;color:var(--red);background:var(--danger-bg-soft);border:1px solid var(--danger-border-soft);border-radius:var(--radius);padding:8px 10px;margin-top:8px}
.connector-block{border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01));margin-top:10px}
.connector-hd{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text);margin-bottom:6px}
.connector-copy{font-size:11px;color:var(--dim);line-height:1.45;margin-bottom:8px}
.connector-meta{margin-top:6px;padding:8px 10px;border:1px dashed var(--border);border-radius:var(--radius);background:var(--bg2);font-size:11px;color:var(--dim);line-height:1.45}
.connector-meta strong{color:var(--text)}
${SHIPYARD_BADGE_STYLES}
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
      <div class="sub">Click <code>Connect GitHub</code>. If GitHub leaves you on an existing install settings page, load installations here, choose yours, then load repos.</div>

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
        <div class="connector-block">
          <div class="connector-hd">Installation Access</div>
          <div class="connector-copy">Pick the installation tied to the repos you granted. Selecting one here auto-loads repos.</div>
          <div class="row" style="margin-top:8px">
            <select class="select" id="instSel" style="flex:1"><option value="">(load installations first)</option></select>
            <button type="button" class="btn btn-g" id="instLoadBtn">Refresh</button>
            <button type="button" class="btn btn-g" id="instUseBtn">Bind</button>
          </div>
          <div id="instMeta" class="connector-meta">No installation loaded yet.</div>
        </div>
        <div class="connector-block">
          <div class="connector-hd">Granted Repositories</div>
          <div class="connector-copy">Leave search blank to load every repo granted to the selected installation.</div>
          <div class="row" style="margin-top:8px">
            <input class="input" id="query" placeholder="Optional filter, blank = all granted repos" style="flex:1">
            <button type="button" class="btn btn-g" id="loadBtn">Load Repos</button>
          </div>
          <div id="repoMeta" class="connector-meta">No repos loaded yet.</div>
          <label class="label" for="repoSel">Repository</label>
          <select class="select" id="repoSel"><option value="">(load repos first)</option></select>
          <div class="row" style="margin-top:8px">
            <button type="button" class="btn btn-p" id="connectRepoBtn">Connect Repo</button>
          </div>
        </div>
        <div id="repoStatus" class="status" style="margin-top:8px"></div>
      </div>
    </main>
  </div>
</div>

<script>
var LS = {
  repo: 'shipyard_settings_gh_repo',
  installation: 'shipyard_settings_gh_installation'
};
var st = { githubInstallConfigured:false, githubAppConfigured:false, githubInstallMissing:[], githubAppMissing:[], githubInstallCallbackUrl:null, githubConnected:false, githubInstallationId:null };
var githubInstallPollTimer = 0;
var githubInstallPollUntil = 0;
var githubVisibleInstallations = [];
var githubVisibleRepos = [];
function g(id){ return document.getElementById(id); }
function lget(k){ try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } }
function lset(k,v){ try{ if(v) localStorage.setItem(k,v); else localStorage.removeItem(k);}catch(e){} }
function esc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function repoAccessLabel(repositorySelection){ return repositorySelection === 'all' ? 'all repos' : 'selected repos'; }
function selectedInstallation() {
  var instSel = g('instSel');
  var installationId = String(st.githubInstallationId || (instSel ? instSel.value : '') || '');
  if (!installationId) return null;
  for (var i = 0; i < githubVisibleInstallations.length; i++) {
    if (String(githubVisibleInstallations[i].id) === installationId) return githubVisibleInstallations[i];
  }
  return null;
}
function installationSummary(inst) {
  if (!inst) return '';
  return inst.account_login + ' · ' + repoAccessLabel(inst.repository_selection) + ' · #' + inst.id;
}
function stopGithubInstallPolling() {
  if (githubInstallPollTimer) {
    window.clearInterval(githubInstallPollTimer);
    githubInstallPollTimer = 0;
  }
}
function startGithubInstallPolling(popupRef) {
  stopGithubInstallPolling();
  githubInstallPollUntil = Date.now() + 90 * 1000;
  githubInstallPollTimer = window.setInterval(function(){
    if (Date.now() >= githubInstallPollUntil || (popupRef && popupRef.closed)) stopGithubInstallPolling();
    void loadInstallations({ quiet:true, autoSelectSingle:true, autoUsePreferred:true });
  }, 2500);
}
function updateConnectorMeta() {
  var instMeta = g('instMeta');
  var repoMeta = g('repoMeta');
  var instSel = g('instSel');
  var repoSel = g('repoSel');
  var inst = selectedInstallation();
  var instSummary = installationSummary(inst);
  if (instMeta) {
    if (st.githubConnected && st.githubInstallationId && instSummary) instMeta.innerHTML = '<strong>Bound installation:</strong> ' + esc(instSummary) + '.';
    else if (st.githubConnected && st.githubInstallationId) instMeta.innerHTML = '<strong>Bound installation:</strong> #' + st.githubInstallationId + '.';
    else if (instSel && instSel.value && instSummary) instMeta.innerHTML = '<strong>Pending bind:</strong> ' + esc(instSummary) + '.';
    else if (instSel && instSel.value) instMeta.innerHTML = '<strong>Pending bind:</strong> installation #' + esc(instSel.value) + '.';
    else instMeta.innerHTML = 'No installation loaded yet. Click <strong>Refresh</strong> if you already granted access in GitHub.';
  }
  if (repoMeta) {
    if (repoSel && repoSel.value && githubVisibleRepos.length > 0 && inst) repoMeta.innerHTML = '<strong>Ready to connect:</strong> ' + esc(repoSel.value) + '. ' + githubVisibleRepos.length + ' granted repo(s) visible from ' + esc(inst.account_login) + '.';
    else if (repoSel && repoSel.value) repoMeta.innerHTML = '<strong>Ready to connect:</strong> ' + esc(repoSel.value);
    else if (githubVisibleRepos.length > 0 && inst) repoMeta.innerHTML = '<strong>Granted repos loaded:</strong> ' + githubVisibleRepos.length + ' visible from ' + esc(inst.account_login) + ' (' + esc(repoAccessLabel(inst.repository_selection)) + ').';
    else if (st.githubConnected) repoMeta.innerHTML = 'Installation bound. Leave search blank to pull every granted repo.';
    else repoMeta.innerHTML = 'Bind an installation first. Then repos appear here.';
  }
}
function updateUi() {
  var badge = g('connBadge');
  var summary = g('connSummary');
  var alert = g('setupAlert');
  var installMissing = Array.isArray(st.githubInstallMissing) ? st.githubInstallMissing : [];
  var appMissing = Array.isArray(st.githubAppMissing) ? st.githubAppMissing : [];
  var callbackUrl = st.githubInstallCallbackUrl || '/api/github/install/callback';
  badge.className = 'status-badge ' + (st.githubConnected ? 'ok' : 'off');
  badge.textContent = st.githubConnected ? 'Connected' : 'Disconnected';
  if (st.githubConnected) stopGithubInstallPolling();
  if (installMissing.length > 0) {
    summary.textContent = 'Missing ' + installMissing.join(', ');
  } else if (appMissing.length > 0) {
    summary.textContent = 'Missing ' + appMissing.join(', ');
  } else if (st.githubConnected) {
    summary.textContent = st.githubInstallationId
      ? ('GitHub App installed (installation #' + st.githubInstallationId + ')')
      : 'Connected';
  } else {
    summary.textContent = 'Not connected';
  }
  if (installMissing.length > 0 || appMissing.length > 0) {
    alert.style.display = 'block';
    alert.textContent = 'GitHub App setup: Setup URL = ' + callbackUrl + '. Missing install vars: ' + (installMissing.length ? installMissing.join(', ') : 'none') + '. Missing token vars: ' + (appMissing.length ? appMissing.join(', ') : 'none') + '.';
  } else {
    alert.style.display = 'none';
    alert.textContent = '';
  }
  updateConnectorMeta();
}
function refreshStatus() {
  return fetch('/api/settings/status')
    .then(function(r){ return r.json(); })
    .then(function(x){
      st = {
        githubInstallConfigured: !!x.githubInstallConfigured,
        githubAppConfigured: !!x.githubAppConfigured,
        githubInstallMissing: Array.isArray(x.githubInstallMissing) ? x.githubInstallMissing : [],
        githubAppMissing: Array.isArray(x.githubAppMissing) ? x.githubAppMissing : [],
        githubInstallCallbackUrl: x.githubInstallCallbackUrl || null,
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
  g('repoStatus').textContent = 'Popup opened. If GitHub stays on install settings, this page keeps refreshing installations and binds one when you pick it.';
  startGithubInstallPolling(w);
  window.setTimeout(function(){ loadInstallations({ quiet:true, autoSelectSingle:true, autoUsePreferred:true }); }, 1200);
}
function logout() {
  fetch('/api/github/install/logout', { method:'POST' })
    .then(function(r){ return r.json(); })
    .then(function(){
      lset(LS.installation, '');
      githubVisibleInstallations = [];
      githubVisibleRepos = [];
      var instSel = g('instSel');
      if (instSel) instSel.innerHTML = '<option value="">(load installations first)</option>';
      var repoSel = g('repoSel');
      if (repoSel) repoSel.innerHTML = '<option value="">(load repos first)</option>';
      stopGithubInstallPolling();
      g('repoStatus').textContent = 'Disconnected.';
      refreshStatus();
    })
    .catch(function(e){ g('repoStatus').textContent = 'Disconnect failed: ' + e.message; });
}
function loadInstallations(opts) {
  var o = { quiet: !!(opts && opts.quiet), autoSelectSingle: !!(opts && opts.autoSelectSingle), autoUsePreferred: !!(opts && opts.autoUsePreferred) };
  if (!o.quiet) g('repoStatus').textContent = 'Loading installations...';
  return fetch('/api/github/installations', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: '{}'
  }).then(function(r){
    return r.json().then(function(b){ return { ok: r.ok, body: b }; });
  }).then(function(x){
    if (!x.ok) throw new Error((x.body && x.body.error) || 'Installation load failed');
    var installs = Array.isArray(x.body.installations) ? x.body.installations : [];
    githubVisibleInstallations = installs;
    var sel = g('instSel');
    if (sel) {
      sel.innerHTML = installs.length
        ? installs.map(function(inst){
            var label = inst.account_login + ' · ' + repoAccessLabel(inst.repository_selection || 'selected') + ' · #' + inst.id;
            return '<option value="' + esc(inst.id) + '">' + esc(label) + '</option>';
          }).join('')
        : '<option value="">(no installations found)</option>';
      var preferred = String(st.githubInstallationId || lget(LS.installation) || '');
      if (preferred) {
        for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === preferred) sel.value = preferred;
      }
      if ((!preferred || !sel.value) && o.autoSelectSingle && installs.length === 1) {
        sel.value = String(installs[0].id);
      }
      updateConnectorMeta();
      if (sel.value && (o.autoUsePreferred || (o.autoSelectSingle && installs.length === 1))) {
        return useInstallation(true);
      }
    }
    if (!o.quiet) g('repoStatus').textContent = installs.length ? ('Loaded ' + installs.length + ' installations.') : 'No installations found.';
    return false;
  }).catch(function(e){
    if (!o.quiet) g('repoStatus').textContent = 'Installation load failed: ' + e.message;
    return false;
  });
}
function useInstallation(autoLoadRepos) {
  var instSel = g('instSel');
  var installationId = instSel ? instSel.value : '';
  if (!installationId) {
    g('repoStatus').textContent = 'Select installation.';
    return Promise.resolve(false);
  }
  lset(LS.installation, installationId);
  githubVisibleRepos = [];
  var repoSel = g('repoSel');
  if (repoSel) repoSel.innerHTML = '<option value="">(loading repos after bind)</option>';
  g('repoStatus').textContent = 'Using installation #' + installationId + '...';
  updateConnectorMeta();
  return fetch('/api/github/install/select', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ installationId: Number(installationId) })
  }).then(function(r){
    return r.json().then(function(b){ return { ok: r.ok, body: b }; });
  }).then(function(x){
    if (!x.ok) throw new Error((x.body && x.body.error) || 'Installation select failed');
    g('repoStatus').textContent = 'Using installation #' + installationId + '.';
    return refreshStatus().then(function(){
      if (autoLoadRepos) return loadRepos().then(function(){ return true; });
      return true;
    });
  }).catch(function(e){
    g('repoStatus').textContent = 'Installation select failed: ' + e.message;
    return false;
  });
}
function loadRepos() {
  g('repoStatus').textContent = 'Loading repositories...';
  return fetch('/api/github/repos', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ query: g('query').value.trim() })
  }).then(function(r){
    return r.json().then(function(b){ return { ok: r.ok, body: b }; });
  }).then(function(x){
    if (!x.ok) throw new Error((x.body && x.body.error) || 'Load failed');
    var repos = Array.isArray(x.body.repos) ? x.body.repos : [];
    githubVisibleRepos = repos;
    var sel = g('repoSel');
    sel.innerHTML = repos.length
      ? repos.map(function(r){ return '<option value="' + esc(r.full_name) + '">' + esc(r.full_name) + '</option>'; }).join('')
      : '<option value="">(no repos found)</option>';
    var saved = lget(LS.repo);
    if (saved) {
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === saved) sel.value = saved;
    }
    if (!sel.value && repos.length === 1) {
      sel.value = repos[0].full_name;
      lset(LS.repo, repos[0].full_name);
    }
    updateConnectorMeta();
    g('repoStatus').textContent = repos.length ? ('Loaded ' + repos.length + ' repos.') : 'No repos found. Try a different query, or leave search blank for all granted repos.';
    return repos;
  }).catch(function(e){ githubVisibleRepos = []; g('repoStatus').textContent = 'Load failed: ' + e.message; return []; });
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
  if (ev.origin !== window.location.origin) return;
  var data = ev && ev.data;
  if (!data || data.type !== 'shipyard_github_install') return;
  g('repoStatus').textContent = data.ok ? 'GitHub install completed.' : ('Install failed: ' + (data.message || 'unknown'));
  stopGithubInstallPolling();
  refreshStatus().then(function(){ return loadInstallations({ quiet:true, autoSelectSingle:true, autoUsePreferred:true }); }).then(function(selected){
    if (data.ok && (st.githubConnected || selected)) return loadRepos();
    return null;
  });
});
refreshStatus().then(function(){ return loadInstallations({ quiet:true, autoSelectSingle:true, autoUsePreferred:true }); });
g('connectBtn').addEventListener('click', startInstallFlow);
g('disconnectBtn').addEventListener('click', logout);
g('instLoadBtn').addEventListener('click', function(){ loadInstallations(); });
g('instUseBtn').addEventListener('click', function(){ useInstallation(true); });
g('loadBtn').addEventListener('click', loadRepos);
g('connectRepoBtn').addEventListener('click', connectRepo);
g('instSel').addEventListener('change', function(){ lset(LS.installation, g('instSel').value || ''); githubVisibleRepos = []; lset(LS.repo, ''); g('repoSel').innerHTML = '<option value="">(load repos after bind)</option>'; updateConnectorMeta(); if (g('instSel').value) void useInstallation(true); });
g('repoSel').addEventListener('change', function(){ lset(LS.repo, g('repoSel').value || ''); updateConnectorMeta(); });
</script>
</body>
</html>`;
