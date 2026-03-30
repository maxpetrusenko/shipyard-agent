import { MODEL_CATALOG } from '../config/model-policy.js';

function renderComposerModelOptions(): string {
  return MODEL_CATALOG
    .filter((item) => item.id === 'gpt-5.4' || item.id === 'gpt-5.4-mini')
    .map((item) => {
      const selected = item.id === 'gpt-5.4-mini' ? ' selected' : '';
      return `<option value="${item.id}"${selected}>${item.label}</option>`;
    })
    .join('\n        ');
}

/**
 * Extracted composer component for the dashboard.
 * Exports CSS, HTML, and JS strings for the sticky bottom composer bar.
 *
 * Claude Cowork-style project-scoped input: rounded card, centered textarea,
 * project chip, attach button, compact model selector, circular send button.
 */

export function getComposerStyles(): string {
  return `
/* ---- Composer wrapper ---- */
.composer-wrap{position:sticky;bottom:0;z-index:var(--z-composer);flex-shrink:0;padding:16px 16px 0;background:linear-gradient(180deg,transparent 0%,var(--bg) 40%)}

/* ---- Card ---- */
.composer-inner{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:0;box-shadow:0 1px 4px rgba(0,0,0,.04)}

/* ---- Hint ---- */
.composer-hint-bar{padding:8px 16px 0;font-size:11px;color:var(--dim);line-height:1.45}

/* ---- Textarea area ---- */
.composer-ta-wrap{padding:12px 16px 4px}
.composer-ta{width:100%;min-height:42px;max-height:min(38dvh,260px);resize:none;overflow-y:auto;background:transparent;color:var(--text);border:none;outline:none;font-family:var(--sans,system-ui,-apple-system,sans-serif);font-size:14px;line-height:1.55;padding:0;transition:none}
.composer-ta::placeholder{color:var(--muted);opacity:.65}
.composer-ta:focus{outline:none}

/* ---- Plan doc ---- */
.plan-doc-wrap{padding:0 16px}
.plan-doc-wrap textarea{width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;font-family:var(--mono);color:var(--text);background:var(--bg2);resize:vertical;min-height:80px}

/* ---- Bottom toolbar ---- */
.composer-bottom{display:flex;align-items:center;gap:6px;padding:6px 10px 10px 12px}

/* -- Project chip -- */
.composer-project-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;background:var(--bg2);border:1px solid var(--border);font-size:12px;color:var(--dim);cursor:pointer;transition:all .15s ease;white-space:nowrap;flex-shrink:0;font-family:var(--sans);appearance:none}
.composer-project-chip:hover{background:var(--bg);border-color:var(--accent);color:var(--text)}
.composer-project-chip svg{width:13px;height:13px;opacity:.55;flex-shrink:0}

/* -- Mode segment -- */
.composer-mode-seg{display:inline-flex;align-items:center;gap:3px;padding:2px;border:1px solid var(--border);border-radius:999px;background:var(--bg2);flex-shrink:0}
.composer-mode-btn{border:none;background:transparent;color:var(--dim);padding:5px 9px;border-radius:999px;font-size:11px;font-family:var(--sans);cursor:pointer;transition:all .15s ease}
.composer-mode-btn:hover{color:var(--text)}
.composer-mode-btn.active{background:var(--accent-glow);color:var(--accent)}

/* -- Attach button -- */
.composer-attach-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:16px;transition:all .15s ease;flex-shrink:0;padding:0}
.composer-attach-btn:hover{background:var(--bg2);color:var(--accent);border-color:var(--accent)}

/* -- Spacer -- */
.composer-spacer{flex:1}

/* -- Model selector (compact) -- */
.composer-model-sel{background:transparent;border:1px solid var(--border);color:var(--dim);border-radius:8px;padding:4px 8px;font-size:12px;font-family:var(--sans,system-ui,-apple-system,sans-serif);cursor:pointer;transition:all .15s ease;max-width:180px;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23999'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 6px center;padding-right:20px}
.composer-model-sel:hover{border-color:var(--accent);color:var(--text)}
.composer-model-sel:focus{border-color:var(--accent);outline:none}

/* -- Status -- */
.composer-status{font-size:11px;color:var(--dim);white-space:nowrap;margin-right:4px}

/* -- Stop button -- */
.composer-stop-btn{display:inline-flex;align-items:center;justify-content:center;padding:4px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--dim);cursor:pointer;font-size:12px;transition:all .15s ease;white-space:nowrap}
.composer-stop-btn:hover{background:rgba(220,50,50,.08);border-color:var(--red);color:var(--red)}

/* -- Send button (circular, accent) -- */
.composer-send{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;min-width:36px;padding:0;border-radius:50%;background:var(--accent);color:#fff;border:none;cursor:pointer;transition:all .15s ease;flex-shrink:0}
.composer-send svg{width:16px;height:16px}
.composer-send:hover{transform:scale(1.06);box-shadow:0 2px 10px rgba(0,0,0,.15)}
.composer-send:active{transform:scale(.95)}
.composer-send:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.composer-send:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none}
.composer-send-hidden{opacity:.55}

/* ---- Project hero (state-home centered view) ---- */
.project-hero-title{font-family:var(--sans);font-size:22px;font-weight:700;color:var(--text-bright);letter-spacing:-.02em;margin-bottom:6px;text-align:center}
.project-hero-sub{font-size:12px;color:var(--muted);margin-bottom:24px;text-align:center}
.project-hero .composer-wrap{position:static;padding:0;background:none;width:100%;max-width:560px}
`;
}

