/**
 * Sidebar panel for the chat dashboard.
 * Extracted from dashboard.ts — exports CSS, HTML, and JS as strings.
 *
 * Matches Claude Code desktop UI: clean nav, simple recents list,
 * subtle new-task button, minimal visual noise.
 */

export function getSidebarStyles(): string {
  return `
/* sidebar layout */
.chat-side{position:relative;font-size:var(--text-base);color:var(--dim);min-height:0;min-width:0;overflow-y:auto;display:flex;flex-direction:column;gap:0;background:var(--sidebar-bg);border-right:1px solid var(--border)}
.sidebar-shell{display:flex;flex-direction:column;flex:1;min-height:100%;transition:opacity .18s ease,transform .18s ease}
.sidebar-mobile-hd{display:none;align-items:center;justify-content:space-between;padding:14px 14px 8px;border-bottom:1px solid var(--border);font-family:var(--sans);font-size:12px;font-weight:600;color:var(--text)}
.sidebar-mobile-close{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--dim);cursor:pointer;transition:all var(--transition);padding:0}
.sidebar-mobile-close:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-glow)}
.sidebar-rail-toggle{display:none}
.rail-toggle-icon{display:inline-flex;align-items:center;justify-content:center;font-size:14px;line-height:1}
.rail-toggle-label{display:none}

/* ── top: new task button ── */
.sidebar-new-btn{display:flex;align-items:center;gap:8px;width:100%;padding:8px 14px;border:none;border-radius:var(--radius);background:transparent;color:var(--text);font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer;transition:all var(--transition);margin:4px 0}
.sidebar-new-btn:hover{background:var(--sidebar-hover)}
.sidebar-new-btn:active{background:rgba(0,0,0,.06)}
.sidebar-new-btn:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.sidebar-new-btn svg{width:16px;height:16px;flex-shrink:0;color:var(--accent)}

/* ── nav section ── */
.sidebar-nav{display:flex;flex-direction:column;gap:1px;padding:4px 6px 8px;border-bottom:1px solid var(--border)}
.sidebar-nav-item{display:flex;align-items:center;gap:10px;padding:6px 10px;border:none;background:none;color:var(--dim);font-family:var(--sans);font-size:13px;cursor:pointer;border-radius:var(--radius);transition:all var(--transition);width:100%;text-align:left}
.sidebar-nav-item:hover{color:var(--text);background:var(--sidebar-hover)}
.sidebar-nav-item:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.sidebar-nav-item.active{color:var(--text);background:var(--sidebar-hover);font-weight:500}
.sidebar-nav-item svg{width:16px;height:16px;flex-shrink:0;opacity:.55}
.sidebar-nav-item:hover svg{opacity:.8}
.sidebar-nav-badge{margin-left:auto;font-size:10px;color:var(--muted);font-family:var(--mono);opacity:.6}

/* ── search input (hidden by default, toggled via nav) ── */
.sidebar-search-wrap{padding:4px 8px 2px;display:none}
.sidebar-search-wrap.open{display:block}
.sidebar-search{width:100%;background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:7px 10px 7px 30px;font-size:13px;font-family:var(--sans);outline:none;transition:border-color var(--transition);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='6' cy='6' r='4'/%3E%3Cline x1='9' y1='9' x2='13' y2='13'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:9px center;background-size:13px}
.sidebar-search:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-dim)}
.sidebar-search::placeholder{color:var(--muted)}

/* ── section labels ── */
.sidebar-section{padding:12px 14px 4px}
.sidebar-section-label{font-family:var(--sans);font-size:11px;font-weight:600;color:var(--muted);user-select:none;display:flex;align-items:center;justify-content:space-between}
.sidebar-section-action{background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;line-height:1;padding:0 2px;transition:color .12s}
.sidebar-section-action:hover{color:var(--accent)}

/* ── projects list ── */
.sidebar-projects{display:flex;flex-direction:column;gap:1px;padding:2px 6px 8px;border-bottom:1px solid var(--border)}
.sidebar-project-item{display:flex;align-items:center;gap:8px;padding:6px 10px;border:none;background:none;color:var(--dim);font-family:var(--sans);font-size:13px;cursor:pointer;border-radius:var(--radius);transition:all var(--transition);width:100%;text-align:left}
.sidebar-project-item:hover{color:var(--text);background:var(--sidebar-hover)}
.sidebar-project-item.selected{color:var(--text);font-weight:500}
.sidebar-project-item:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.sidebar-project-dot{width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0;opacity:.5}
.sidebar-project-item.selected .sidebar-project-dot{opacity:1}

/* ── recents (chat list) ── */
.sidebar-recents{flex:1;min-height:0;display:flex;flex-direction:column}
.sidebar-recents-list{flex:1;min-height:0;overflow-y:auto;padding:0 6px 8px}

/* date group headers */
.sidebar-date-hd{font-size:10px;color:var(--muted);padding:10px 10px 4px;font-weight:600;font-family:var(--sans);user-select:none}
.sidebar-date-hd:first-child{padding-top:4px}

/* chat item — clean, minimal, Claude-style */
.chat-item-wrap{display:flex;align-items:center;gap:0;margin-bottom:1px;border-radius:var(--radius);overflow:hidden;transition:background var(--transition)}
.chat-item-wrap:hover{background:var(--sidebar-hover)}
.chat-item-wrap.active{background:rgba(0,0,0,.06)}
.chat-item-wrap:focus-within{box-shadow:var(--shadow-ring)}

/* running pulse */
@keyframes sidebar-pulse{0%,100%{opacity:1}50%{opacity:.5}}
.chat-item-wrap.running{position:relative}
.chat-item-wrap.running::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;height:60%;border-radius:2px;background:var(--accent);animation:sidebar-pulse 2s ease-in-out infinite}

/* item body — simple text */
.chat-item-body{flex:1;min-width:0;text-align:left;padding:7px 10px;line-height:1.4;background:transparent;color:inherit;font-family:inherit;border:none;cursor:pointer;border-radius:0}
.chat-item-title{font-size:13px;color:var(--text);font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-item-wrap.active .chat-item-title{font-weight:500}
.chat-item-sub{font-size:10px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-phase-pill{font-size:10px;font-weight:500}
.pp-done{color:var(--green)}
.pp-error{color:var(--red)}
.pp-planning,.pp-executing{color:var(--accent)}
.pp-verifying,.pp-reviewing,.pp-routing{color:var(--cyan)}

/* ── sidebar footer ── */
.sidebar-footer{margin-top:auto;padding:10px 14px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px}
.sidebar-footer-chip{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.sidebar-footer-avatar{width:24px;height:24px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px;font-weight:700;color:var(--text-inverse);font-family:var(--sans)}
.sidebar-footer-label{font-family:var(--sans);font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sidebar-footer-actions{display:flex;align-items:center;gap:2px;flex-shrink:0}
.sidebar-footer-btn{background:none;border:none;color:var(--muted);cursor:pointer;padding:5px;border-radius:var(--radius);transition:all var(--transition);display:flex;align-items:center;justify-content:center}
.sidebar-footer-btn:hover{color:var(--text);background:var(--sidebar-hover)}
.sidebar-footer-btn:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.sidebar-footer-btn svg{width:16px;height:16px}

/* item actions — hidden by default, visible on hover */
.chat-item-actions{display:flex;align-items:center;gap:2px;padding:0 6px 0 0;flex-shrink:0;opacity:0;pointer-events:none;transition:opacity .12s ease}
.chat-item-wrap:hover .chat-item-actions,.chat-item-wrap.active .chat-item-actions,.chat-item-wrap:focus-within .chat-item-actions{opacity:1;pointer-events:auto}
.chat-act{font-size:0;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-sm);border:none;background:transparent;color:var(--muted);cursor:pointer;transition:all .12s ease;padding:0}
.chat-act:hover{background:var(--sidebar-hover);color:var(--text)}
.chat-act:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.chat-act-del:hover{color:var(--red)}

/* keyboard-selected highlight */
.chat-item-wrap.kb-focus{outline:2px solid var(--accent);outline-offset:-2px}
@media(min-width:861px){.sidebar-rail-toggle{display:inline-flex;position:absolute;top:16px;right:10px;z-index:3;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--dim);cursor:pointer;transition:all var(--transition);padding:0;box-shadow:var(--shadow)}.sidebar-rail-toggle:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-glow)}body.left-rail-collapsed .chat-side{background:transparent;border-right-color:transparent;padding:0}body.left-rail-collapsed .sidebar-shell{opacity:0;pointer-events:none;transform:translateX(-12px)}body.left-rail-collapsed .sidebar-rail-toggle{right:10px;top:18px;width:28px;height:112px;flex-direction:column;gap:8px;padding:10px 0;border-color:var(--border-bright)}body.left-rail-collapsed .sidebar-rail-toggle .rail-toggle-label{display:block;writing-mode:vertical-rl;text-orientation:mixed;font-size:10px;font-family:var(--mono);font-weight:700;letter-spacing:.08em;text-transform:uppercase}}
@media(max-width:860px){.chat-side{position:fixed;left:0;top:0;bottom:0;width:min(86vw,320px);max-width:320px;z-index:calc(var(--z-overlay) + 1);transform:translateX(-104%);transition:transform .18s ease,box-shadow .18s ease;box-shadow:var(--shadow-lg);overflow-y:auto}.sidebar-mobile-hd{display:flex}body.sidebar-open .chat-side{transform:translateX(0)}}
`;
}

