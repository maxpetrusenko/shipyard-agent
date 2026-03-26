// Detail panel — slide-in right panel with Diff/Files/Tools/Debug tabs.

export function getDetailPanelStyles(): string {
  return `
/* Panel container */
.detail-panel{border-left:1px solid var(--border);background:var(--bg2);padding:12px 0;overflow:hidden;display:flex;flex-direction:column;height:100%;width:0;min-width:0;opacity:0;transition:width .15s ease,min-width .15s ease,opacity .15s ease}
.detail-panel.open{width:340px;min-width:340px;opacity:1}

/* Header */
.detail-hd{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;flex-shrink:0}
.detail-hd-title{font-size:var(--text-md);font-weight:600;color:var(--text)}
.detail-close{width:24px;height:24px;border-radius:var(--radius);display:flex;align-items:center;justify-content:center;background:none;border:none;color:var(--dim);cursor:pointer;font-size:16px;line-height:1;padding:0;transition:all var(--transition)}
.detail-close:hover{background:var(--card);color:var(--accent)}

/* Tab bar */
.detail-tabs{display:flex;flex-direction:row;border-bottom:1px solid var(--border);padding:0 12px;flex-shrink:0}
.detail-tab{padding:6px 12px;font-size:var(--text-base);font-family:var(--mono);font-weight:600;border:none;background:transparent;color:var(--dim);cursor:pointer;border-bottom:2px solid transparent;transition:all var(--transition)}
.detail-tab:hover{color:var(--text)}
.detail-tab.active{color:var(--accent);border-bottom-color:var(--accent)}

/* Tab content area */
.detail-content{flex:1;overflow-y:auto;padding:12px 16px}
.detail-pane{display:none}
.detail-pane.active{display:block}

/* Diff tab */
.diff-file{margin-bottom:12px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.diff-file-name{padding:6px 12px;background:var(--card);border-bottom:1px solid var(--border);font-size:var(--text-base);font-weight:600;font-family:var(--mono)}
.diff-content{padding:8px 12px;font-size:var(--text-base);line-height:1.5;font-family:var(--mono);white-space:pre-wrap;word-break:break-word;background:var(--bg)}
.diff-add{color:var(--green);background:var(--green-dim)}
.diff-del{color:var(--red);background:var(--red-dim)}
.diff-hdr{color:var(--accent);font-weight:600;font-size:var(--text-base);padding:4px 0}
.diff-ctx{color:var(--dim)}

/* Files tab */
.file-item{display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--border);font-size:var(--text-base);font-family:var(--mono);cursor:pointer;transition:background var(--transition)}
.file-item:hover{background:var(--card)}
.file-item:last-child{border-bottom:none}
.file-icon{width:14px;height:14px;flex-shrink:0;color:var(--accent)}
.file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-status{font-size:var(--text-xs);font-weight:700;text-transform:uppercase;padding:1px 6px;border-radius:4px}
.file-status-add{background:var(--green-dim);color:var(--green)}
.file-status-mod{background:var(--yellow-dim);color:var(--yellow)}
.file-status-del{background:var(--red-dim);color:var(--red)}

/* Tools tab */
.tool-item{padding:8px 12px;border-bottom:1px solid var(--border);font-size:var(--text-base)}
.tool-item:last-child{border-bottom:none}
.tool-name{font-weight:700;color:var(--accent);font-family:var(--mono)}
.tool-status{display:inline-block;font-size:var(--text-xs);font-weight:700;margin-left:8px}
.tool-ok{color:var(--green)}
.tool-fail{color:var(--red)}
.tool-args{color:var(--dim);font-family:var(--mono);margin-top:2px;font-size:var(--text-sm);white-space:pre-wrap;max-height:80px;overflow:auto}
.tool-dur{color:var(--muted);font-size:var(--text-sm);float:right}

/* Debug tab */
.detail-debug-grid{display:grid;grid-template-columns:100px 1fr;gap:4px 8px;font-size:var(--text-base)}
.detail-debug-label{color:var(--muted);text-transform:uppercase;font-size:var(--text-xs);letter-spacing:.06em}
.detail-debug-value{color:var(--text);word-break:break-all;font-family:var(--mono)}

/* Empty state */
.detail-empty{color:var(--muted);font-size:var(--text-base);text-align:center;padding:24px 0}
`;
}