export function getComposerHtml(): string {
  return `
<div class="composer-wrap">
  <div class="composer-inner">
    <!-- Hint bar -->
    <div id="composerHint" class="composer-hint-bar" style="display:none"></div>

    <!-- Textarea -->
    <div class="composer-ta-wrap">
      <textarea id="instr" class="composer-ta" rows="1" placeholder="What would you like to work on?" autocomplete="off"></textarea>
    </div>

    <!-- Plan doc (hidden by default) -->
    <div id="planDocWrap" class="plan-doc-wrap" style="display:none;padding-bottom:6px">
      <textarea id="planDoc" rows="5" placeholder="Paste a plan, PRD, spec, or wireframes here. Shipyard will use it as guidance and move straight into execution."></textarea>
    </div>

    <!-- Bottom toolbar row -->
    <div class="composer-bottom">
      <!-- Project chip -->
      <button type="button" class="composer-project-chip" id="composerProjectChip" title="Project scope" data-action="focusProjectList">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5V12a1.5 1.5 0 001.5 1.5h9A1.5 1.5 0 0014 12V6.5A1.5 1.5 0 0012.5 5H8L6.5 3H3.5A1.5 1.5 0 002 4.5z"/></svg>
        <span id="composerProjectLabel">Default Project</span>
      </button>

      <!-- Attach button (opens plan doc) -->
      <button type="button" class="composer-attach-btn" data-action="togglePlanDoc" title="Toggle plan doc" aria-label="Toggle plan doc" aria-expanded="false">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5H5.5A1.5 1.5 0 004 5v6A1.5 1.5 0 005.5 12.5h5A1.5 1.5 0 0012 11V5.5"/><path d="M9 3.5h2.5V6"/><path d="M8.5 4.5l3 3"/></svg>
      </button>

      <div class="composer-mode-seg" id="modeSegCtrl" aria-label="Composer mode">
        <button type="button" class="composer-mode-btn" data-action="setMode" data-mode="ask">Ask</button>
        <button type="button" class="composer-mode-btn" data-action="setMode" data-mode="plan">Plan</button>
        <button type="button" class="composer-mode-btn active" data-action="setMode" data-mode="agent">Agent</button>
      </div>

      <select id="uiModeSel" style="display:none" aria-hidden="true" tabindex="-1">
        <option value="ask">Ask</option>
        <option value="plan">Plan</option>
        <option value="agent" selected>Agent</option>
      </select>

      <span class="composer-spacer"></span>

      <!-- Status -->
      <span id="subSt" class="composer-status" aria-live="polite"></span>

      <!-- Stop button -->
      <button type="button" class="composer-stop-btn" id="stopBtn" data-action="stop" style="display:none">Stop</button>

      <!-- Model selector (compact) -->
      <select id="modelSel" class="composer-model-sel" title="Model override">
        ${renderComposerModelOptions()}
      </select>

      <!-- Send button (circular, accent) -->
      <button type="button" class="composer-send composer-send-hidden" id="subBtn" data-action="submit" aria-label="Send" title="Send (Cmd+Enter)">
        <span class="composer-btn-icon" aria-hidden="true" style="display:flex;align-items:center;justify-content:center">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 2.1a.75.75 0 01.95-.37l10.5 4.5a.75.75 0 010 1.37l-10.5 4.5a.75.75 0 01-1.02-.88L3.88 8 2.43 4.78a.75.75 0 01.07-.68z"/></svg>
        </span>
      </button>
    </div>
  </div>
</div>
`;
}

