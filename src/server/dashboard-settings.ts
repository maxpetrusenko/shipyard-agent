// Settings modal — replaces sidebar Config tab.
// Includes all settings business logic (keys, checkpoints, GitHub, benchmarks).

import { SHIPYARD_BADGE_STYLES } from './html-shared.js';

export function getSettingsModalStyles(): string {
  return `
.settings-modal{position:fixed;inset:0;z-index:var(--z-modal);display:flex;align-items:center;justify-content:center;background:var(--overlay-backdrop);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity var(--transition)}
.settings-modal.open{opacity:1;pointer-events:auto}
.settings-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-xl);width:min(560px,92vw);max-height:min(80vh,700px);overflow-y:auto;box-shadow:var(--shadow-lg);transform:translateY(12px);transition:transform var(--transition)}
.settings-modal.open .settings-card{transform:translateY(0)}
.settings-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card);z-index:1;border-radius:var(--radius-xl) var(--radius-xl) 0 0}
.settings-hd h2{font-size:16px;font-weight:700;font-family:var(--sans)}
.settings-close{background:none;border:none;color:var(--dim);cursor:pointer;font-size:18px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:0;border-radius:var(--radius);transition:all var(--transition)}
.settings-close:hover{background:var(--bg2);color:var(--text)}
.settings-close:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.settings-body{padding:8px 0}
.settings-section{border-bottom:1px solid var(--border);border-left:2px solid transparent;transition:border-color var(--transition)}
.settings-section:last-child{border-bottom:none}
.settings-section.open{border-left-color:var(--accent)}
.settings-sec-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;cursor:pointer;user-select:none;transition:background var(--transition)}
.settings-sec-hd:hover{background:var(--bg2)}
.settings-sec-title{font-size:var(--text-md);font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text)}
.settings-sec-chev{color:var(--dim);font-size:var(--text-sm);transition:transform .2s}
.settings-section.open .settings-sec-chev{transform:rotate(90deg)}
.settings-sec-bd{display:none;padding:12px 16px 16px}
.settings-section.open .settings-sec-bd{display:block}
.settings-field{margin-bottom:12px}
.settings-label{display:block;font-size:var(--text-sm);color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em}
.settings-input{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:8px 12px;font-size:var(--text-md);font-family:var(--mono);transition:border-color var(--transition),box-shadow var(--transition)}
.settings-input:focus{outline:none;border-color:var(--accent);box-shadow:var(--shadow-ring)}
.settings-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.settings-note{font-size:var(--text-sm);color:var(--dim);line-height:1.35}
.settings-status{font-size:var(--text-base);font-family:var(--mono);color:var(--dim);line-height:1.35;word-break:break-word;margin-top:8px;padding:6px 10px;border-radius:var(--radius);transition:all var(--transition)}
.settings-status:empty{display:none}
.settings-status-ok{background:var(--green-dim);color:var(--green)}
.settings-status-err{background:var(--red-dim);color:var(--red)}
.side-alert{font-size:var(--text-sm);line-height:1.4;color:var(--red);background:var(--red-dim);border:1px solid var(--danger-border-soft);border-radius:var(--radius);padding:8px 9px}
.side-checklist{font-size:var(--text-sm);color:var(--dim);line-height:1.45;padding-left:16px}
.side-checklist li{margin:3px 0}
.provider-row{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:var(--radius);background:var(--bg);border:1px solid var(--border);font-size:var(--text-base);font-family:var(--mono)}
.provider-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.provider-dot.ok{background:var(--green)}
.provider-dot.off{background:var(--red)}
.provider-name{font-weight:600;text-transform:uppercase;letter-spacing:.04em;min-width:64px;color:var(--text)}
.provider-detail{color:var(--dim);flex:1}
.provider-remediation{font-size:var(--text-sm);color:var(--red);margin-top:2px}.ack-preview{font-family:var(--mono);font-size:var(--text-sm);color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;max-height:200px;overflow-y:auto;line-height:1.45;white-space:pre-wrap;word-break:break-word;margin-top:8px}
.connector-stack{display:flex;flex-direction:column;gap:10px}
.connector-card{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01));border:1px solid var(--border);border-radius:var(--radius);padding:10px 11px}
.connector-card-hd{font-size:var(--text-sm);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text);margin-bottom:6px}
.connector-card-copy{font-size:var(--text-sm);color:var(--dim);line-height:1.45;margin-bottom:8px}
.connector-meta{margin-top:6px;padding:8px 10px;border:1px dashed var(--border);border-radius:var(--radius);background:var(--bg);font-size:var(--text-sm);color:var(--dim);line-height:1.45}
.connector-meta strong{color:var(--text)}
#ackTemplateInput{min-height:80px}
${SHIPYARD_BADGE_STYLES}`;
}