export function getDetailPanelHtml(): string {
  return `
<div class="detail-panel" id="detailPanel">
  <div class="detail-hd">
    <span class="detail-hd-title" id="detailTitle">Details</span>
    <button type="button" class="detail-close" data-action="closeDetail">&times;</button>
  </div>
  <div class="detail-tabs">
    <button type="button" class="detail-tab active" data-action="detailTab" data-tab="diff">Diff</button>
    <button type="button" class="detail-tab" data-action="detailTab" data-tab="files">Files</button>
    <button type="button" class="detail-tab" data-action="detailTab" data-tab="tools">Tools</button>
    <button type="button" class="detail-tab" data-action="detailTab" data-tab="debug">Debug</button>
  </div>
  <div class="detail-content">
    <div class="detail-pane active" id="detailDiff"><div class="detail-empty">Select a file edit to view diff</div></div>
    <div class="detail-pane" id="detailFiles"><div class="detail-empty">No files touched yet</div></div>
    <div class="detail-pane" id="detailTools"><div class="detail-empty">No tool calls yet</div></div>
    <div class="detail-pane" id="detailDebug"><div class="detail-empty">Select a run to view debug info</div></div>
  </div>
</div>`;
}

export function getDetailPanelScript(): string {
  return `
var detailPanelTab = 'diff';
var detailPanelState = null;

function openDetailPanel(tab, data) {
  var panel = document.getElementById('detailPanel');
  if (panel) panel.classList.add('open');
  var layout = document.querySelector('.chat-layout');
  if (layout) layout.style.gridTemplateColumns = '260px 1fr 340px';
  if (tab) switchDetailTab(tab);
  if (data) { detailPanelState = data; }
  renderDetailContent();
  try { localStorage.setItem('shipyard_detail_open', '1'); } catch(e){}
}

function closeDetailPanel() {
  var panel = document.getElementById('detailPanel');
  if (panel) panel.classList.remove('open');
  var layout = document.querySelector('.chat-layout');
  if (layout) layout.style.gridTemplateColumns = '260px 1fr 0';
  try { localStorage.setItem('shipyard_detail_open', '0'); } catch(e){}
}

function switchDetailTab(tab) {
  detailPanelTab = tab;
  var tabs = document.querySelectorAll('.detail-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].dataset.tab === tab);
  var map = { diff:'detailDiff', files:'detailFiles', tools:'detailTools', debug:'detailDebug' };
  var panes = document.querySelectorAll('.detail-pane');
  for (var j = 0; j < panes.length; j++) panes[j].classList.toggle('active', panes[j].id === map[tab]);
}

function openDetailDiff(filePath, oldStr, newStr, tier) {
  openDetailPanel('diff', { type:'diff', filePath:filePath, oldStr:oldStr, newStr:newStr, tier:tier });
}

function renderDetailContent() {
  renderDetailDiff();
  renderDetailFiles();
  renderDetailTools();
  renderDetailDebug();
}

function renderDetailDiff() {
  var el = document.getElementById('detailDiff');
  if (!el) return;
  if (detailPanelState && detailPanelState.type === 'diff') {
    var d = detailPanelState;
    var html = '<div class="diff-file"><div class="diff-file-name">' + esc(shortP(d.filePath)) + '</div><div class="diff-content">';
    if (d.oldStr) html += '<span class="diff-del">- ' + esc(d.oldStr).replace(/\\n/g, '\\n- ') + '</span>\\n';
    if (d.newStr) html += '<span class="diff-add">+ ' + esc(d.newStr).replace(/\\n/g, '\\n+ ') + '</span>';
    html += '</div></div>';
    if (d.tier) html += '<div class="diff-hdr">Edit tier: ' + esc(d.tier) + '</div>';
    el.innerHTML = html;
    return;
  }
  var r = selectedRunId ? runsMap[selectedRunId] : null;
  if (!r || !r.fileEdits || !r.fileEdits.length) { el.innerHTML = renderEmptyState('No file edits in this run'); return; }
  var h = '';
  for (var i = 0; i < r.fileEdits.length; i++) {
    var fe = r.fileEdits[i];
    var fp = fe.filePath || fe.file_path || '';
    h += '<div class="diff-file"><div class="diff-file-name">' + esc(shortP(fp)) + '</div><div class="diff-content">';
    if (fe.oldStr) h += '<span class="diff-del">- ' + esc(fe.oldStr).replace(/\\n/g, '\\n- ') + '</span>\\n';
    if (fe.newStr) h += '<span class="diff-add">+ ' + esc(fe.newStr).replace(/\\n/g, '\\n+ ') + '</span>';
    if (!fe.oldStr && !fe.newStr) h += '<span class="diff-ctx">(full rewrite)</span>';
    h += '</div></div>';
  }
  el.innerHTML = h;
}

function renderDetailFiles() {
  var el = document.getElementById('detailFiles');
  if (!el) return;
  var r = selectedRunId ? runsMap[selectedRunId] : null;
  if (!r || !r.fileEdits || !r.fileEdits.length) { el.innerHTML = renderEmptyState('No files touched'); return; }
  var seen = {};
  var h = '';
  for (var i = 0; i < r.fileEdits.length; i++) {
    var fp = r.fileEdits[i].filePath || r.fileEdits[i].file_path || '';
    if (seen[fp]) continue;
    seen[fp] = true;
    var tier = r.fileEdits[i].tier || r.fileEdits[i].editTier || '';
    var statusCls = 'file-status-mod';
    var statusTxt = 'mod';
    if (tier === 'create' || tier === 'full_rewrite') { statusCls = 'file-status-add'; statusTxt = 'new'; }
    if (tier === 'delete') { statusCls = 'file-status-del'; statusTxt = 'del'; }
    h += '<div class="file-item">' +
      '<svg class="file-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z"/><path d="M9.5 1v4H13"/></svg>' +
      '<span class="file-name">' + esc(shortP(fp)) + '</span>' +
      '<span class="file-status ' + statusCls + '">' + statusTxt + '</span>' +
      '</div>';
  }
  el.innerHTML = h || renderEmptyState('No files touched');
}

function renderDetailTools() {
  var el = document.getElementById('detailTools');
  if (!el) return;
  var r = selectedRunId ? runsMap[selectedRunId] : null;
  if (!r || !r.toolCallHistory || !r.toolCallHistory.length) { el.innerHTML = renderEmptyState('No tool calls'); return; }
  var h = '';
  for (var i = 0; i < r.toolCallHistory.length; i++) {
    var tc = r.toolCallHistory[i];
    var ok = !(tc.tool_result || '').startsWith('Error');
    var fp = tc.tool_input && tc.tool_input.file_path ? esc(shortP(String(tc.tool_input.file_path))) : '';
    var args = fp || esc(JSON.stringify(tc.tool_input || {}).slice(0, 120));
    h += '<div class="tool-item">' +
      '<span class="tool-dur">' + (tc.duration_ms || 0) + 'ms</span>' +
      '<span class="tool-name">' + esc(tc.tool_name) + '</span>' +
      '<span class="tool-status ' + (ok ? 'tool-ok' : 'tool-fail') + '">' + (ok ? 'ok' : 'fail') + '</span>' +
      '<div class="tool-args">' + args + '</div>' +
      '</div>';
  }
  el.innerHTML = h;
}

function renderDetailDebug() {
  var el = document.getElementById('detailDebug');
  if (!el) return;
  var r = selectedRunId ? runsMap[selectedRunId] : null;
  if (!r) { el.innerHTML = renderEmptyState('No run selected'); return; }
  var g = '<div class="detail-debug-grid">';
  g += '<span class="detail-debug-label">Run ID</span><span class="detail-debug-value">' + esc(r.runId || '') + '</span>';
  g += '<span class="detail-debug-label">Phase</span><span class="detail-debug-value">' + esc(r.phase || '') + '</span>';
  g += '<span class="detail-debug-label">Selected UI mode</span><span class="detail-debug-value">' + esc(r.requestedUiMode || '') + '</span>';
  g += '<span class="detail-debug-label">Submitted run mode</span><span class="detail-debug-value">' + esc(r.runMode || '') + '</span>';
  g += '<span class="detail-debug-label">Resolved thread kind</span><span class="detail-debug-value">' + esc(r.threadKind || '') + '</span>';
  g += '<span class="detail-debug-label">Execution path</span><span class="detail-debug-value">' + esc(r.executionPath || '') + '</span>';
  if (r.durationMs) g += '<span class="detail-debug-label">Duration</span><span class="detail-debug-value">' + fmtDur(r.durationMs) + '</span>';
  if (r.tokenUsage) {
    var tu = r.tokenUsage;
    g += '<span class="detail-debug-label">Tokens</span><span class="detail-debug-value">' + (tu.inputTokens || tu.input_tokens || 0) + ' in / ' + (tu.outputTokens || tu.output_tokens || 0) + ' out</span>';
  }
  if (r.traceUrl) g += '<span class="detail-debug-label">Trace</span><span class="detail-debug-value"><a href="' + esc(r.traceUrl) + '" target="_blank" rel="noopener">Open trace</a></span>';
  if (r.error) g += '<span class="detail-debug-label">Error</span><span class="detail-debug-value" style="color:var(--red)">' + esc(String(r.error).slice(0, 200)) + '</span>';
  g += '</div>';
  el.innerHTML = g;
}
`;
}
