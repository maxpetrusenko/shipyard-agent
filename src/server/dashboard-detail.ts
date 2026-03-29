// Detail panel — slide-in right panel with Diff/Files/Tools tabs.

export function getDetailPanelStyles(): string {
  return `
/* Panel container */
.detail-panel{border-left:1px solid var(--border);background:var(--bg2);padding:12px 0;overflow:hidden;display:flex;flex-direction:column;height:100%;width:100%;min-width:0;opacity:0;pointer-events:none;transition:opacity .15s ease,transform .18s ease}
.detail-panel.open{opacity:1;pointer-events:auto}

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

/* Empty state */
.detail-empty{color:var(--muted);font-size:var(--text-base);text-align:center;padding:24px 0}
@media(max-width:860px){.detail-panel{position:fixed;top:0;right:0;bottom:0;width:min(92vw,420px);max-width:420px;z-index:calc(var(--z-overlay) + 3);transform:translateX(104%);box-shadow:var(--shadow-lg);padding-top:16px}.detail-panel.open{opacity:1}body.detail-open .detail-panel.open{transform:translateX(0)}}

/* ---- Detail panel open overrides grid ---- */
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
  </div>
  <div class="detail-content">
    <div class="detail-pane active" id="detailDiff"><div class="detail-empty">Select a file edit to view diff</div></div>
    <div class="detail-pane" id="detailFiles"><div class="detail-empty">No files touched yet</div></div>
    <div class="detail-pane" id="detailTools"><div class="detail-empty">No tool calls yet</div></div>
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
  document.body.classList.add('detail-open');
  if (typeof isCompactShell === 'function' && isCompactShell()) {
    document.body.classList.remove('sidebar-open');
    document.body.classList.remove('rail-open');
  }
  if (tab) switchDetailTab(tab);
  if (data) { detailPanelState = data; }
  renderDetailContent();
  if (typeof syncResponsiveShell === 'function') syncResponsiveShell();
  try { localStorage.setItem('shipyard_detail_open', '1'); } catch(e){}
}

function closeDetailPanel() {
  var panel = document.getElementById('detailPanel');
  if (panel) panel.classList.remove('open');
  document.body.classList.remove('detail-open');
  if (typeof syncResponsiveShell === 'function') syncResponsiveShell();
  try { localStorage.setItem('shipyard_detail_open', '0'); } catch(e){}
}

function switchDetailTab(tab) {
  detailPanelTab = tab;
  var tabs = document.querySelectorAll('.detail-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].dataset.tab === tab);
  var map = { diff:'detailDiff', files:'detailFiles', tools:'detailTools' };
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

`;
}

// ---- Right Rail (third column) ----