export function getSettingsModalHtml(): string {
  return `
<div class="settings-modal" id="settingsModal" role="dialog" aria-modal="true" aria-label="Config">
  <div class="settings-card">
    <div class="settings-hd">
      <h2>Config</h2>
      <button type="button" class="settings-close" data-action="closeSettings" aria-label="Close settings">&times;</button>
    </div>
    <div class="settings-body">
      <!-- Section 1: API Keys -->
      <div class="settings-section open" data-settings-section="keys">
        <div class="settings-sec-hd" data-action="toggleSettingsSection" data-section="keys" role="button" aria-expanded="true">
          <span class="settings-sec-title">API Keys</span>
          <span class="settings-sec-chev">&#9654;</span>
        </div>
        <div class="settings-sec-bd">
          <div class="settings-field">
            <label class="settings-label" for="anthropicKeyInput">Anthropic key</label>
            <input class="settings-input" id="anthropicKeyInput" type="password" placeholder="sk-ant-..." autocomplete="off">
          </div>
          <div class="settings-field">
            <label class="settings-label" for="anthropicAuthTokenInput">Anthropic auth token (Claude Max)</label>
            <input class="settings-input" id="anthropicAuthTokenInput" type="password" placeholder="OAuth token" autocomplete="off">
          </div>
          <div class="settings-field">
            <label class="settings-label" for="openaiKeyInput">OpenAI key</label>
            <input class="settings-input" id="openaiKeyInput" type="password" placeholder="sk-..." autocomplete="off">
          </div>
          <div class="settings-row">
            <button type="button" class="btn btn-p" style="font-size:10px;padding:5px 12px" data-action="saveModelKeys">Apply Keys</button>
          </div>
          <div id="modelKeyStatus" class="settings-status"></div>
          <div id="providerStatus" class="settings-note" style="margin-top:8px"></div>
        </div>
      </div>

      <!-- Section: Provider Status -->
      <div class="settings-section" data-settings-section="providers">
        <div class="settings-sec-hd" data-action="toggleSettingsSection" data-section="providers" role="button" aria-expanded="false">
          <span class="settings-sec-title">Provider Status</span>
          <span class="settings-sec-chev">&#9654;</span>
        </div>
        <div class="settings-sec-bd">
          <div class="settings-note" style="margin-bottom:8px">Live readiness checks for LLM and CLI providers.</div>
          <div class="settings-row" style="margin-bottom:8px">
            <button type="button" class="btn btn-g" style="font-size:10px;padding:5px 10px" data-action="refreshProviderReadiness">Refresh</button>
            <span id="providerReadyBadge" class="side-badge off">Checking...</span>
          </div>
          <div id="providerReadinessGrid" style="display:flex;flex-direction:column;gap:6px"></div>
          <div id="providerReadinessStatus" class="settings-status"></div>
        </div>
      </div>

      <!-- Section 2: Connectors -->
      <div class="settings-section" data-settings-section="github">
        <div class="settings-sec-hd" data-action="toggleSettingsSection" data-section="github" role="button" aria-expanded="false">
          <span class="settings-sec-title">Connectors</span>
          <span class="settings-sec-chev">&#9654;</span>
        </div>
        <div class="settings-sec-bd">
          <div class="settings-row" style="margin-bottom:8px">
            <span id="ghConnBadge" class="side-badge off">Disconnected</span>
            <span id="ghAuthStatus" class="settings-note"></span>
          </div>
          <div id="ghSetupAlert" class="side-alert" style="display:none;margin-bottom:8px"></div>
          <div class="connector-stack">
            <div class="connector-card">
              <div class="connector-card-hd">Authorize</div>
              <div class="connector-card-copy">Open GitHub, grant all repos or a selected set, then this panel pulls the installation and repos back in.</div>
              <div class="settings-row">
                <button type="button" class="btn btn-p" style="font-size:10px;padding:5px 12px" data-action="startGithubOAuth">Open GitHub</button>
                <button type="button" class="btn btn-d" style="font-size:10px;padding:5px 12px" data-action="logoutGithubOAuth">Disconnect</button>
              </div>
              <div id="ghFlowHint" class="connector-meta">If GitHub leaves the popup on <code>settings/installations</code>, come back here. Installations hydrate automatically and selecting one binds it to this session.</div>
            </div>
            <div class="connector-card">
              <div class="connector-card-hd">Installation Access</div>
              <div class="connector-card-copy">Pick the installation tied to the repos you granted. Selecting one here auto-loads repos.</div>
              <div class="settings-row">
                <select id="ghInstallSel" class="settings-input" style="cursor:pointer;flex:1"><option value="">(load installations first)</option></select>
                <button type="button" class="btn btn-g" style="font-size:10px;padding:5px 10px" data-action="loadGithubInstallations">Refresh</button>
                <button type="button" class="btn btn-g" style="font-size:10px;padding:5px 10px" data-action="useGithubInstallation">Bind</button>
              </div>
              <div id="ghInstallMeta" class="connector-meta">No installation loaded yet.</div>
            </div>
            <div class="connector-card">
              <div class="connector-card-hd">Granted Repositories</div>
              <div class="connector-card-copy">Leave search blank to load every repo granted to the selected installation.</div>
              <div class="settings-row">
                <input class="settings-input" id="ghRepoSearchInput" type="text" placeholder="Optional filter, blank = all granted repos" style="flex:1">
                <button type="button" class="btn btn-g" style="font-size:10px;padding:5px 10px" data-action="loadGithubRepos">Load Repos</button>
              </div>
              <div id="ghRepoMeta" class="connector-meta">No repos loaded yet.</div>
              <div class="settings-field" style="margin-top:8px;margin-bottom:0">
                <label class="settings-label" for="ghRepoSel">Repository</label>
                <select id="ghRepoSel" class="settings-input" style="cursor:pointer"><option value="">(load repos first)</option></select>
              </div>
              <div class="settings-row" style="margin-top:8px">
                <button type="button" class="btn btn-p" style="font-size:10px;padding:5px 12px" data-action="connectGithubRepo">Connect Repo</button>
              </div>
            </div>
          </div>
          <div id="ghStatus" class="settings-status"></div>
          <div style="margin-top:8px">
            <button type="button" class="btn btn-g" style="font-size:10px;padding:4px 10px" data-action="toggleGithubAppConfig">GitHub App Config</button>
          </div>
          <div id="ghAppCfgWrap" style="display:none;margin-top:8px">
            <div class="settings-field"><label class="settings-label" for="ghAppSlugInput">App slug</label><input class="settings-input" id="ghAppSlugInput" placeholder="my-app"></div>
            <div class="settings-field"><label class="settings-label" for="ghAppIdInput">App ID</label><input class="settings-input" id="ghAppIdInput" placeholder="123456"></div>
            <div class="settings-field"><label class="settings-label" for="ghAppPkInput">Private key (PEM)</label><input class="settings-input" id="ghAppPkInput" type="password" placeholder="-----BEGIN RSA..."></div>
            <div class="settings-row">
              <button type="button" class="btn btn-p" style="font-size:10px;padding:5px 12px" data-action="saveGithubAppConfig">Save App Config</button>
            </div>
            <div id="ghAppCfgStatus" class="settings-status"></div>
          </div>
          <ol id="ghStepList" class="side-checklist" style="margin-top:8px">
            <li id="ghStepServer">Server config: checking...</li>
            <li id="ghStepAuth">GitHub auth: checking...</li>
            <li id="ghStepRepo">Repository selected: none</li>
          </ol>
        </div>
      </div>

      <!-- Section 3: Checkpoints -->
      <div class="settings-section" data-settings-section="checkpoints">
        <div class="settings-sec-hd" data-action="toggleSettingsSection" data-section="checkpoints" role="button" aria-expanded="false">
          <span class="settings-sec-title">Checkpoints</span>
          <span class="settings-sec-chev">&#9654;</span>
        </div>
        <div class="settings-sec-bd">
          <div class="settings-note" style="margin-bottom:8px">Create and restore local workspace snapshots without git reset.</div>
          <div class="settings-row" style="margin-bottom:8px">
            <button type="button" class="btn btn-g" style="font-size:10px;padding:5px 10px" data-action="refreshCheckpoints">Refresh</button>
            <button type="button" class="btn btn-p" style="font-size:10px;padding:5px 10px" data-action="createCheckpoint">Create</button>
            <button type="button" class="btn btn-d" style="font-size:10px;padding:5px 10px" data-action="rollbackCheckpoint">Rollback</button>
          </div>
          <div class="settings-field">
            <label class="settings-label" for="checkpointSel">Latest checkpoints</label>
            <select id="checkpointSel" class="settings-input" style="cursor:pointer"><option value="">(none)</option></select>
          </div>
          <div id="checkpointStatus" class="settings-status"></div>
        </div>
      </div>


      <!-- Section 3b: Ack Comment Template -->
      <div class="settings-section" data-settings-section="ackTemplate">
        <div class="settings-sec-hd" data-action="toggleSettingsSection" data-section="ackTemplate" role="button" aria-expanded="false">
          <span class="settings-sec-title">Ack Comment Template</span>
          <span class="settings-sec-chev">&#9654;</span>
        </div>
        <div class="settings-sec-bd">
          <div class="settings-note" style="margin-bottom:8px">Template for acknowledgement comments posted on issues. Use variables: {{repo}}, {{issue}}, {{runId}}, {{status}}.</div>
          <div class="settings-field">
            <label class="settings-label" for="ackTemplateInput">Template</label>
            <textarea id="ackTemplateInput" class="settings-input" rows="4" placeholder="Acknowledged {{repo}}#{{issue}} — runId={{runId}}, status={{status}}"></textarea>
          </div>
          <div class="settings-row" style="margin-top:8px">
            <button type="button" class="btn btn-g" style="font-size:10px;padding:5px 10px" data-action="previewAckTemplate">Preview</button>
            <button type="button" class="btn btn-p" style="font-size:10px;padding:5px 10px" data-action="saveAckTemplate">Save</button>
          </div>
          <div id="ackTemplatePreview" class="ack-preview" style="display:none"></div>
          <div id="ackTemplateStatus" class="settings-status"></div>
        </div>
      </div>
      <!-- Section 4: Benchmarks -->
      <div class="settings-section" data-settings-section="bench">
        <div class="settings-sec-hd" data-action="toggleSettingsSection" data-section="bench" role="button" aria-expanded="false">
          <span class="settings-sec-title">Benchmarks</span>
          <span class="settings-sec-chev">&#9654;</span>
        </div>
        <div class="settings-sec-bd">
          <div id="benchSummaryStatus" class="settings-note">No data yet.</div>
          <a href="/benchmarks" class="btn btn-g" style="font-size:10px;padding:5px 12px;text-decoration:none;display:inline-flex;margin-top:8px">Open Benchmarks</a>
        </div>
      </div>

      <!-- Section 5: About -->
      <div class="settings-section" data-settings-section="about">
        <div class="settings-sec-hd" data-action="toggleSettingsSection" data-section="about" role="button" aria-expanded="false">
          <span class="settings-sec-title">About</span>
          <span class="settings-sec-chev">&#9654;</span>
        </div>
        <div class="settings-sec-bd">
          <div class="settings-note">Shipyard Agent v1.0</div>
          <div id="aboutHealth" class="settings-note" style="margin-top:4px"></div>
        </div>
      </div>
    </div>
  </div>
</div>`;
}