export function getSidebarHtml(): string {
  return `
  <aside class="chat-side" id="chatSidebar" aria-label="Chats">
    <div class="sidebar-mobile-hd">
      <span>Tasks</span>
      <button type="button" class="sidebar-mobile-close" data-action="closeResponsivePanels" aria-label="Close tasks">&times;</button>
    </div>
    <button type="button" class="sidebar-rail-toggle" id="sidebarRailToggle" data-action="toggleSidebarCollapse" aria-label="Collapse chats" aria-expanded="true">
      <span class="rail-toggle-icon" id="sidebarRailToggleIcon">&#8249;</span>
      <span class="rail-toggle-label" id="sidebarRailToggleLabel">Chats</span>
    </button>
    <div class="sidebar-shell" id="sidebarShell">
    <!-- top: new task -->
    <button type="button" class="sidebar-new-btn" id="newChatBtn" data-action="newChat">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
      New task
    </button>

    <!-- nav links -->
    <nav class="sidebar-nav">
      <button type="button" class="sidebar-nav-item" id="navSearch" data-action="toggleSearch">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="6.5" r="4"/><line x1="10" y1="10" x2="14.5" y2="14.5"/></svg>
        Search
      </button>
      <button type="button" class="sidebar-nav-item" disabled>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1"/><line x1="2" y1="7" x2="14" y2="7"/><line x1="5" y1="1" x2="5" y2="4"/><line x1="11" y1="1" x2="11" y2="4"/></svg>
        Scheduled
        <span class="sidebar-nav-badge">soon</span>
      </button>
      <button type="button" class="sidebar-nav-item" disabled>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 8h7M8 4.5v7"/></svg>
        Dispatch
        <span class="sidebar-nav-badge">soon</span>
      </button>
      <button type="button" class="sidebar-nav-item" disabled>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2 L9.5 6 L14 6.5 L10.5 9.5 L11.5 14 L8 11.5 L4.5 14 L5.5 9.5 L2 6.5 L6.5 6 Z"/></svg>
        Ideas
        <span class="sidebar-nav-badge">soon</span>
      </button>
      <button type="button" class="sidebar-nav-item" disabled>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4"/></svg>
        Customize
        <span class="sidebar-nav-badge">soon</span>
      </button>
    </nav>

    <!-- search (toggled) -->
    <div class="sidebar-search-wrap" id="sidebarSearchWrap">
      <input type="text" class="sidebar-search" id="sidebarSearch" placeholder="Search tasks..." aria-label="Search tasks" autocomplete="off">
    </div>

    <!-- projects -->
    <div class="sidebar-section">
      <span class="sidebar-section-label">
        Projects
        <button type="button" class="sidebar-section-action" aria-label="Add project" disabled>+</button>
      </span>
    </div>
    <div class="sidebar-projects" id="sidebarProjects"></div>

    <!-- recents -->
    <div class="sidebar-recents">
      <div class="sidebar-section"><span class="sidebar-section-label">Recents</span></div>
      <div id="chatList" class="sidebar-recents-list"></div>
    </div>

    <!-- footer -->
    <div class="sidebar-footer">
      <div class="sidebar-footer-chip">
        <div class="sidebar-footer-avatar">S</div>
        <span class="sidebar-footer-label">Shipyard</span>
      </div>
      <div class="sidebar-footer-actions">
        <button type="button" class="sidebar-footer-btn" data-action="openSettings" aria-label="Settings">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2"/><path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"/></svg>
        </button>
        <button type="button" class="sidebar-footer-btn" data-action="showShortcuts" aria-label="Shortcuts">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="14" height="9" rx="1.5"/><line x1="4" y1="7" x2="4" y2="7.01"/><line x1="8" y1="7" x2="8" y2="7.01"/><line x1="12" y1="7" x2="12" y2="7.01"/><line x1="5" y1="10" x2="11" y2="10"/></svg>
        </button>
      </div>
    </div>
    </div>
  </aside>`;
}