export function getRightRailStyles(): string {
  return `
/* Right rail section styling — Claude-like collapsible sections */
.rr-section{margin-bottom:4px}
.rr-section-hd{display:flex;align-items:center;justify-content:space-between;gap:6px;font-family:var(--sans);font-size:12px;font-weight:600;color:var(--text);padding:8px 0;cursor:pointer;user-select:none;border:none;background:none;width:100%;text-align:left;transition:color var(--transition)}
.rr-section-hd:hover{color:var(--accent)}
.rr-section-chev{font-size:10px;color:var(--muted);transition:transform .15s ease;flex-shrink:0}
.rr-section.collapsed .rr-section-chev{transform:rotate(-90deg)}
.rr-section-body{font-size:12px;color:var(--dim);line-height:1.55;padding-bottom:12px;border-bottom:1px solid var(--border)}
.rr-section.collapsed .rr-section-body{display:none}
.rr-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px;transition:box-shadow var(--transition),border-color var(--transition)}
.rr-card:hover{box-shadow:0 2px 8px rgba(42,38,31,.06);border-color:var(--border-bright)}
.rr-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:var(--radius-pill);font-size:10px;letter-spacing:.02em;border:1px solid var(--border);color:var(--dim);margin:2px 2px 2px 0;transition:border-color var(--transition),color var(--transition);font-family:var(--sans)}
.rr-badge:hover{border-color:var(--accent-dim);color:var(--text)}
.rr-badge svg{width:11px;height:11px;flex-shrink:0;opacity:.5}
.rr-badge-ok{border-color:var(--success-border-soft);color:var(--green)}
.rr-badge-warn{border-color:var(--warn-border-soft);color:var(--yellow)}
.rr-badge-off{border-color:var(--danger-border-badge);color:var(--red)}
.rr-empty{color:var(--muted);font-size:11px;padding:8px 0}
/* Numbered step list */
.rr-step-list{list-style:none;padding:0;margin:0}
.rr-step-item{display:flex;align-items:flex-start;gap:10px;padding:6px 0;font-size:12px;color:var(--dim);line-height:1.45;font-family:var(--sans)}
.rr-step-num{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px;font-weight:600;border:1.5px solid var(--border);color:var(--muted);background:transparent;transition:all .15s}
.rr-step-item.done .rr-step-num{background:var(--green);border-color:var(--green);color:#fff}
.rr-step-item.active .rr-step-num{background:var(--accent);border-color:var(--accent);color:#fff}
.rr-step-item.done .rr-step-num::after{content:'\\2713'}
.rr-step-item.active .rr-step-num::after{content:''}
.rr-step-text{flex:1;min-width:0;padding-top:1px}
.rr-step-item.done{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--border)}
.rr-step-item.active{color:var(--text);font-weight:500}
.rr-elapsed{font-size:10px;color:var(--muted);margin-top:6px}
/* File list */
.rr-file-list{list-style:none;padding:0;margin:0;font-size:11px;font-family:var(--mono);color:var(--dim)}
.rr-file-list li{padding:4px 4px;display:flex;align-items:center;gap:8px;border-radius:var(--radius-sm);transition:background var(--transition)}
.rr-file-list li:hover{background:var(--sidebar-hover)}
.rr-file-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.rr-scheduled-empty{border:1px dashed var(--border);border-radius:var(--radius);padding:12px;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:11px}
.rr-scheduled-empty svg{width:14px;height:14px;flex-shrink:0;opacity:.5}
.rr-instr-area{width:100%;min-height:60px;max-height:120px;resize:vertical;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;font-family:var(--sans);font-size:12px;color:var(--text);line-height:1.5;outline:none;transition:border-color var(--transition)}
.rr-instr-area:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-glow)}
.rr-instr-meta{display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:10px;color:var(--muted)}
.rr-instr-saved{color:var(--green);opacity:0;transition:opacity .3s ease}
.rr-instr-saved.show{opacity:1}
.rr-show-all{font-size:10px;color:var(--accent);cursor:pointer;border:none;background:none;font-family:var(--sans);padding:4px 0;transition:color var(--transition)}
.rr-show-all:hover{color:var(--text)}
.rr-token-row{display:flex;justify-content:space-between;font-size:10px;color:var(--muted);padding:2px 0;font-family:var(--sans)}
.rr-shell{display:flex;flex-direction:column;min-height:100%;transition:opacity .18s ease,transform .18s ease}
.rr-rail-toggle{display:none}
.rr-mobile-hd{display:none;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border);font-family:var(--sans);font-size:12px;font-weight:600;color:var(--text)}
.rr-mobile-close{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--dim);cursor:pointer;transition:all var(--transition);padding:0}
.rr-mobile-close:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-glow)}
@media(min-width:861px){.chat-right{position:relative}.rr-rail-toggle{display:inline-flex;position:absolute;top:16px;left:10px;z-index:3;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--dim);cursor:pointer;transition:all var(--transition);padding:0;box-shadow:var(--shadow)}.rr-rail-toggle:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-glow)}body.right-rail-collapsed .chat-right{background:transparent;border-left-color:transparent;padding:0}body.right-rail-collapsed .rr-shell{opacity:0;pointer-events:none;transform:translateX(12px)}body.right-rail-collapsed .rr-rail-toggle{left:10px;top:18px;width:28px;height:112px;flex-direction:column;gap:8px;padding:10px 0;border-color:var(--border-bright)}body.right-rail-collapsed .rr-rail-toggle .rail-toggle-label{display:block;writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;font-family:var(--mono);font-weight:700;letter-spacing:.08em;text-transform:uppercase}}
@media(max-width:860px){.chat-right{position:fixed;top:0;right:0;bottom:0;width:min(92vw,380px);max-width:380px;display:block!important;z-index:calc(var(--z-overlay) + 2);transform:translateX(104%);transition:transform .18s ease,box-shadow .18s ease;box-shadow:var(--shadow-lg);padding:16px 14px 20px}body.rail-open .chat-right{transform:translateX(0)}.rr-mobile-hd{display:flex}}
`;
}