export function getSettingsModalScript(): string {
  return `
function openSettings() {
  var modal = document.getElementById('settingsModal');
  if (modal) modal.classList.add('open');
  githubHydrationAttempted = false;
  refreshSettingsStatus().then(function(){ return maybeHydrateGithubConnector(true); });
  refreshProviderReadiness();
  refreshCheckpoints();
  refreshBenchmarkSummary();
  loadAckTemplate();
}
function closeSettings() {
  var modal = document.getElementById('settingsModal');
  if (modal) modal.classList.remove('open');
}
function toggleSettingsSection(section) {
  var el = document.querySelector('[data-settings-section="' + section + '"]');
  if (!el) return;
  el.classList.toggle('open');
  var hd = el.querySelector('.settings-sec-hd');
  if (hd) hd.setAttribute('aria-expanded', el.classList.contains('open') ? 'true' : 'false');
}

/* ---- Status class helper ---- */
function setSettingsStatus(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className = 'settings-status' + (type === 'ok' ? ' settings-status-ok' : (type === 'err' ? ' settings-status-err' : ''));
}

/* ---- Settings business logic ---- */
function settingsStatusText() {
  var branch = settingsStatus.repoBranch ? settingsStatus.repoBranch : 'unknown';
  var remote = settingsStatus.repoRemote ? settingsStatus.repoRemote : 'none';
  var gh = settingsStatus.ghAuthenticated ? 'yes' : 'no';
  var anth = settingsStatus.anthropicAuthMode || 'none';
  var codex = settingsStatus.codexCliInstalled
    ? (settingsStatus.codexCliAuthenticated ? 'installed + logged in' : 'installed, login missing')
    : 'not installed';
  return 'workdir: ' + settingsStatus.workDir +
    '\\nbranch: ' + branch +
    '\\norigin: ' + remote +
    '\\ngh cli auth: ' + gh +
    '\\nanthropic auth: ' + anth +
    '\\ncodex cli: ' + codex;
}

var GH_INSTALLATION_STORAGE = 'shipyard_dashboard_github_installation';
var githubInstallPollTimer = 0;
var githubInstallPollUntil = 0;
var githubHydrationAttempted = false;
var githubVisibleInstallations = [];
var githubVisibleRepos = [];

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
    if (Date.now() >= githubInstallPollUntil || (popupRef && popupRef.closed)) {
      stopGithubInstallPolling();
    }
    void loadGithubInstallations({ quiet: true, autoSelectSingle: true, autoUsePreferred: true });
  }, 2500);
}

function normalizeGithubInstallLoadOptions(opts) {
  if (opts === true) return { quiet: false, autoSelectSingle: true, autoUsePreferred: true };
  return {
    quiet: !!(opts && opts.quiet),
    autoSelectSingle: !!(opts && opts.autoSelectSingle),
    autoUsePreferred: !!(opts && opts.autoUsePreferred),
  };
}

function githubRepoAccessLabel(repositorySelection) {
  return repositorySelection === 'all' ? 'all repos' : 'selected repos';
}

function selectedGithubInstallation() {
  var installSel = document.getElementById('ghInstallSel');
  var installationId = String(settingsStatus.githubInstallationId || (installSel ? installSel.value : '') || '');
  if (!installationId) return null;
  for (var i = 0; i < githubVisibleInstallations.length; i++) {
    if (String(githubVisibleInstallations[i].id) === installationId) return githubVisibleInstallations[i];
  }
  return null;
}

function githubInstallationSummary(inst) {
  if (!inst) return '';
  return inst.account_login + ' · ' + githubRepoAccessLabel(inst.repository_selection) + ' · #' + inst.id;
}

function renderSettingsStatus() {
  var ghStatus = document.getElementById('ghStatus');
  var ghAuth = document.getElementById('ghAuthStatus');
  var ghConnBadge = document.getElementById('ghConnBadge');
  var ghSetupAlert = document.getElementById('ghSetupAlert');
  var ghFlowHint = document.getElementById('ghFlowHint');
  var ghStepServer = document.getElementById('ghStepServer');
  var ghStepAuth = document.getElementById('ghStepAuth');
  var ghStepRepo = document.getElementById('ghStepRepo');
  var providerStatus = document.getElementById('providerStatus');
  var oauthBtn = document.querySelector('[data-action="startGithubOAuth"]');
  var installSel = document.getElementById('ghInstallSel');
  var ghInstallMeta = document.getElementById('ghInstallMeta');
  var ghRepoMeta = document.getElementById('ghRepoMeta');
  var repoSel = document.getElementById('ghRepoSel');
  var activeInstall = selectedGithubInstallation();
  var installSummary = githubInstallationSummary(activeInstall);
  var hasInstallSel = !!(installSel && installSel.value);
  var hasRepoSel = !!(repoSel && repoSel.value);
  var installMissing = Array.isArray(settingsStatus.githubInstallMissing) ? settingsStatus.githubInstallMissing : [];
  var appMissing = Array.isArray(settingsStatus.githubAppMissing) ? settingsStatus.githubAppMissing : [];
  var callbackUrl = settingsStatus.githubInstallCallbackUrl || '/api/github/install/callback';
  if (ghAuth) {
    if (installMissing.length > 0) {
      ghAuth.textContent = 'GitHub App install flow blocked. Missing ' + installMissing.join(', ') + '.';
    } else if (!settingsStatus.githubAppConfigured) {
      ghAuth.textContent = 'GitHub App install is live, but token exchange is missing ' + appMissing.join(', ') + '.';
    } else if (settingsStatus.githubConnected && settingsStatus.githubInstallationId) {
      ghAuth.textContent = 'GitHub App installed' + (settingsStatus.githubLogin ? (' as @' + settingsStatus.githubLogin) : '') + ' (installation #' + settingsStatus.githubInstallationId + ')';
    } else if (settingsStatus.githubConnected) {
      ghAuth.textContent = 'Connected as @' + (settingsStatus.githubLogin || 'unknown');
    } else {
      ghAuth.textContent = 'Not connected';
    }
  }
  setBadge(ghConnBadge, settingsStatus.githubConnected ? 'Connected' : 'Disconnected', settingsStatus.githubConnected ? 'ok' : 'off');
  if (settingsStatus.githubConnected) stopGithubInstallPolling();
  if (ghStepServer) {
    if (installMissing.length > 0) ghStepServer.textContent = 'Server config: missing ' + installMissing.join(', ');
    else if (appMissing.length > 0) ghStepServer.textContent = 'Server config: install ok, token exchange missing ' + appMissing.join(', ');
    else ghStepServer.textContent = 'Server config: GitHub App install ready';
  }
  if (ghStepAuth) ghStepAuth.textContent = settingsStatus.githubConnected
    ? ('GitHub auth: installation #' + (settingsStatus.githubInstallationId || 'connected'))
    : (hasInstallSel ? ('GitHub auth: installation #' + installSel.value + ' selected') : 'GitHub auth: not connected');
  if (ghStepRepo) ghStepRepo.textContent = hasRepoSel ? ('Repository selected: ' + repoSel.value) : 'Repository selected: none';
  if (oauthBtn) {
    oauthBtn.disabled = false;
    oauthBtn.title = installMissing.length === 0 ? 'Install/select repos via GitHub App' : 'Configure GitHub App first';
  }
  if (ghFlowHint) {
    if (settingsStatus.githubConnected && settingsStatus.githubInstallationId) {
      ghFlowHint.innerHTML = 'GitHub install bound. Change repo access in GitHub any time, then come back and click <strong>Refresh</strong> or <strong>Load Repos</strong>.';
    } else if (githubInstallPollTimer) {
      ghFlowHint.innerHTML = 'Watching GitHub for install updates now. If the popup stays on <code>settings/installations</code>, save there, then come back here. This panel keeps polling for 90 seconds.';
    } else {
      ghFlowHint.innerHTML = 'If GitHub leaves the popup on <code>settings/installations</code>, come back here. Installations hydrate automatically and selecting one binds it to this session.';
    }
  }
  if (ghInstallMeta) {
    if (settingsStatus.githubConnected && settingsStatus.githubInstallationId && installSummary) {
      ghInstallMeta.innerHTML = '<strong>Bound installation:</strong> ' + esc(installSummary) + '.';
    } else if (settingsStatus.githubConnected && settingsStatus.githubInstallationId) {
      ghInstallMeta.innerHTML = '<strong>Bound installation:</strong> #' + settingsStatus.githubInstallationId + '. Repo access is ready.';
    } else if (hasInstallSel && installSummary) {
      ghInstallMeta.innerHTML = '<strong>Pending bind:</strong> ' + esc(installSummary) + '. Repos load automatically after bind.';
    } else if (hasInstallSel) {
      ghInstallMeta.innerHTML = '<strong>Pending bind:</strong> installation #' + installSel.value + '. Repos load automatically after bind.';
    } else {
      ghInstallMeta.innerHTML = 'No installation loaded yet. Open GitHub, or click <strong>Refresh</strong> if you already granted access.';
    }
  }
  if (ghRepoMeta) {
    if (hasRepoSel && githubVisibleRepos.length > 0 && activeInstall) {
      ghRepoMeta.innerHTML = '<strong>Ready to connect:</strong> ' + esc(repoSel.value) + '. ' + githubVisibleRepos.length + ' granted repo(s) visible from ' + esc(activeInstall.account_login) + '.';
    } else if (hasRepoSel) {
      ghRepoMeta.innerHTML = '<strong>Ready to connect:</strong> ' + esc(repoSel.value) + '.';
    } else if (githubVisibleRepos.length > 0 && activeInstall) {
      ghRepoMeta.innerHTML = '<strong>Granted repos loaded:</strong> ' + githubVisibleRepos.length + ' visible from ' + esc(activeInstall.account_login) + ' (' + esc(githubRepoAccessLabel(activeInstall.repository_selection)) + ').';
    } else if (settingsStatus.githubConnected) ghRepoMeta.innerHTML = 'Installation bound. Click <strong>Load Repos</strong>, or leave search blank to pull every granted repo.';
    else ghRepoMeta.innerHTML = 'Bind an installation first. Blank search loads every granted repo from that installation.';
  }
  if (ghSetupAlert) {
    if (installMissing.length > 0 || appMissing.length > 0) {
      ghSetupAlert.style.display = 'block';
      ghSetupAlert.textContent = 'GitHub App setup: Setup URL = ' + callbackUrl + '. Missing install vars: ' + (installMissing.length ? installMissing.join(', ') : 'none') + '. Missing token vars: ' + (appMissing.length ? appMissing.join(', ') : 'none') + '. Optional identity link: GITHUB_APP_CLIENT_SECRET.';
    } else {
      ghSetupAlert.style.display = 'none';
      ghSetupAlert.textContent = '';
    }
  }
  if (ghStatus) ghStatus.textContent = settingsStatusText();
  if (providerStatus) {
    var anthropicLine = settingsStatus.hasAnthropicAuthToken
      ? 'Anthropic mode: OAuth token (Claude Max compatible)'
      : (settingsStatus.anthropicAuthMode === 'api_key'
        ? 'Anthropic mode: API key'
        : 'Anthropic mode: not configured');
    var codexLine = settingsStatus.codexCliInstalled
      ? (settingsStatus.codexCliAuthenticated
        ? 'Codex CLI: installed + logged in (plan ready)'
        : 'Codex CLI: installed, run codex login to connect your plan')
      : 'Codex CLI: not installed';
    var compactionLine = (settingsStatus.compactionApplied || settingsStatus.compactionDropped || settingsStatus.compactionCharsSaved)
      ? (
        'Compaction: applied ' + (settingsStatus.compactionApplied || 0) +
        ', dropped msgs ' + (settingsStatus.compactionDropped || 0) +
        ', chars saved ' + (settingsStatus.compactionCharsSaved || 0)
      )
      : null;
    var cacheLine = (settingsStatus.cacheReadTokens || settingsStatus.cacheWriteTokens)
      ? (
        'Prompt cache tokens: read ' + (settingsStatus.cacheReadTokens || 0) +
        ', write ' + (settingsStatus.cacheWriteTokens || 0)
      )
      : null;
    providerStatus.textContent =
      anthropicLine + '\\n' +
      codexLine + '\\n' +
      (settingsStatus.codexAuthPath ? ('Codex auth file: ' + settingsStatus.codexAuthPath) : '') +
      (cacheLine ? ('\\n' + cacheLine) : '') +
      (compactionLine ? ('\\n' + compactionLine) : '');
  }
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
  return Promise.all([
    fetch('/api/settings/status').then(function(res){ return res.json(); }),
    fetch('/api/metrics').then(function(res){ return res.json(); }).catch(function(){ return null; }),
  ])
    .then(function(tuple){
      var data = tuple[0] || {};
      var metrics = tuple[1] || {};
      var counters = metrics.counters || {};
      var cacheRead = counters['shipyard.llm.cache_read_tokens'] ? counters['shipyard.llm.cache_read_tokens'].value : 0;
      var cacheWrite = counters['shipyard.llm.cache_write_tokens'] ? counters['shipyard.llm.cache_write_tokens'].value : 0;
      var compactAnth = counters['shipyard.llm.compaction.anthropic_applied'] ? counters['shipyard.llm.compaction.anthropic_applied'].value : 0;
      var compactOai = counters['shipyard.llm.compaction.openai_applied'] ? counters['shipyard.llm.compaction.openai_applied'].value : 0;
      var compactDropped = counters['shipyard.llm.compaction.messages_dropped'] ? counters['shipyard.llm.compaction.messages_dropped'].value : 0;
      var compactChars = counters['shipyard.llm.compaction.chars_saved'] ? counters['shipyard.llm.compaction.chars_saved'].value : 0;
      settingsStatus = {
        workDir: data.workDir || WORK_DIR,
        repoBranch: data.repoBranch || null,
        repoRemote: data.repoRemote || null,
        hasAnthropicAuthToken: !!data.hasAnthropicAuthToken,
        anthropicAuthMode: data.anthropicAuthMode || 'none',
        codexCliInstalled: !!data.codexCliInstalled,
        codexCliAuthenticated: !!data.codexCliAuthenticated,
        codexAuthPath: data.codexAuthPath || null,
        ghAuthenticated: !!data.ghAuthenticated,
        githubConnected: !!data.githubConnected,
        githubLogin: data.githubLogin || null,
        githubOAuthConfigured: !!data.githubOAuthConfigured,
        githubInstallConfigured: !!data.githubInstallConfigured,
        githubAppConfigured: !!data.githubAppConfigured,
        githubInstallMissing: Array.isArray(data.githubInstallMissing) ? data.githubInstallMissing : [],
        githubAppMissing: Array.isArray(data.githubAppMissing) ? data.githubAppMissing : [],
        githubAppSlug: data.githubAppSlug || null,
        githubInstallCallbackUrl: data.githubInstallCallbackUrl || null,
        githubInstallationId: data.githubInstallationId || null,
        cacheReadTokens: cacheRead || 0,
        cacheWriteTokens: cacheWrite || 0,
        compactionApplied: (compactAnth || 0) + (compactOai || 0),
        compactionDropped: compactDropped || 0,
        compactionCharsSaved: compactChars || 0,
      };
      WORK_DIR = settingsStatus.workDir || WORK_DIR;
      renderSettingsStatus();
      return maybeHydrateGithubConnector(false);
    })
    .catch(function(e){ console.warn('refreshSettingsStatus failed:', e); });
}

function saveModelKeys() {
  var anth = document.getElementById('anthropicKeyInput');
  var anthToken = document.getElementById('anthropicAuthTokenInput');
  var oai = document.getElementById('openaiKeyInput');
  var st = document.getElementById('modelKeyStatus');
  persistSettingsInputs();
  var body = {
    anthropicApiKey: anth ? anth.value.trim() : '',
    anthropicAuthToken: anthToken ? anthToken.value.trim() : '',
    openaiApiKey: oai ? oai.value.trim() : '',
  };
  fetch('/api/settings/model-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(body),
  })
    .then(function(res){ return res.json(); })
    .then(function(data){
      if (!data.ok) {
        setSettingsStatus(st, 'Key update failed', 'err');
        return;
      }
      setSettingsStatus(st, 'Keys applied. Anthropic mode: ' + (data.anthropicAuthMode || 'none') + '.', 'ok');
      refreshSettingsStatus();
    })
    .catch(function(err){
      setSettingsStatus(st, 'Key update failed: ' + err.message, 'err');
    });
}

function refreshCheckpoints() {
  var sel = document.getElementById('checkpointSel');
  var st = document.getElementById('checkpointStatus');
  setSettingsStatus(st, 'Loading checkpoints...', '');
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
      setSettingsStatus(st, cps.length ? ('Loaded ' + cps.length + ' checkpoint(s).') : 'No checkpoints yet.', cps.length ? 'ok' : '');
    })
    .catch(function(err){
      setSettingsStatus(st, 'Checkpoint load failed: ' + err.message, 'err');
    });
}

function createCheckpointUi() {
  var st = document.getElementById('checkpointStatus');
  setSettingsStatus(st, 'Creating checkpoint...', '');
  fetch('/api/checkpoints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({}),
  })
    .then(function(res){ return res.json().then(function(body){ return { ok: res.ok, body: body }; }); })
    .then(function(x){
      if (!x.ok) throw new Error(x.body && x.body.message ? x.body.message : (x.body && x.body.error ? x.body.error : 'Failed'));
      setSettingsStatus(st, x.body.message || 'Checkpoint created.', 'ok');
      refreshCheckpoints();
    })
    .catch(function(err){
      setSettingsStatus(st, 'Checkpoint create failed: ' + err.message, 'err');
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
  setSettingsStatus(st, 'Rolling back checkpoint...', '');
  fetch('/api/checkpoints/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ checkpointId: checkpointId }),
  })
    .then(function(res){ return res.json().then(function(body){ return { ok: res.ok, body: body }; }); })
    .then(function(x){
      if (!x.ok) throw new Error(x.body && x.body.message ? x.body.message : (x.body && x.body.error ? x.body.error : 'Failed'));
      setSettingsStatus(st, x.body.message || 'Rollback completed.', 'ok');
      refreshCheckpoints();
    })
    .catch(function(err){
      setSettingsStatus(st, 'Rollback failed: ' + err.message, 'err');
    });
}

function startGithubOAuth() {
  var st = document.getElementById('ghStatus');
  if (!settingsStatus.githubInstallConfigured) {
    var wrap = document.getElementById('ghAppCfgWrap');
    if (wrap) wrap.style.display = 'block';
    setSettingsStatus(st, 'Configure and save GitHub App fields first.', 'err');
    return;
  }
  var w = window.open('/api/github/install/start', 'shipyard_github_oauth', 'width=760,height=860');
  if (!w) {
    setSettingsStatus(st, 'Popup blocked. Allow popups and retry.', 'err');
    return;
  }
  githubHydrationAttempted = true;
  setSettingsStatus(st, 'Popup opened. If GitHub stays on install settings, this panel keeps refreshing installations and binds one when you pick it.', '');
  startGithubInstallPolling(w);
  window.setTimeout(function(){ void loadGithubInstallations({ quiet: true, autoSelectSingle: true, autoUsePreferred: true }); }, 1200);
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
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({
      slug: slugEl ? slugEl.value.trim() : '',
      appId: idEl ? idEl.value.trim() : '',
      privateKey: pkEl ? pkEl.value.trim() : '',
    }),
  })
    .then(function(res){ return res.json(); })
    .then(function(data){
      if (!data.ok) {
        setSettingsStatus(st, 'Save failed', 'err');
        return;
      }
      setSettingsStatus(st, 'Saved. You can now click Connect GitHub.', 'ok');
      refreshSettingsStatus();
    })
    .catch(function(err){
      setSettingsStatus(st, 'Save failed: ' + err.message, 'err');
    });
}

function logoutGithubOAuth() {
  var st = document.getElementById('ghStatus');
  fetch('/api/github/install/logout', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    .then(function(res){ return res.json(); })
    .then(function(data){
      if (!data.ok) {
        setSettingsStatus(st, 'Logout failed', 'err');
        return;
      }
      setSettingsStatus(st, 'Disconnected GitHub OAuth session.', 'ok');
      saveDashboardPref(GH_INSTALLATION_STORAGE, '');
      githubHydrationAttempted = false;
      githubVisibleInstallations = [];
      githubVisibleRepos = [];
      stopGithubInstallPolling();
      refreshSettingsStatus();
      var installSel = document.getElementById('ghInstallSel');
      if (installSel) installSel.innerHTML = '<option value="">(load installations first)</option>';
      var sel = document.getElementById('ghRepoSel');
      if (sel) sel.innerHTML = '<option value="">(load repos first)</option>';
    })
    .catch(function(err){
      setSettingsStatus(st, 'Logout failed: ' + err.message, 'err');
    });
}

function loadGithubInstallations(autoSelectSingle) {
  var opts = normalizeGithubInstallLoadOptions(autoSelectSingle);
  var sel = document.getElementById('ghInstallSel');
  var st = document.getElementById('ghStatus');
  if (!opts.quiet) setSettingsStatus(st, 'Loading installations...', '');
  return fetch('/api/github/installations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: '{}',
  })
    .then(function(res){
      return res.json().then(function(body){ return { ok: res.ok, body: body }; });
    })
    .then(function(x){
      if (!x.ok) throw new Error(x.body && x.body.error ? x.body.error : 'Failed to load installations');
      var data = x.body || {};
      var installs = Array.isArray(data.installations) ? data.installations : [];
      githubVisibleInstallations = installs;
      if (sel) {
        sel.innerHTML = installs.length
          ? installs.map(function(inst){
              var label = inst.account_login + ' · ' + githubRepoAccessLabel(inst.repository_selection || 'selected') + ' · #' + inst.id;
              return '<option value="' + esc(inst.id) + '">' + esc(label) + '</option>';
            }).join('')
          : '<option value="">(no installations found)</option>';
        var preferred = String(settingsStatus.githubInstallationId || loadDashboardPref(GH_INSTALLATION_STORAGE) || '');
        if (preferred) {
          for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === preferred) sel.value = preferred;
          }
        }
        if ((!preferred || !sel.value) && opts.autoSelectSingle && installs.length === 1) {
          sel.value = String(installs[0].id);
        }
        if (sel.value && (opts.autoUsePreferred || (opts.autoSelectSingle && installs.length === 1))) {
          return useGithubInstallation(true);
        }
      }
      renderSettingsStatus();
      if (!opts.quiet) setSettingsStatus(st, installs.length ? ('Loaded ' + installs.length + ' installations.') : 'No installations found.', installs.length ? 'ok' : 'err');
      return false;
    })
    .catch(function(err){
      if (!opts.quiet) setSettingsStatus(st, 'Installation load failed: ' + err.message, 'err');
      return false;
    });
}

function useGithubInstallation(autoLoadRepos) {
  var sel = document.getElementById('ghInstallSel');
  var st = document.getElementById('ghStatus');
  var installationId = sel ? sel.value : '';
  if (!installationId) {
    setSettingsStatus(st, 'Select an installation first.', 'err');
    return Promise.resolve(false);
  }
  saveDashboardPref(GH_INSTALLATION_STORAGE, installationId);
  githubVisibleRepos = [];
  var repoSel = document.getElementById('ghRepoSel');
  if (repoSel) repoSel.innerHTML = '<option value="">(loading repos after bind)</option>';
  setSettingsStatus(st, 'Using installation #' + installationId + '...', '');
  renderSettingsStatus();
  return fetch('/api/github/install/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ installationId: Number(installationId) }),
  })
    .then(function(res){
      return res.json().then(function(body){ return { ok: res.ok, body: body }; });
    })
    .then(function(x){
      if (!x.ok) throw new Error(x.body && x.body.error ? x.body.error : 'Failed to select installation');
      setSettingsStatus(st, 'Using installation #' + installationId + '.', 'ok');
      return refreshSettingsStatus().then(function(){
        if (autoLoadRepos) return loadGithubRepos().then(function(){ return true; });
        return true;
      });
    })
    .catch(function(err){
      setSettingsStatus(st, 'Installation select failed: ' + err.message, 'err');
      return false;
    });
}

function loadGithubRepos() {
  var queryEl = document.getElementById('ghRepoSearchInput');
  var query = queryEl ? queryEl.value.trim() : '';
  var sel = document.getElementById('ghRepoSel');
  var st = document.getElementById('ghStatus');
  setSettingsStatus(st, 'Loading repositories...', '');
  return fetch('/api/github/repos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ query: query }),
  })
    .then(function(res){
      return res.json().then(function(body){ return { ok: res.ok, body: body }; });
    })
    .then(function(x){
      if (!x.ok) throw new Error(x.body && x.body.error ? x.body.error : 'Failed to load repositories');
      var data = x.body || {};
      var repos = Array.isArray(data.repos) ? data.repos : [];
      githubVisibleRepos = repos;
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
      if (sel && !sel.value && repos.length === 1) {
        sel.value = repos[0].full_name;
        saveDashboardPref(GH_REPO_STORAGE, repos[0].full_name);
      }
      renderSettingsStatus();
      setSettingsStatus(st, repos.length ? ('Loaded ' + repos.length + ' repos.') : 'No repos found. Try a different query, or leave search blank for all granted repos.', repos.length ? 'ok' : 'err');
      return repos;
    })
    .catch(function(err){
      githubVisibleRepos = [];
      setSettingsStatus(st, 'Repo load failed: ' + err.message, 'err');
      return [];
    });
}

function maybeHydrateGithubConnector(force) {
  if (!settingsStatus.githubAppConfigured) return Promise.resolve(false);
  if (!force && githubHydrationAttempted) return Promise.resolve(false);
  githubHydrationAttempted = true;
  if (settingsStatus.githubConnected) {
    var repoSel = document.getElementById('ghRepoSel');
    if (repoSel && repoSel.options.length > 1) return Promise.resolve(false);
    return loadGithubRepos().then(function(){ return true; });
  }
  return loadGithubInstallations({ quiet: true, autoSelectSingle: true, autoUsePreferred: true });
}

function connectGithubRepo() {
  var sel = document.getElementById('ghRepoSel');
  var repo = sel ? sel.value : '';
  var st = document.getElementById('ghStatus');
  if (!repo) {
    setSettingsStatus(st, 'Select a repository first.', 'err');
    return;
  }
  saveDashboardPref(GH_REPO_STORAGE, repo);
  setSettingsStatus(st, 'Connecting ' + repo + '...', '');
  fetch('/api/github/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ repoFullName: repo }),
  })
    .then(function(res){
      return res.json().then(function(body){ return { ok: res.ok, body: body }; });
    })
    .then(function(x){
      if (!x.ok) {
        setSettingsStatus(st, (x.body && x.body.error) ? x.body.error : 'Connect failed', 'err');
        return;
      }
      var data = x.body || {};
      settingsStatus.workDir = data.workDir;
      settingsStatus.repoBranch = data.branch || null;
      settingsStatus.repoRemote = 'https://github.com/' + repo + '.git';
      WORK_DIR = data.workDir || WORK_DIR;
      renderSettingsStatus();
      refreshRunsFromApi();
      setSettingsStatus(st, 'Connected to ' + repo + ' at ' + data.workDir, 'ok');
    })
    .catch(function(err){
      setSettingsStatus(st, 'Connect failed: ' + err.message, 'err');
    });
}

/* ---- Provider readiness ---- */
function refreshProviderReadiness() {
  var grid = document.getElementById('providerReadinessGrid');
  var badge = document.getElementById('providerReadyBadge');
  var st = document.getElementById('providerReadinessStatus');
  setBadge(badge, 'Checking...', 'warn');
  setSettingsStatus(st, '', '');
  return fetch('/api/providers/readiness')
    .then(function(res){ return res.json(); })
    .then(function(report){
      if (!grid) return;
      var providers = Array.isArray(report.providers) ? report.providers : [];
      var html = '';
      for (var i = 0; i < providers.length; i++) {
        var p = providers[i];
        var dotCls = p.available ? 'ok' : 'off';
        html += '<div class="provider-row">' +
          '<span class="provider-dot ' + dotCls + '"></span>' +
          '<span class="provider-name">' + esc(p.provider) + '</span>' +
          '<span class="provider-detail">' + esc(p.detail) +
          (p.authMethod && p.authMethod !== 'none' ? ' [' + esc(p.authMethod) + ']' : '') +
          '</span>' +
          '</div>';
        if (p.remediation) {
          html += '<div class="provider-remediation" style="margin-left:16px">' + esc(p.remediation) + '</div>';
        }
      }
      grid.innerHTML = html;
      setBadge(badge, report.ready ? 'Ready' : 'Not Ready', report.ready ? 'ok' : 'off');
      setSettingsStatus(st, report.ready ? 'At least one LLM provider available.' : 'No LLM provider configured. Add Anthropic or OpenAI keys above.', report.ready ? 'ok' : 'err');
    })
    .catch(function(err){
      setBadge(badge, 'Error', 'off');
      setSettingsStatus(st, 'Failed to check provider readiness: ' + err.message, 'err');
    });
}

/* ---- Benchmark summary ---- */
function fmtSummaryPct(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '0.0%';
  return (v * 100).toFixed(1) + '%';
}
function fmtSummaryMs(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '0ms';
  if (v < 1000) return Math.round(v) + 'ms';
  return (v / 1000).toFixed(1) + 's';
}
function renderBenchmarkSummary() {
  var el = document.getElementById('benchSummaryStatus');
  if (!el) return;
  if (!benchmarkSummary) {
    el.textContent = 'No summary yet. Run pnpm bench:agent.';
    return;
  }
  var src = benchmarkSummary.source === 'suite'
    ? ('suite @ ' + (benchmarkSummary.createdAt || 'unknown'))
    : 'derived from run history';
  el.textContent =
    'source: ' + src + '\\n' +
    'median: ' + fmtSummaryMs(benchmarkSummary.medianDurationMs) + '\\n' +
    'p95: ' + fmtSummaryMs(benchmarkSummary.p95DurationMs) + '\\n' +
    'avg tools/run: ' + (typeof benchmarkSummary.avgToolCalls === 'number' ? benchmarkSummary.avgToolCalls.toFixed(2) : '0.00') + '\\n' +
    'retries/run: ' + (typeof benchmarkSummary.retriesPerRun === 'number' ? benchmarkSummary.retriesPerRun.toFixed(2) : '0.00') + '\\n' +
    'edit success: ' + fmtSummaryPct(benchmarkSummary.fileEditSuccessRate) + '\\n' +
    'PR success: ' + fmtSummaryPct(benchmarkSummary.prSuccessRate);
}
function refreshBenchmarkSummary() {
  return fetch('/api/benchmarks/summary')
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      benchmarkSummary = data;
      renderBenchmarkSummary();
    })
    .catch(function(err){
      console.warn('[dashboard] benchmark summary refresh failed', err);
      benchmarkSummary = null;
      renderBenchmarkSummary();
    });
}

/* ---- Ack Comment Template ---- */
function previewAckTemplate() {
  var inp = document.getElementById("ackTemplateInput");
  var prev = document.getElementById("ackTemplatePreview");
  if (!inp || !prev) return;
  var tpl = inp.value || inp.placeholder || "";
  var rendered = tpl
    .replace(/\{\{repo\}\}/g, "owner/repo")
    .replace(/\{\{issue\}\}/g, "#42")
    .replace(/\{\{runId\}\}/g, "abc-123")
    .replace(/\{\{status\}\}/g, "accepted");
  prev.textContent = rendered;
  prev.style.display = "block";
}
function saveAckTemplate() {
  var inp = document.getElementById("ackTemplateInput");
  var st = document.getElementById("ackTemplateStatus");
  if (!inp) return;
  fetch("/api/settings/ack-template", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify({ template: inp.value })
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) { setSettingsStatus(st, "Template saved", "ok"); }
    else { setSettingsStatus(st, d.error || "Save failed", "err"); }
  }).catch(function(e) {
    setSettingsStatus(st, "Save failed: " + e.message, "err");
  });
}
function loadAckTemplate() {
  var inp = document.getElementById("ackTemplateInput");
  if (!inp) return;
  fetch("/api/settings/ack-template").then(function(r) { return r.json(); }).then(function(d) {
    if (d.template) inp.value = d.template;
  }).catch(function() {});
}


/* ---- Settings event dispatcher (called from main delegation) ---- */
function handleSettingsAction(action) {
  if (action === 'openSettings') { openSettings(); return true; }
  if (action === 'closeSettings') { closeSettings(); return true; }
  if (action === 'toggleSettingsSection') { return false; /* handled separately with data-section */ }
  if (action === 'saveModelKeys') { saveModelKeys(); return true; }
  if (action === 'refreshProviderReadiness') { refreshProviderReadiness(); return true; }
  if (action === 'refreshCheckpoints') { refreshCheckpoints(); return true; }
  if (action === 'createCheckpoint') { createCheckpointUi(); return true; }
  if (action === 'rollbackCheckpoint') { rollbackCheckpointUi(); return true; }
  if (action === 'loadGithubInstallations') { loadGithubInstallations(false); return true; }
  if (action === 'useGithubInstallation') { useGithubInstallation(true); return true; }
  if (action === 'loadGithubRepos') { loadGithubRepos(); return true; }
  if (action === 'connectGithubRepo') { connectGithubRepo(); return true; }
  if (action === 'startGithubOAuth') { startGithubOAuth(); return true; }
  if (action === 'logoutGithubOAuth') { logoutGithubOAuth(); return true; }
  if (action === 'toggleGithubAppConfig') { toggleGithubAppConfig(); return true; }
  if (action === 'saveGithubAppConfig') { saveGithubAppConfig(); return true; }
  if (action === "previewAckTemplate") { previewAckTemplate(); return true; }
  if (action === "saveAckTemplate") { saveAckTemplate(); return true; }
  return false;
}

/* ---- Settings init (wire change listeners) ---- */
function initSettings() {
  restoreSettingsInputs();
  githubHydrationAttempted = false;
  renderSettingsStatus();
  void refreshSettingsStatus().then(function(){ return maybeHydrateGithubConnector(true); });
  loadAckTemplate();
  var anthKeyEl = document.getElementById('anthropicKeyInput');
  if (anthKeyEl) anthKeyEl.addEventListener('change', persistSettingsInputs);
  var anthTokenEl = document.getElementById('anthropicAuthTokenInput');
  if (anthTokenEl) anthTokenEl.addEventListener('change', persistSettingsInputs);
  var oaiKeyEl = document.getElementById('openaiKeyInput');
  if (oaiKeyEl) oaiKeyEl.addEventListener('change', persistSettingsInputs);
  var ghAppSlugEl = document.getElementById('ghAppSlugInput');
  if (ghAppSlugEl) ghAppSlugEl.addEventListener('change', persistSettingsInputs);
  var ghAppIdEl = document.getElementById('ghAppIdInput');
  if (ghAppIdEl) ghAppIdEl.addEventListener('change', persistSettingsInputs);
  var ghAppPkEl = document.getElementById('ghAppPkInput');
  if (ghAppPkEl) ghAppPkEl.addEventListener('change', persistSettingsInputs);
  var ghInstallSelEl = document.getElementById('ghInstallSel');
  if (ghInstallSelEl) ghInstallSelEl.addEventListener('change', function(){
    saveDashboardPref(GH_INSTALLATION_STORAGE, ghInstallSelEl.value || '');
    githubVisibleRepos = [];
    saveDashboardPref(GH_REPO_STORAGE, '');
    if (ghRepoSelEl) ghRepoSelEl.innerHTML = '<option value="">(load repos after bind)</option>';
    renderSettingsStatus();
    if (ghInstallSelEl.value) void useGithubInstallation(true);
  });
  var ghRepoSelEl = document.getElementById('ghRepoSel');
  if (ghRepoSelEl) ghRepoSelEl.addEventListener('change', function(){ saveDashboardPref(GH_REPO_STORAGE, ghRepoSelEl.value || ''); renderSettingsStatus(); });
  window.addEventListener('message', function(ev){
    if (ev.origin !== window.location.origin) return;
    var data = ev && ev.data;
    if (!data || (data.type !== 'shipyard_github_oauth' && data.type !== 'shipyard_github_install')) return;
    var st = document.getElementById('ghStatus');
    if (data.ok) {
      setSettingsStatus(st, data.message || 'GitHub install completed.', 'ok');
      stopGithubInstallPolling();
      refreshSettingsStatus().then(function(){ return loadGithubInstallations(true); }).then(function(selected){
        if (settingsStatus.githubConnected || selected) return loadGithubRepos();
        return null;
      });
    } else {
      setSettingsStatus(st, data.message || 'GitHub install failed', 'err');
      refreshSettingsStatus();
    }
  });
}
`;
}
