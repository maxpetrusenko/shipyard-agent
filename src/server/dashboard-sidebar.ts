/**
 * Sidebar panel for the chat dashboard.
 * Extracted from dashboard.ts — exports CSS, HTML, and JS as strings.
 *
 * Redesigned: Config tab removed (moved to modal). Sidebar is now purely
 * a chat list with search, relative timestamps, active-run accent border,
 * pulse animation, and keyboard navigation.
 */

export function getSidebarStyles(): string {
  return `
/* sidebar layout */
.chat-side{font-size:var(--text-base);color:var(--dim);min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px}

/* full-width new chat button */
.sidebar-new-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:9px 0;border:none;border-radius:var(--radius);background:var(--accent);color:var(--text-inverse);font-family:var(--mono);font-size:var(--text-base);font-weight:700;letter-spacing:.04em;cursor:pointer;transition:all var(--transition);box-shadow:var(--btn-accent-shadow-soft)}
.sidebar-new-btn:hover{opacity:.88;transform:translateY(-1px)}
.sidebar-new-btn:active{transform:translateY(0)}
.sidebar-new-btn:focus-visible{outline:none;box-shadow:var(--shadow-ring)}

/* search input */
.sidebar-search{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:7px 10px 7px 30px;font-size:var(--text-base);font-family:var(--mono);outline:none;transition:border-color var(--transition);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='6' cy='6' r='4'/%3E%3Cline x1='9' y1='9' x2='13' y2='13'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:9px center;background-size:13px}
.sidebar-search:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-dim)}
.sidebar-search::placeholder{color:var(--muted)}

/* chat item wrap states */
.chat-item-wrap{display:flex;align-items:stretch;gap:2px;margin-bottom:4px;border-radius:var(--radius);border:1px solid transparent;border-left:3px solid transparent;overflow:hidden;transition:background var(--transition),border-color var(--transition)}
.chat-item-wrap:hover{background:var(--card2)}
.chat-item-wrap.active{border-color:var(--accent);border-left-color:var(--accent);background:var(--accent-glow)}
.chat-item-wrap:focus-within{box-shadow:var(--shadow-ring)}

/* running pulse */
@keyframes sidebar-pulse{0%,100%{border-left-color:var(--accent)}50%{border-left-color:var(--yellow)}}
.chat-item-wrap.running{border-left:3px solid var(--accent);animation:sidebar-pulse 2s ease-in-out infinite}

/* item body */
.chat-item-body{flex:1;min-width:0;text-align:left;padding:9px 10px;line-height:1.35;background:transparent;color:inherit;font-family:inherit;border:none;cursor:pointer;border-radius:0}
.chat-item-title{font-size:var(--text-base);color:var(--text);font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.chat-item-sub{display:flex;align-items:center;gap:5px;font-size:var(--text-xs);color:var(--muted);margin-top:4px}
.chat-phase-pill{display:inline-block;padding:1px 6px;border-radius:4px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;line-height:1.4}

/* sidebar footer */
.sidebar-footer{margin-top:auto;padding-top:8px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:var(--text-sm);color:var(--muted)}
.sidebar-footer-btn{background:none;border:none;color:var(--dim);cursor:pointer;font-family:var(--mono);font-size:var(--text-sm);padding:4px 8px;border-radius:var(--radius);transition:all var(--transition)}
.sidebar-footer-btn:hover{color:var(--accent);background:var(--accent-glow)}
.sidebar-footer-btn:focus-visible{outline:none;box-shadow:var(--shadow-ring)}

/* item actions */
.chat-item-actions{display:flex;flex-direction:column;justify-content:center;gap:4px;padding:6px 8px 6px 4px;flex-shrink:0}
.chat-act{font-size:var(--text-xs);padding:3px 8px;border-radius:var(--radius);border:1px solid var(--border);background:var(--card);color:var(--dim);cursor:pointer;font-family:var(--mono);line-height:1.2}
.chat-act:hover{border-color:var(--accent);color:var(--accent)}
.chat-act:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.chat-act-del{color:var(--red);border-color:var(--danger-border-med)}
.chat-act-del:hover{border-color:var(--red);color:var(--red)}

/* keyboard-selected highlight */
.chat-item-wrap.kb-focus{outline:2px solid var(--accent);outline-offset:-2px}
`;
}