export function getComposerScript(): string {
  return `
/* ---- Composer: auto-grow textarea ---- */
function initComposerAutoGrow() {
  var ta = document.getElementById('instr');
  if (!ta) return;
  ta.addEventListener('input', function() {
    ta.style.height = 'auto';
    var maxH = Math.min(window.innerHeight * 0.38, 260);
    var lineH = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    var maxLines = 8;
    var clamped = Math.min(ta.scrollHeight, lineH * maxLines, maxH);
    ta.style.height = clamped + 'px';
    updateComposerSendVisibility();
  });
}

function currentProjectContext() {
  var selected = typeof getSelectedProject === 'function' ? getSelectedProject() : { id: 'default', label: 'Default Project' };
  var run = selectedRunId ? runsMap[selectedRunId] : null;
  if (run && run.projectContext && run.projectContext.projectId) {
    return {
      id: run.projectContext.projectId,
      label: run.projectContext.projectLabel || selected.label || 'Project',
      workDir: run.workDir || selected.workDir || WORK_DIR,
    };
  }
  return {
    id: (selected && selected.id) || 'default',
    label: (selected && selected.label) || 'Default Project',
    workDir: (selected && selected.workDir) || WORK_DIR,
  };
}

function syncProjectChrome() {
  var project = currentProjectContext();
  WORK_DIR = project.workDir || WORK_DIR;
  var chipLabel = document.getElementById('composerProjectLabel');
  if (chipLabel) chipLabel.textContent = project.label;
  var heroTitle = document.getElementById('projectHeroTitle');
  if (heroTitle) heroTitle.textContent = project.label;
  var heroSub = document.getElementById('projectHeroSub');
  if (heroSub) {
    heroSub.textContent = followupMode()
      ? 'Continue work in the selected thread.'
      : 'What would you like to work on?';
  }
}

/* ---- Composer UI sync ---- */
function syncComposerUi() {
  var ta = document.getElementById('instr');
  var hint = document.getElementById('composerHint');
  var r = selectedRunId ? runsMap[selectedRunId] : null;
  if (followupMode()) {
    var kind = r && r.threadKind ? String(r.threadKind) : 'selected';
    if (ta) ta.placeholder = 'Follow up in this ' + kind + ' thread\\u2026';
    if (hint) hint.style.display = 'none';
  } else {
    if (ta) ta.placeholder = 'What would you like to work on?';
    if (hint) hint.style.display = 'none';
  }
  syncComposerPrimaryButton();
  syncStopButton();
  syncProjectChrome();
}

function updateComposerSendVisibility() {
  var ta = document.getElementById('instr');
  var btn = document.getElementById('subBtn');
  if (!ta || !btn) return;
  var has = ta.value.trim().length > 0;
  btn.disabled = !has;
  if (has) btn.classList.remove('composer-send-hidden');
  else btn.classList.add('composer-send-hidden');
}

function composerModeValue() {
  var sel = document.getElementById('uiModeSel');
  if (!sel || !sel.value) return 'agent';
  return sel.value;
}

function syncComposerModeUi() {
  var mode = composerModeValue();
  var seg = document.getElementById('modeSegCtrl');
  if (!seg) return;
  var buttons = seg.querySelectorAll('[data-action=\"setMode\"]');
  for (var i = 0; i < buttons.length; i++) {
    var modeBtn = buttons[i];
    var active = modeBtn.dataset.mode === mode;
    modeBtn.classList.toggle('active', active);
    modeBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function setComposerMode(mode) {
  var next = mode === 'ask' || mode === 'plan' || mode === 'agent' ? mode : 'agent';
  var sel = document.getElementById('uiModeSel');
  if (sel) sel.value = next;
  saveDashboardPref(DASH_MODE_KEY, next);
  syncComposerModeUi();
}

function syncComposerPrimaryButton() {
  var btn = document.getElementById('subBtn');
  if (!btn) return;
  var icon = btn.querySelector('.composer-btn-icon');
  if (!icon) {
    btn.innerHTML = '<span class="composer-btn-icon" aria-hidden="true" style="display:flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 2.1a.75.75 0 01.95-.37l10.5 4.5a.75.75 0 010 1.37l-10.5 4.5a.75.75 0 01-1.02-.88L3.88 8 2.43 4.78a.75.75 0 01.07-.68z"/></svg></span>';
    icon = btn.querySelector('.composer-btn-icon');
  }
  btn.dataset.action = 'submit';
  btn.className = 'composer-send';
  if (followupMode()) {
    btn.setAttribute('aria-label', 'Send follow-up');
    btn.setAttribute('title', 'Send follow-up (Cmd+Enter)');
  } else {
    btn.setAttribute('aria-label', 'Submit run');
    btn.setAttribute('title', 'Submit run (Cmd+Enter)');
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

function followupMode() {
  var r = selectedRunId ? runsMap[selectedRunId] : null;
  return !!(r && r.threadKind);
}

/* ---- Run actions ---- */
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
    followupBody.uiMode = composerModeValue();
    var followupModelEl = document.getElementById('modelSel');
    followupBody.model = '';
    if (followupModelEl) followupBody.model = followupModelEl.value;
    var fuProj = typeof getSelectedProject === 'function' ? getSelectedProject() : null;
    if (fuProj) followupBody.projectContext = { projectId: fuProj.id, projectLabel: fuProj.label };
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
              projectContext: d.projectContext !== undefined ? d.projectContext : cur.projectContext || (fuProj ? { projectId: fuProj.id, projectLabel: fuProj.label } : null),
            });
          } else {
            var ex = runsMap[fuId] || { runId: fuId };
            var prev = Array.isArray(ex.messages) ? ex.messages.slice() : [];
            var nextKind = d.threadKind || ex.threadKind || 'ask';
            var queuedPhase = nextKind === 'ask' ? 'routing' : 'planning';
            prev.push({ role: 'user', content: inst });
            curRunId = fuId;
            lastState = Object.assign({}, lastState, { runId: fuId, phase: queuedPhase });
            runsMap[fuId] = mergeRunRecord(ex, {
              runId: fuId,
              messages: prev,
              phase: queuedPhase,
              threadKind: nextKind,
              runMode: d.runMode || (nextKind === 'ask' ? 'chat' : 'code'),
              projectContext: d.projectContext !== undefined ? d.projectContext : ex.projectContext || (fuProj ? { projectId: fuProj.id, projectLabel: fuProj.label } : null),
            });
            if (typeof syncTimelineFromRun === 'function') syncTimelineFromRun(fuId, runsMap[fuId]);
          }
          ta.value = '';
          ta.style.height = 'auto';
          renderChatList();
          renderChatThread();
          if (typeof renderProjectList === 'function') renderProjectList();
        } else st.textContent = 'Error: ' + (d.error||'unknown');
      })
      .catch(function(e){ st.textContent = 'Error: ' + e.message; })
      .finally(function(){ btn.disabled = false; btn.removeAttribute('aria-busy'); syncComposerUi(); });
    return;
  }

  var body = { instruction: inst };
  var pdVal = pdTa ? pdTa.value.trim() : '';
  if (pdVal) body.planDoc = pdVal;
  body.uiMode = composerModeValue();
  body.runMode = body.uiMode === 'ask' ? 'chat' : body.uiMode === 'plan' ? 'code' : 'auto';
  var mdEl = document.getElementById('modelSel');
  if (mdEl && mdEl.value) body.model = mdEl.value;
  var proj = typeof getSelectedProject === 'function' ? getSelectedProject() : null;
  if (proj) body.projectContext = { projectId: proj.id, projectLabel: proj.label };
  persistDashboardModelSel();

  st.textContent = 'Submitting\\u2026';
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
          projectContext: d.projectContext !== undefined ? d.projectContext : existing.projectContext || (proj ? { projectId: proj.id, projectLabel: proj.label } : null),
          savedAt: new Date().toISOString()
        });
        if (typeof syncTimelineFromRun === 'function') syncTimelineFromRun(d.runId, runsMap[d.runId]);
        renderChatList();
        renderChatThread();
        if (typeof renderProjectList === 'function') renderProjectList();
        ta.value = '';
        ta.style.height = 'auto';
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
        if (st) st.textContent = 'Plan confirmed, executing\\u2026';
        if (runId) selectChat(runId);
      }
      else { if (st) st.textContent = 'Error: ' + (d.error||'unknown'); }
    })
    .catch(function(e){ if (st) st.textContent = 'Error: ' + e.message; });
}

function stopRun() {
  var st = document.getElementById('subSt');
  fetch('/api/cancel', { method:'POST' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (st) st.textContent = d.cancelled ? 'Stop requested' : 'No active run to stop';
      fetch('/api/runs?limit=' + DASHBOARD_RUN_HISTORY_LIMIT)
        .then(function(r2){ return r2.json(); })
        .then(function(list){
          for (var i = 0; i < list.length; i++) {
            mergeRunIntoMap(list[i]);
          }
          renderChatList();
          if (selectedRunId) renderChatThread();
          if (selectedRunId) void refreshRunDetails(selectedRunId);
        })
        .catch(function(){});
    })
    .catch(function(){ if (st) st.textContent = 'Stop failed'; });
}

function resumeRunById(runId) {
  fetch('/api/runs/' + runId + '/resume', { method:'POST' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      document.getElementById('subSt').textContent = d.runId ? ('Resumed ' + d.runId.slice(0,8)) : ('Error: ' + (d.error||'unknown'));
    }).catch(function(e){ document.getElementById('subSt').textContent = 'Error: ' + e.message; });
}

/* ---- Persistence ---- */
function persistDashboardModelSel() {
  persistDashboardSelect('modelSel', DASH_MODEL_KEY);
}

function restoreDashboardModelSel() {
  var sel = document.getElementById('modelSel');
  if (!sel) return;
  restoreDashboardSelect('modelSel', DASH_MODEL_KEY);
  if (!sel.value) sel.value = 'gpt-5.4-mini';
  persistDashboardModelSel();
}

function restoreDashboardModeSel() {
  var saved = loadDashboardPref(DASH_MODE_KEY) || 'agent';
  setComposerMode(saved);
}

/* ---- Composer init (call after DOM ready) ---- */
function initComposer() {
  initComposerAutoGrow();
  restoreDashboardModelSel();
  restoreDashboardModeSel();

  var modeSeg = document.getElementById('modeSegCtrl');
  if (modeSeg) {
    modeSeg.addEventListener('click', function(ev) {
      var clicked = ev.target && ev.target.closest ? ev.target.closest('[data-action=\"setMode\"]') : null;
      if (!clicked) return;
      ev.preventDefault();
      setComposerMode(clicked.dataset.mode || 'agent');
    });
  }

  var instrEl = document.getElementById('instr');
  if (instrEl) {
    instrEl.addEventListener('keydown', function(ev) {
      if (ev.key !== 'Enter') return;
      if (ev.shiftKey) return;
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      if (instrEl.value.trim()) submitRun();
    });
  }

  syncComposerUi();
  syncProjectChrome();
}
`;
}

export function getProjectHeroHtml(): string {
  return `
<div class="project-hero" id="projectHero">
  <div class="project-hero-title" id="projectHeroTitle">Default Project</div>
  <div class="project-hero-sub" id="projectHeroSub">What would you like to work on?</div>
</div>`;
}