export function getRightRailHtml(): string {
  return `
<div class="chat-right" id="rightRail">
  <button type="button" class="rr-rail-toggle" id="rightRailToggle" data-action="toggleRightRailCollapse" aria-label="Collapse panels" aria-expanded="true">
    <span class="rail-toggle-icon" id="rightRailToggleIcon">&#8250;</span>
    <span class="rail-toggle-label" id="rightRailToggleLabel">Panels</span>
  </button>
  <div class="rr-shell" id="rightRailShell">
  <div class="rr-mobile-hd">
    <span>Panels</span>
    <button type="button" class="rr-mobile-close" data-action="closeResponsivePanels" aria-label="Close panels">&times;</button>
  </div>
  <!-- Home state sections -->
  <div class="right-home-sections" id="rightHomeContent">
    <div class="rr-section" id="rrInstrSection">
      <button type="button" class="rr-section-hd" data-action="rrToggleSection" data-section="rrInstrSection">Instructions <span class="rr-section-chev">&#9660;</span></button>
      <div class="rr-section-body">
        <textarea class="rr-instr-area" id="rrInstrArea" placeholder="Add project instructions..." spellcheck="false"></textarea>
        <div class="rr-instr-meta">
          <span id="rrInstrCount">0 chars</span>
          <span class="rr-instr-saved" id="rrInstrSaved">Saved</span>
        </div>
      </div>
    </div>
    <div class="rr-section" id="rrScheduledSection">
      <button type="button" class="rr-section-hd" data-action="rrToggleSection" data-section="rrScheduledSection">Scheduled <span class="rr-section-chev">&#9660;</span></button>
      <div class="rr-section-body">
        <div class="rr-scheduled-empty">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/></svg>
          <span>Set up recurring tasks for this project.</span>
        </div>
      </div>
    </div>
    <div class="rr-section" id="rrHomeContextSection">
      <button type="button" class="rr-section-hd" data-action="rrToggleSection" data-section="rrHomeContextSection">Context <span class="rr-section-chev">&#9660;</span></button>
      <div class="rr-section-body" id="rrHomeContext">
        <div class="rr-card">
          <div style="display:flex;flex-wrap:wrap;gap:4px" id="rrHomeContextBadges">
            <span class="rr-badge" id="rrHomeProjectBadge">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4.5V12a1.5 1.5 0 001.5 1.5h9A1.5 1.5 0 0014 12V6.5A1.5 1.5 0 0012.5 5H8L6.5 3H3.5A1.5 1.5 0 002 4.5z"/></svg>
              Project
            </span>
            <span class="rr-badge" id="rrHomeDirBadge">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v6M5 8h6"/></svg>
              workdir
            </span>
            <span class="rr-badge" id="rrHomeRepoBadge">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3v10"/><path d="M10 3v4"/><circle cx="6" cy="13" r="1.5" fill="currentColor"/><circle cx="10" cy="7" r="1.5" fill="currentColor"/><path d="M10 8.5c0 2-1.5 3-4 4.5"/></svg>
              Repo
            </span>
            <span class="rr-badge" id="rrHomeMemoryBadge">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M6 5h4M6 8h4M6 11h2"/></svg>
              Memory
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Task state sections -->
  <div class="right-task-sections" id="rightTaskContent">
    <div class="rr-section" id="rrProgressSection">
      <button type="button" class="rr-section-hd" data-action="rrToggleSection" data-section="rrProgressSection">Progress <span class="rr-section-chev">&#9660;</span></button>
      <div class="rr-section-body" id="rrProgress">
        <ol class="rr-step-list" id="rrStepList">
          <li class="rr-step-item"><span class="rr-step-num"></span><span class="rr-step-text rr-empty">No steps planned yet</span></li>
        </ol>
        <div class="rr-elapsed" id="rrElapsed"></div>
      </div>
    </div>
    <div class="rr-section" id="rrFilesSection">
      <button type="button" class="rr-section-hd" data-action="rrToggleSection" data-section="rrFilesSection">Working folder <span class="rr-section-chev">&#9660;</span></button>
      <div class="rr-section-body">
        <ul class="rr-file-list" id="rrFileList">
          <li><span class="rr-empty">No files touched yet</span></li>
        </ul>
        <button type="button" class="rr-show-all" id="rrShowAllFiles" style="display:none" data-action="rrToggleAllFiles">Show all</button>
      </div>
    </div>
    <div class="rr-section" id="rrContextSection">
      <button type="button" class="rr-section-hd" data-action="rrToggleSection" data-section="rrContextSection">Context <span class="rr-section-chev">&#9660;</span></button>
      <div class="rr-section-body" id="rrTaskContext">
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          <span class="rr-badge" id="rrTaskModel">Model: auto</span>
          <span class="rr-badge" id="rrTaskThread">Thread: --</span>
          <span class="rr-badge" id="rrTaskProject">Project</span>
        </div>
        <div id="rrTaskTokens" style="margin-top:8px"></div>
      </div>
    </div>
  </div>
  </div>
</div>`;
}