export function getSidebarHtml(): string {
  return `
  <aside class="chat-side" aria-label="Chats">
    <button type="button" class="sidebar-new-btn" id="newChatBtn" data-action="newChat">+ New Chat</button>
    <input type="text" class="sidebar-search" id="sidebarSearch" placeholder="Search chats..." aria-label="Search chats" autocomplete="off">
    <div id="chatList" style="flex:1;min-height:0;overflow-y:auto;padding-right:4px"></div>
    <div class="sidebar-footer">
      <button type="button" class="sidebar-footer-btn" data-action="openSettings">Config</button>
      <button type="button" class="sidebar-footer-btn" data-action="showShortcuts">Shortcuts</button>
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

/* ---------- sidebar: human title ---------- */
function humanTitle(r) {
  if (titleOverrides[r.runId]) return titleOverrides[r.runId];
  var ins = (r.instruction || '').trim();
  if (!ins) return 'Untitled chat';
  var line = ins.split('\\n')[0].trim();
  if (line.length > 58) line = line.slice(0, 55) + '\\u2026';
  return line;
}

/* ---------- sidebar: rename / delete ---------- */
function renameChat(runId) {
  var current = humanTitle(runsMap[runId] || { runId: runId });
  var newName = prompt('Rename chat:', current);
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
  saveSelectedRunId();
  renderChatList();
  renderChatThread();
  void refreshRunDetails(runId);
}

function newChat() {
  selectedRunId = null;
  saveSelectedRunId();
  renderChatList();
  renderChatThread();
  syncComposerUi();
  var searchEl = document.getElementById('sidebarSearch');
  if (searchEl) searchEl.value = '';
}

/* ---------- sidebar: search filter ---------- */
var _sidebarQuery = '';

function sidebarSearch(query) {
  _sidebarQuery = (query || '').toLowerCase().trim();
  renderChatList();
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
    var hint = q ? 'No chats match "' + esc(q) + '".' : 'No chats yet. Send a message below.';
    el.innerHTML = renderEmptyState(hint);
    return;
  }
  el.innerHTML = all.map(function(r) {
    var ts = r.savedAt ? relTime(r.savedAt) : '';
    var title = esc(humanTitle(r));
    var phase = r.phase || 'idle';
    var isActive = selectedRunId === r.runId;
    var isRunning = curRunId === r.runId && ACTIVE_PHASES.indexOf(phase) >= 0;
    var cls = 'chat-item-wrap';
    if (isActive) cls += ' active';
    if (isRunning) cls += ' running';
    var kind = r.threadKind ? (' \\u00b7 ' + r.threadKind) : '';
    var cancelSrc = r.cancellation ? (' \\u00b7 canceled') : '';
    /* phase pill with color */
    var pillCls = 'pp-' + phase;
    var phasePill = '<span class="chat-phase-pill pbadge ' + pillCls + '">' + esc(phase) + '</span>';
    var metaTxt = kind + cancelSrc + (ts ? ' \\u00b7 ' + ts : '');
    return '<div class="' + cls + '" data-rid="' + esc(r.runId) + '">' +
      '<button type="button" class="chat-item-body" data-action="selectChat" data-rid="' + esc(r.runId) + '">' +
        '<div class="chat-item-title">' + title + '</div>' +
        '<div class="chat-item-sub">' + phasePill + '<span>' + esc(metaTxt) + '</span></div>' +
      '</button>' +
      '<div class="chat-item-actions">' +
        '<button type="button" class="chat-act" data-action="renameChat" data-rid="' + esc(r.runId) + '" aria-label="Rename chat">Rename</button>' +
        '<button type="button" class="chat-act chat-act-del" data-action="deleteChat" data-rid="' + esc(r.runId) + '" aria-label="Delete chat">Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
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
