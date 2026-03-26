/**
 * Extracted composer component for the dashboard.
 * Exports CSS, HTML, and JS strings for the sticky bottom composer bar.
 *
 * Replaces mode dropdown with segmented control, adds auto-grow textarea,
 * circular send button, and live status text.
 */

export function getComposerStyles(): string {
  return `
.composer-wrap{position:sticky;bottom:0;z-index:var(--z-composer);flex-shrink:0;padding:12px 0 0;background:linear-gradient(180deg,var(--composer-backdrop-start) 0%,var(--composer-backdrop-mid) 24%,var(--composer-backdrop-end) 100%);backdrop-filter:blur(8px)}
.composer-inner{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg) var(--radius-lg) 0 0;padding:12px 14px;box-shadow:var(--shadow-raised);border-top:1px solid var(--border)}
.composer-row{display:flex;align-items:flex-end;gap:10px}
.composer-ta{flex:1;min-height:42px;max-height:min(38dvh,260px);resize:none;overflow-y:auto;background:transparent;color:var(--text);border:1px solid var(--border);border-radius:var(--radius);outline:none;font-family:var(--mono);font-size:var(--text-lg);line-height:1.5;padding:6px 8px;transition:border-color var(--transition),box-shadow var(--transition)}
.composer-ta::placeholder{color:var(--muted)}
.composer-ta:focus{border-color:var(--accent);box-shadow:var(--shadow-ring)}
.composer-send{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;min-width:36px;padding:0;border-radius:50%;background:var(--accent);color:var(--text-inverse);border:none;cursor:pointer;font-size:var(--text-xl);transition:all var(--transition);flex-shrink:0}
.composer-send:hover{transform:scale(1.08);box-shadow:0 2px 8px var(--accent-dim)}
.composer-send:active{transform:scale(.96)}
.composer-send:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.composer-send:disabled{opacity:.3;cursor:not-allowed;transform:none;box-shadow:none}
.composer-send-hidden{opacity:0;pointer-events:none;position:absolute;width:1px;height:1px;overflow:hidden}
.compose-attachments{display:flex;flex-wrap:wrap;gap:4px;padding:4px 0;min-height:0}
.compose-attachments:empty{display:none}
.compose-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:var(--radius);background:var(--bg2);border:1px solid var(--border);font-size:var(--text-sm);color:var(--dim);font-family:var(--mono)}
.compose-chip-x{cursor:pointer;color:var(--muted);font-size:var(--text-md);line-height:1}
.compose-chip-x:hover{color:var(--red)}
.composer-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
.seg-ctrl{display:inline-flex;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.seg-btn{padding:4px 12px;font-size:var(--text-sm);font-family:var(--mono);color:var(--dim);border:none;background:transparent;cursor:pointer;transition:all var(--transition);text-transform:uppercase;letter-spacing:.5px}
.seg-btn:hover{color:var(--accent)}
.seg-btn:focus-visible{outline:none;box-shadow:var(--shadow-ring);border-radius:var(--radius)}
.seg-btn.active{background:var(--accent);color:var(--text-inverse);font-weight:600}
.composer-model-sel{background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:5px 10px;font-size:var(--text-base);font-family:var(--mono);cursor:pointer;transition:all var(--transition)}
.composer-model-sel:focus{border-color:var(--accent);box-shadow:var(--shadow-ring);outline:none}
.composer-status{font-size:var(--text-base);color:var(--dim);margin-left:auto}
.plan-doc-toggle{font-size:var(--text-base);color:var(--accent);cursor:pointer;user-select:none;margin-top:6px;transition:color var(--transition)}
`;
}