export function getRightRailScript(): string {
  return `
var phaseColorMap = {
  planning: 'var(--accent)',
  executing: 'var(--yellow)',
  verifying: 'var(--cyan)',
  reviewing: 'var(--cyan)',
  routing: 'var(--cyan)',
  done: 'var(--green)',
  error: 'var(--red)',
  idle: 'var(--dim)',
  awaiting_confirmation: 'var(--purple)',
  paused: 'var(--pink)'
};
var rrShowAllFiles = false;
var rrInstrSaveTimer = null;

/* ---- Instructions persistence ---- */
function rrInstrKey() {
  var proj = typeof getSelectedProject === 'function' ? getSelectedProject() : null;
  var id = (proj && proj.id) ? proj.id : 'default';
  return 'shipyard_rr_instr_' + id;
}

function rrInitInstructions() {
  var ta = document.getElementById('rrInstrArea');
  if (!ta) return;
  try {
    var saved = localStorage.getItem(rrInstrKey());
    if (saved) ta.value = saved;
  } catch(e) {}
  rrUpdateInstrCount();
  ta.addEventListener('input', function() {
    rrUpdateInstrCount();
    if (rrInstrSaveTimer) clearTimeout(rrInstrSaveTimer);
    rrInstrSaveTimer = setTimeout(rrSaveInstructions, 600);
  });
  ta.addEventListener('focus', function() {
    ta.style.borderColor = 'var(--accent)';
  });
  ta.addEventListener('blur', function() {
    ta.style.borderColor = '';
  });
}

function rrUpdateInstrCount() {
  var ta = document.getElementById('rrInstrArea');
  var ct = document.getElementById('rrInstrCount');
  if (ta && ct) ct.textContent = ta.value.length + ' chars';
}

function rrSaveInstructions() {
  var ta = document.getElementById('rrInstrArea');
  if (!ta) return;
  try { localStorage.setItem(rrInstrKey(), ta.value); } catch(e) {}
  var badge = document.getElementById('rrInstrSaved');
  if (badge) {
    badge.classList.add('show');
    setTimeout(function() { badge.classList.remove('show'); }, 1500);
  }
}

/* ---- Home context ---- */
function rrUpdateHomeContext() {
  var dirBadge = document.getElementById('rrHomeDirBadge');
  if (dirBadge && WORK_DIR) {
    var short = WORK_DIR.length > 28 ? '...' + WORK_DIR.slice(-25) : WORK_DIR;
    dirBadge.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v6M5 8h6"/></svg>' + esc(short);
  }
  var projBadge = document.getElementById('rrHomeProjectBadge');
  if (projBadge) {
    var proj = typeof getSelectedProject === 'function' ? getSelectedProject() : null;
    var projLabel = (proj && proj.label) ? proj.label : 'Default';
    projBadge.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4.5V12a1.5 1.5 0 001.5 1.5h9A1.5 1.5 0 0014 12V6.5A1.5 1.5 0 0012.5 5H8L6.5 3H3.5A1.5 1.5 0 002 4.5z"/></svg>' + esc(projLabel);
  }
  var repoBadge = document.getElementById('rrHomeRepoBadge');
  if (repoBadge) {
    var connected = settingsStatus && settingsStatus.githubConnected;
    var repoLabel = connected ? (settingsStatus.repoBranch || 'connected') : 'Not connected';
    repoBadge.className = 'rr-badge ' + (connected ? 'rr-badge-ok' : 'rr-badge-off');
    repoBadge.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3v10"/><path d="M10 3v4"/><circle cx="6" cy="13" r="1.5" fill="currentColor"/><circle cx="10" cy="7" r="1.5" fill="currentColor"/><path d="M10 8.5c0 2-1.5 3-4 4.5"/></svg>' + esc(repoLabel);
  }
  var memBadge = document.getElementById('rrHomeMemoryBadge');
  if (memBadge) {
    var hasInstr = false;
    try { hasInstr = !!(localStorage.getItem(rrInstrKey())); } catch(e) {}
    memBadge.className = 'rr-badge ' + (hasInstr ? 'rr-badge-ok' : '');
    memBadge.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M6 5h4M6 8h4M6 11h2"/></svg>' + (hasInstr ? 'Memory: active' : 'Memory: none');
  }
}

/* ---- Section collapse ---- */
function rrToggleSection(sectionId) {
  var sec = document.getElementById(sectionId);
  if (sec) sec.classList.toggle('collapsed');
}

/* ---- Progress — numbered step list ---- */
function updateRightRail() {
  var r = selectedRunId ? runsMap[selectedRunId] : null;
  var stepListEl = document.getElementById('rrStepList');
  var elapsedEl = document.getElementById('rrElapsed');
  var activePh = ['planning','executing','verifying','reviewing','routing','awaiting_confirmation'];
  if (r && r.phase) {
    var steps = r.steps || [];
    if (steps.length > 0 && stepListEl) {
      var done = 0;
      var h = '';
      for (var i = 0; i < steps.length; i++) {
        var s = steps[i];
        var isDone = s.status === 'done' || s.status === 'completed';
        if (isDone) done++;
        var isCurrent = !isDone && done === i;
        var cls = isDone ? 'done' : (isCurrent ? 'active' : '');
        var label = s.description || s.title || ('Step ' + (i + 1));
        if (label.length > 50) label = label.slice(0, 47) + '...';
        h += '<li class="rr-step-item ' + cls + '"><span class="rr-step-num">' + (isDone ? '' : (i + 1)) + '</span><span class="rr-step-text">' + esc(label) + '</span></li>';
      }
      stepListEl.innerHTML = h;
    } else if (stepListEl) {
      var phaseLabel = r.phase;
      var color = phaseColorMap[r.phase] || 'var(--dim)';
      stepListEl.innerHTML = '<li class="rr-step-item active"><span class="rr-step-num" style="border-color:' + color + ';background:' + color + ';color:#fff"></span><span class="rr-step-text">' + esc(phaseLabel) + '</span></li>';
    }
    if (elapsedEl && r.durationMs) {
      elapsedEl.textContent = fmtDur(r.durationMs) + ' elapsed';
    } else if (elapsedEl && lastState.runId === r.runId && activePh.indexOf(r.phase) >= 0) {
      elapsedEl.textContent = 'Running...';
    } else if (elapsedEl) {
      elapsedEl.textContent = '';
    }
  } else {
    if (stepListEl) stepListEl.innerHTML = '<li class="rr-step-item"><span class="rr-step-num"></span><span class="rr-step-text rr-empty">No steps planned yet</span></li>';
    if (elapsedEl) elapsedEl.textContent = '';
  }

  /* ---- File list with limit ---- */
  var fileListEl = document.getElementById('rrFileList');
  var showAllBtn = document.getElementById('rrShowAllFiles');
  if (fileListEl && r && r.fileEdits && r.fileEdits.length > 0) {
    var seen = {};
    var allItems = [];
    for (var fi = 0; fi < r.fileEdits.length; fi++) {
      var fp = r.fileEdits[fi].filePath || r.fileEdits[fi].file_path || '';
      if (seen[fp]) continue;
      seen[fp] = true;
      var dotColor = 'var(--yellow)';
      var tier = r.fileEdits[fi].tier || '';
      var tierLabel = 'mod';
      if (tier === 'create' || tier === 'full_rewrite') { dotColor = 'var(--green)'; tierLabel = 'add'; }
      if (tier === 'delete') { dotColor = 'var(--red)'; tierLabel = 'del'; }
      allItems.push({ fp: fp, dotColor: dotColor, tierLabel: tierLabel });
    }
    var limit = rrShowAllFiles ? allItems.length : 10;
    var html = '';
    for (var li = 0; li < Math.min(allItems.length, limit); li++) {
      var item = allItems[li];
      html += '<li><span class="rr-file-dot" style="background:' + item.dotColor + '"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(shortP(item.fp)) + '</span><span style="font-size:8px;color:var(--muted);flex-shrink:0">' + item.tierLabel + '</span></li>';
    }
    fileListEl.innerHTML = html;
    if (showAllBtn) {
      if (allItems.length > 10) {
        showAllBtn.style.display = 'block';
        showAllBtn.textContent = rrShowAllFiles ? 'Show less' : ('Show all (' + allItems.length + ')');
      } else {
        showAllBtn.style.display = 'none';
      }
    }
  } else if (fileListEl) {
    fileListEl.innerHTML = '<li><span class="rr-empty">No files touched yet</span></li>';
    if (showAllBtn) showAllBtn.style.display = 'none';
  }

  /* ---- Task context badges ---- */
  var modelBadge = document.getElementById('rrTaskModel');
  var threadBadge = document.getElementById('rrTaskThread');
  var projBadge = document.getElementById('rrTaskProject');
  var tokensEl = document.getElementById('rrTaskTokens');
  if (r) {
    if (modelBadge) modelBadge.textContent = 'Model: ' + (r.modelFamily || r.modelOverride || 'auto');
    if (threadBadge) threadBadge.textContent = 'Thread: ' + (r.threadKind || '--');
    if (projBadge) {
      var proj = r.projectContext || (typeof getSelectedProject === 'function' ? getSelectedProject() : null);
      projBadge.textContent = (proj && (proj.projectLabel || proj.label)) ? (proj.projectLabel || proj.label) : 'Project';
    }
    if (tokensEl && r.tokenUsage) {
      var tu = r.tokenUsage;
      var inp = tu.inputTokens || tu.input_tokens || 0;
      var out = tu.outputTokens || tu.output_tokens || 0;
      tokensEl.innerHTML = '<div class="rr-token-row"><span>Input tokens</span><span>' + inp.toLocaleString() + '</span></div>' +
        '<div class="rr-token-row"><span>Output tokens</span><span>' + out.toLocaleString() + '</span></div>';
    } else if (tokensEl) {
      tokensEl.innerHTML = '';
    }
  }

  /* ---- Home context ---- */
  rrUpdateHomeContext();
}
`;
}