export function getSidebarScript(): string {
  return `
/* ---------- sidebar: relative time ---------- */
function relTime(iso) {
  if (!iso) return '';
  try {
    var now = Date.now();
    var then = new Date(iso).getTime();
    var diff = now - then;
    if (diff < 0) diff = 0;
    var sec = Math.floor(diff / 1000);
    if (sec < 30) return 'just now';
    if (sec < 60) return sec + 's ago';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    var day = Math.floor(hr / 24);
    if (day === 1) return 'yesterday';
    if (day < 7) return day + 'd ago';
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (e) { return ''; }
}

function shortTime(iso) {
  if (!iso) return '';
  try {
    var d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch (e) { return ''; }
}

/* ---------- sidebar: human title ---------- */
function humanTitle(r) {
  if (titleOverrides[r.runId]) return titleOverrides[r.runId];
  var ins = (r.instruction || '').trim();
  if (!ins) return 'Untitled task';
  var line = ins.split('\\n')[0].trim();
  if (line.length > 55) line = line.slice(0, 52) + '\\u2026';
  return line;
}

/* ---------- sidebar: rename / delete ---------- */
function renameChat(runId) {
  var current = humanTitle(runsMap[runId] || { runId: runId });
  var newName = prompt('Rename task:', current);
  if (newName === null) return;
  newName = newName.trim();
  if (!newName) {
    delete titleOverrides[runId];
  } else {
    titleOverrides[runId] = newName;
  }
  try { localStorage.setItem('shipyard_titles', JSON.stringify(titleOverrides)); } catch(e) {}
  renderChatList();
  if (selectedRunId === runId) renderChatThread();
}

function deleteChat(runId) {
  if (!runId) return;
  fetch('/api/runs/' + encodeURIComponent(runId), { method: 'DELETE' })
    .then(function (r) {
      return r.json().then(function (body) {
        return { ok: r.ok, status: r.status, body: body };
      });
    })
    .then(function (x) {
      if (!x.ok) {
        var msg = (x.body && x.body.error) ? x.body.error : 'Delete failed';
        var st = document.getElementById('subSt');
        if (st) st.textContent = msg;
        return;
      }
      var stOk = document.getElementById('subSt');
      if (stOk) stOk.textContent = '';
      delete titleOverrides[runId];
      try { localStorage.setItem('shipyard_titles', JSON.stringify(titleOverrides)); } catch (e) {}
      delete runsMap[runId];
      if (typeof clearRunTimeline === 'function') clearRunTimeline(runId);
      if (selectedRunId === runId) selectedRunId = null;
      ensureSelectedRun();
      renderChatList();
      renderChatThread();
      syncComposerUi();
    })
    .catch(function () {
      var st = document.getElementById('subSt');
      if (st) st.textContent = 'Delete failed';
    });
}

/* ---------- sidebar: select / new ---------- */
function selectChat(runId) {
  if (!runId) return;
  selectedRunId = runId;
  var run = runsMap[runId];
  if (run && run.projectContext && run.projectContext.projectId && typeof setSelectedProject === 'function') {
    setSelectedProject(run.projectContext.projectId, run.projectContext.projectLabel || 'Project');
  }
  saveSelectedRunId();
  renderProjectList();
  if (typeof syncProjectChrome === 'function') syncProjectChrome();
  renderChatList();
  renderChatThread();
  if (typeof syncDashboardState === 'function') syncDashboardState();
  if (typeof updateRightRail === 'function') updateRightRail();
  if (typeof closeResponsivePanels === 'function') closeResponsivePanels();
  void refreshRunDetails(runId);
}

function newChat() {
  selectedRunId = null;
  saveSelectedRunId();
  renderProjectList();
  if (typeof syncProjectChrome === 'function') syncProjectChrome();
  renderChatList();
  renderChatThread();
  syncComposerUi();
  if (typeof syncDashboardState === 'function') syncDashboardState();
  if (typeof closeResponsivePanels === 'function') closeResponsivePanels();
  var searchEl = document.getElementById('sidebarSearch');
  if (searchEl) searchEl.value = '';
}

/* ---------- sidebar: search toggle ---------- */
function toggleSidebarSearch() {
  var wrap = document.getElementById('sidebarSearchWrap');
  var btn = document.getElementById('navSearch');
  if (!wrap) return;
  var isOpen = wrap.classList.contains('open');
  if (isOpen) {
    wrap.classList.remove('open');
    if (btn) btn.classList.remove('active');
    /* clear filter when closing */
    var inp = document.getElementById('sidebarSearch');
    if (inp) { inp.value = ''; sidebarSearch(''); }
  } else {
    wrap.classList.add('open');
    if (btn) btn.classList.add('active');
    var inp2 = document.getElementById('sidebarSearch');
    if (inp2) inp2.focus();
  }
}

/* ---------- sidebar: search filter ---------- */
var _sidebarQuery = '';

function sidebarSearch(query) {
  _sidebarQuery = (query || '').toLowerCase().trim();
  renderChatList();
}

/* ---------- sidebar: date group helper ---------- */
function dateGroup(iso) {
  if (!iso) return 'Earlier';
  try {
    var now = new Date();
    var d = new Date(iso);
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var t = d.getTime();
    if (t >= todayStart) return 'Today';
    if (t >= todayStart - 86400000) return 'Yesterday';
    if (t >= todayStart - 604800000) return 'This week';
    return 'Earlier';
  } catch (e) { return 'Earlier'; }
}

function projectCatalog() {
  var selected = typeof getSelectedProject === 'function' ? getSelectedProject() : { id: 'default', label: 'Default Project' };
  var seen = {};
  var list = [];
  function push(id, label, lastUsed) {
    if (!id || seen[id]) return;
    seen[id] = true;
    list.push({ id: id, label: label || 'Untitled Project', lastUsed: lastUsed || '' });
  }
  push(selected && selected.id, selected && selected.label, '');
  var all = typeof sortedRuns === 'function' ? sortedRuns() : [];
  for (var i = 0; i < all.length; i++) {
    var ctx = all[i] && all[i].projectContext;
    if (ctx && ctx.projectId) push(ctx.projectId, ctx.projectLabel, all[i].savedAt || '');
  }
  if (!list.length) push('default', 'Default Project', '');
  list.sort(function(a, b) {
    if (selected && a.id === selected.id) return -1;
    if (selected && b.id === selected.id) return 1;
    return String(b.lastUsed || '').localeCompare(String(a.lastUsed || ''));
  });
  return list;
}

function renderProjectList() {
  var el = document.getElementById('sidebarProjects');
  if (!el) return;
  var selected = typeof getSelectedProject === 'function' ? getSelectedProject() : null;
  var list = projectCatalog();
  var html = '';
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var cls = 'sidebar-project-item' + (selected && item.id === selected.id ? ' selected' : '');
    html += '<button type="button" class="' + cls + '" data-action="selectProject" data-project-id="' + esc(item.id) + '" data-project-label="' + esc(item.label) + '">' +
      '<span class="sidebar-project-dot"></span>' +
      '<span>' + esc(item.label) + '</span>' +
      '</button>';
  }
  el.innerHTML = html;
}

function selectProjectById(projectId, projectLabel) {
  if (!projectId || typeof setSelectedProject !== 'function') return;
  setSelectedProject(projectId, projectLabel || 'Project');
  renderProjectList();
  if (typeof syncProjectChrome === 'function') syncProjectChrome();
  if (typeof updateRightRail === 'function') updateRightRail();
}

/* ---------- sidebar: render chat list ---------- */
function renderChatList() {
  var el = document.getElementById('chatList');
  if (!el) return;
  var all = sortedRuns();
  var q = _sidebarQuery;
  if (q) {
    all = all.filter(function (r) {
      var title = humanTitle(r).toLowerCase();
      var ins = (r.instruction || '').toLowerCase();
      return title.indexOf(q) >= 0 || ins.indexOf(q) >= 0;
    });
  }
  if (all.length === 0) {
    var hint = q ? 'No tasks match "' + esc(q) + '".' : 'No tasks yet. Send a message below.';
    el.innerHTML = renderEmptyState(hint);
    return;
  }
  var lastGroup = '';
  var html = '';
  for (var ri = 0; ri < all.length; ri++) {
    var r = all[ri];
    var group = dateGroup(r.savedAt);
    if (group !== lastGroup) {
      html += '<div class="sidebar-date-hd">' + esc(group) + '</div>';
      lastGroup = group;
    }
    var ts = r.savedAt ? (group === 'Today' || group === 'Yesterday' ? shortTime(r.savedAt) : relTime(r.savedAt)) : '';
    var title = esc(humanTitle(r));
    var phase = r.phase || 'idle';
    var isActive = selectedRunId === r.runId;
    var isRunning = curRunId === r.runId && ACTIVE_PHASES.indexOf(phase) >= 0;
    var cls = 'chat-item-wrap';
    if (isActive) cls += ' active';
    if (isRunning) cls += ' running';
    /* phase + time subtitle — minimal */
    var pillCls = 'pp-' + phase;
    var sub = '<span class="chat-phase-pill ' + pillCls + '">' + esc(phase) + '</span>';
    if (r.projectContext && r.projectContext.projectLabel) sub += ' \\u00b7 ' + esc(r.projectContext.projectLabel);
    if (ts) sub += ' \\u00b7 ' + esc(ts);
    /* icon buttons for rename/delete */
    var editIcon = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M11.5 2.5l2 2L5 13H3v-2z"/></svg>';
    var trashIcon = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 5h10M5 5V3h6v2M6.5 7v4M9.5 7v4M4.5 5l.5 8h6l.5-8"/></svg>';
    html += '<div class="' + cls + '" data-rid="' + esc(r.runId) + '">' +
      '<button type="button" class="chat-item-body" data-action="selectChat" data-rid="' + esc(r.runId) + '">' +
        '<div class="chat-item-title">' + title + '</div>' +
        '<div class="chat-item-sub">' + sub + '</div>' +
      '</button>' +
      '<div class="chat-item-actions">' +
        '<button type="button" class="chat-act" data-action="renameChat" data-rid="' + esc(r.runId) + '" aria-label="Rename" title="Rename">' + editIcon + '</button>' +
        '<button type="button" class="chat-act chat-act-del" data-action="deleteChat" data-rid="' + esc(r.runId) + '" aria-label="Delete" title="Delete">' + trashIcon + '</button>' +
      '</div>' +
    '</div>';
  }
  el.innerHTML = html;
}

/* ---------- sidebar: keyboard nav ---------- */
function initSidebarKeyboard() {
  var sidebar = document.querySelector('.chat-side');
  if (!sidebar) return;

  sidebar.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Enter') return;
    var target = e.target;
    /* ignore if typing in search */
    if (target && target.id === 'sidebarSearch') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        var first = document.querySelector('#chatList .chat-item-body');
        if (first) first.focus();
      }
      return;
    }
    var items = Array.prototype.slice.call(document.querySelectorAll('#chatList .chat-item-body'));
    if (!items.length) return;
    var idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      var next = idx < items.length - 1 ? idx + 1 : 0;
      items[next].focus();
      _kbHighlight(items[next]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx <= 0) {
        var searchEl = document.getElementById('sidebarSearch');
        if (searchEl) searchEl.focus();
        _kbClear();
        return;
      }
      var prev = idx - 1;
      items[prev].focus();
      _kbHighlight(items[prev]);
    } else if (e.key === 'Enter') {
      if (idx >= 0) {
        e.preventDefault();
        var rid = items[idx].getAttribute('data-rid');
        if (rid) selectChat(rid);
      }
    }
  });

  /* wire up search input (debounced) */
  var searchInput = document.getElementById('sidebarSearch');
  if (searchInput) {
    var _searchTimer = null;
    searchInput.addEventListener('input', function () {
      if (_searchTimer) clearTimeout(_searchTimer);
      _searchTimer = setTimeout(function () { sidebarSearch(searchInput.value); }, 150);
    });
  }

  /* wire up search toggle nav item */
  var navSearchBtn = document.getElementById('navSearch');
  if (navSearchBtn) {
    navSearchBtn.addEventListener('click', function (e) {
      e.preventDefault();
      toggleSidebarSearch();
    });
  }

  var projectsEl = document.getElementById('sidebarProjects');
  if (projectsEl) {
    projectsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action="selectProject"]');
      if (!btn) return;
      e.preventDefault();
      selectProjectById(btn.dataset.projectId || '', btn.dataset.projectLabel || '');
    });
  }

  renderProjectList();
}

function _kbHighlight(el) {
  _kbClear();
  if (!el) return;
  var wrap = el.closest('.chat-item-wrap');
  if (wrap) wrap.classList.add('kb-focus');
}

function _kbClear() {
  var prev = document.querySelectorAll('.chat-item-wrap.kb-focus');
  for (var i = 0; i < prev.length; i++) prev[i].classList.remove('kb-focus');
}

/* init on load */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSidebarKeyboard);
} else {
  initSidebarKeyboard();
}
`;
}