export function getComposerHtml(): string {
  return `
<div class="composer-wrap">
  <div class="composer-inner">
    <div id="composerHint" style="display:none;font-size:10px;color:var(--dim);margin-bottom:8px;line-height:1.45"></div>
    <div class="compose-attachments" id="composeAttachments"></div>
    <div class="composer-row">
      <textarea id="instr" class="composer-ta" rows="1" placeholder="Message\u2026" autocomplete="off"></textarea>
      <button type="button" class="composer-send composer-send-hidden" id="subBtn" data-action="submit" aria-label="Send" title="Send (Cmd+Enter)"><span class="composer-btn-icon" aria-hidden="true">&#9654;</span></button>
    </div>
    <div class="plan-doc-toggle" data-action="togglePlanDoc">+ Attach plan document</div>
    <div id="planDocWrap" style="display:none;margin-top:6px">
      <textarea id="planDoc" rows="5" placeholder="Paste requirements, spec, or plan document here. The planner will use it as context to scope the work."></textarea>
    </div>
    <div class="composer-toolbar">
      <div class="seg-ctrl" id="modeSegCtrl">
        <button type="button" class="seg-btn active" data-action="setMode" data-mode="ask">Ask</button>
        <button type="button" class="seg-btn" data-action="setMode" data-mode="plan">Plan</button>
        <button type="button" class="seg-btn" data-action="setMode" data-mode="agent">Agent</button>
        <button type="button" class="seg-btn" data-action="setMode" data-mode="auto">Auto</button>
      </div>
      <select id="uiModeSel" style="display:none" aria-hidden="true" tabindex="-1">
        <option value="ask">Ask</option>
        <option value="plan">Plan</option>
        <option value="agent">Agent</option>
        <option value="">Auto (classify)</option>
      </select>
      <label style="font-size:11px;color:var(--dim);display:flex;align-items:center;gap:6px" title="Optional whole-run model override. When set, this model is used for the run across planning, coding, review, and chat stages.">
        <span>Model</span>
        <select id="modelSel" class="composer-model-sel">
          <option value="">(none)</option>
          <option value="gpt-5.1-codex">GPT-5.1 Codex (OpenAI)</option>
          <option value="gpt-5.3-codex">GPT-5.3 Codex (OpenAI)</option>
          <option value="gpt-5.4-mini">GPT-5.4 Mini (OpenAI)</option>
        </select>
      </label>
      <button type="button" class="btn btn-d" id="stopBtn" data-action="stop" style="display:none">Stop</button>
      <span id="subSt" class="composer-status" aria-live="polite"></span>
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

/* ---- Composer UI sync ---- */
function syncComposerUi() {
  var ta = document.getElementById('instr');
  var hint = document.getElementById('composerHint');
  var r = selectedRunId ? runsMap[selectedRunId] : null;
  if (followupMode()) {
    var kind = r && r.threadKind ? String(r.threadKind) : 'selected';
    if (ta) ta.placeholder = 'Follow up in this ' + kind + ' thread\\u2026';
    if (hint) {
      hint.style.display = 'block';
      hint.textContent = 'Follow-ups append to the selected ' + kind + ' thread.';
    }
  } else {
    if (ta) ta.placeholder = 'Message\\u2026';
    if (hint) hint.style.display = 'none';
  }
  syncComposerPrimaryButton();
  syncStopButton();
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
  btn.className = 'composer-send composer-send-hidden';
  icon.textContent = '\\u25b6';
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
    var uiEl = document.getElementById('uiModeSel');
    if (uiEl && uiEl.value) followupBody.uiMode = uiEl.value;
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
            var nextKind = d.threadKind || (uiEl && uiEl.value) || ex.threadKind || 'ask';
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
            });
            if (typeof syncTimelineFromRun === 'function') syncTimelineFromRun(fuId, runsMap[fuId]);
          }
          ta.value = '';
          ta.style.height = 'auto';
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
          savedAt: new Date().toISOString()
        });
        if (typeof syncTimelineFromRun === 'function') syncTimelineFromRun(d.runId, runsMap[d.runId]);
        renderChatList();
        renderChatThread();
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
      fetch('/api/runs?limit=30')
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

/* ---- Segmented mode control ---- */
function setComposerMode(mode) {
  var ctrl = document.getElementById('modeSegCtrl');
  var sel = document.getElementById('uiModeSel');
  if (!ctrl || !sel) return;
  var btns = ctrl.querySelectorAll('.seg-btn');
  for (var i = 0; i < btns.length; i++) {
    var b = btns[i];
    if (b.dataset.mode === mode) b.classList.add('active');
    else b.classList.remove('active');
  }
  sel.value = mode === 'auto' ? '' : mode;
  persistDashboardModeSel();
}

/* ---- Persistence ---- */
function persistDashboardModeSel() {
  persistDashboardSelect('uiModeSel', DASH_MODE_KEY);
}

function restoreDashboardModeSel() {
  restoreDashboardSelect('uiModeSel', DASH_MODE_KEY);
  syncSegCtrlFromSelect();
}

function persistDashboardModelSel() {
  persistDashboardSelect('modelSel', DASH_MODEL_KEY);
}

function restoreDashboardModelSel() {
  restoreDashboardSelect('modelSel', DASH_MODEL_KEY);
}

function syncSegCtrlFromSelect() {
  var sel = document.getElementById('uiModeSel');
  var ctrl = document.getElementById('modeSegCtrl');
  if (!sel || !ctrl) return;
  var val = sel.value || 'auto';
  var btns = ctrl.querySelectorAll('.seg-btn');
  for (var i = 0; i < btns.length; i++) {
    var b = btns[i];
    if (b.dataset.mode === val) b.classList.add('active');
    else b.classList.remove('active');
  }
}

/* ---- Composer init (call after DOM ready) ---- */
function initComposer() {
  initComposerAutoGrow();
  restoreDashboardModeSel();
  restoreDashboardModelSel();

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
}
`;
}
