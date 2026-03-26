/**
 * Retry control panel for the dashboard.
 * Fetches invoke events, allows selecting events for batch retry
 * with dryRun / maxAccepted / abortOnQueueFull controls.
 */

export function getRetryStyles(): string {
  return `
.retry-modal{position:fixed;inset:0;z-index:var(--z-modal);display:flex;align-items:center;justify-content:center;background:var(--overlay-backdrop);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity var(--transition)}
.retry-modal.open{opacity:1;pointer-events:auto}
.retry-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-xl);width:min(780px,94vw);max-height:min(85vh,780px);overflow-y:auto;box-shadow:var(--shadow-lg);transform:translateY(12px);transition:transform var(--transition)}
.retry-modal.open .retry-card{transform:translateY(0)}
.retry-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card);z-index:1;border-radius:var(--radius-xl) var(--radius-xl) 0 0}
.retry-hd h2{font-size:16px;font-weight:700;font-family:var(--sans)}
.retry-close{background:none;border:none;color:var(--dim);cursor:pointer;font-size:18px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:0;border-radius:var(--radius);transition:all var(--transition)}
.retry-close:hover{background:var(--bg2);color:var(--text)}
.retry-close:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.retry-body{padding:16px 20px}
.retry-controls{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 16px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:14px}
.retry-ctrl-label{display:flex;align-items:center;gap:5px;font-size:var(--text-base);font-family:var(--mono);color:var(--dim);cursor:pointer;user-select:none}
.retry-ctrl-label input[type="checkbox"]{accent-color:var(--accent);cursor:pointer}
.retry-ctrl-label input[type="number"]{width:60px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:4px 8px;font-size:var(--text-base);font-family:var(--mono);color:var(--text);text-align:center}
.retry-ctrl-label input[type="number"]:focus{outline:none;border-color:var(--accent);box-shadow:var(--shadow-ring)}
.retry-actions{display:flex;gap:8px;margin-left:auto}
.retry-tbl{width:100%;border-collapse:collapse;font-size:var(--text-base);font-family:var(--mono)}
.retry-tbl th{text-align:left;padding:6px 8px;color:var(--muted);font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.06em;border-bottom:2px solid var(--border);background:var(--bg2);position:sticky;top:0}
.retry-tbl td{padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.retry-tbl tr:hover td{background:var(--accent-glow)}
.retry-tbl .retry-cb{width:20px;text-align:center}
.retry-tbl .retry-cb input{accent-color:var(--accent);cursor:pointer}
.retry-status-pill{display:inline-block;padding:1px 6px;border-radius:4px;font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.03em}
.retry-st-accepted{background:var(--green-dim);color:var(--green)}
.retry-st-rejected{background:var(--red-dim);color:var(--red)}
.retry-st-ignored{background:var(--yellow-dim);color:var(--yellow)}
.retry-result{margin-top:14px;padding:12px 16px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);font-size:var(--text-base);font-family:var(--mono);line-height:1.5;display:none}
.retry-result.visible{display:block}
.retry-result-ok{border-color:var(--success-border-soft);background:var(--green-dim)}
.retry-result-err{border-color:var(--danger-border-strong);background:var(--red-dim)}
.retry-empty{padding:24px;text-align:center;color:var(--muted);font-size:var(--text-md)}
.retry-spinner{display:none;width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite}
.retry-spinner.active{display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.retry-select-bar{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:var(--text-sm);color:var(--dim)}
.retry-tbl-wrap{max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius)}
.retry-filter-bar{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.retry-filter-select{background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:5px 10px;font-size:var(--text-base);font-family:var(--mono);cursor:pointer;transition:border-color var(--transition)}
.retry-filter-select:focus{outline:none;border-color:var(--accent);box-shadow:var(--shadow-ring)}
.retry-filter-input{background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:5px 10px;font-size:var(--text-base);font-family:var(--mono);transition:border-color var(--transition);width:140px}
.retry-filter-input:focus{outline:none;border-color:var(--accent);box-shadow:var(--shadow-ring)}
.retry-drawer{position:fixed;top:0;right:0;bottom:0;width:380px;background:var(--card);border-left:1px solid var(--border);z-index:var(--z-modal);transform:translateX(100%);transition:transform .2s ease;box-shadow:var(--shadow-lg);display:flex;flex-direction:column}
.retry-drawer.open{transform:translateX(0)}
.retry-drawer-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card);z-index:1;flex-shrink:0}
.retry-drawer-hd h3{font-size:var(--text-xl);font-weight:700;font-family:var(--sans);margin:0}
.retry-drawer-body{padding:16px;overflow-y:auto;flex:1;font-size:var(--text-base);font-family:var(--mono);line-height:1.5}
.retry-drawer-body pre{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;font-size:var(--text-base);margin:6px 0 12px}
.retry-drawer-body .drawer-label{font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px}
.retry-drawer-body .drawer-field{margin-bottom:14px}
.retry-drawer-lineage{font-size:var(--text-sm);color:var(--dim);margin-bottom:12px}
.retry-drawer-lineage a{color:var(--accent);cursor:pointer}
`;
}

export function getRetryHtml(): string {
  return `
<div class="retry-modal" id="retryModal" role="dialog" aria-modal="true" aria-label="Retry Events">
  <div class="retry-card">
    <div class="retry-hd">
      <h2>Retry Events</h2>
      <button type="button" class="retry-close" data-action="closeRetry" aria-label="Close retry panel">&times;</button>
    </div>
    <div class="retry-body">
      <div class="retry-filter-bar">
        <select id="retryFilterSource" class="retry-filter-select">
          <option value="">All Sources</option>
          <option value="api">api</option>
          <option value="github">github</option>
          <option value="batch">batch</option>
        </select>
        <select id="retryFilterStatus" class="retry-filter-select">
          <option value="">All Statuses</option>
          <option value="accepted">accepted</option>
          <option value="rejected">rejected</option>
          <option value="ignored">ignored</option>
        </select>
        <input id="retryFilterType" class="retry-filter-input" placeholder="Event type...">
        <button type="button" class="btn btn-g" data-action="applyRetryFilters" style="font-size:10px;padding:5px 12px">Filter</button>
      </div>
      <div class="retry-controls">
        <label class="retry-ctrl-label"><input type="checkbox" id="retryDryRun" checked> Dry Run</label>
        <label class="retry-ctrl-label">Max Accepted <input type="number" id="retryMaxAccepted" value="20" min="1" max="20"></label>
        <label class="retry-ctrl-label"><input type="checkbox" id="retryAbortFull" checked> Abort on Queue Full</label>
        <div class="retry-actions">
          <button type="button" class="btn btn-g" id="retrySelectedBtn" data-action="retrySelected" disabled>Retry Selected</button>
          <button type="button" class="btn btn-p" id="retryFailedBtn" data-action="retryAllFailed">Retry All Failed</button>
          <span class="retry-spinner" id="retrySpinner"></span>
        </div>
      </div>
      <div class="retry-select-bar">
        <label style="cursor:pointer"><input type="checkbox" id="retrySelectAll" style="accent-color:var(--accent)"> Select all</label>
        <span id="retrySelectedCount">0 selected</span>
      </div>
      <div class="retry-tbl-wrap">
        <table class="retry-tbl">
          <thead><tr>
            <th class="retry-cb"></th>
            <th>ID</th>
            <th>Source</th>
            <th>Type</th>
            <th>Status</th>
            <th>Received</th>
          </tr></thead>
          <tbody id="retryEventsBody"></tbody>
        </table>
      </div>
      <div class="retry-empty" id="retryEmpty">No events loaded. Open this panel to fetch events.</div>
      <div class="retry-result" id="retryResult"></div>
    </div>
  </div>
</div>
<div class="retry-drawer" id="retryDrawer">
  <div class="retry-drawer-hd">
    <h3 id="retryDrawerTitle">Event Detail</h3>
    <button type="button" class="retry-close" data-action="closeDrawer" aria-label="Close drawer">&times;</button>
  </div>
  <div class="retry-drawer-body" id="retryDrawerBody"></div>
</div>`;
}

export function getRetryScript(): string {
  return `
/* ---------- retry panel ---------- */
var _retryEvents = [];

function openRetryPanel() {
  var modal = document.getElementById('retryModal');
  if (modal) modal.classList.add('open');
  fetchRetryEvents();
}

function closeRetryPanel() {
  var modal = document.getElementById('retryModal');
  if (modal) modal.classList.remove('open');
}

function fetchRetryEvents() {
  var spinner = document.getElementById('retrySpinner');
  if (spinner) spinner.classList.add('active');
  fetch('/api/invoke/events?limit=50')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _retryEvents = data.events || [];
      renderRetryTable();
      if (spinner) spinner.classList.remove('active');
    })
    .catch(function(err) {
      showRetryResult('Failed to fetch events: ' + (err.message || err), true);
      if (spinner) spinner.classList.remove('active');
    });
}

function renderRetryTable() {
  var tbody = document.getElementById('retryEventsBody');
  var empty = document.getElementById('retryEmpty');
  if (!tbody) return;
  if (!_retryEvents.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  tbody.innerHTML = _retryEvents.map(function(ev) {
    var stCls = 'retry-st-' + (ev.status || 'ignored');
    var shortId = (ev.id || '').slice(0, 8);
    var dt = '';
    try { dt = new Date(ev.receivedAt).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch(e) { dt = ev.receivedAt || ''; }
    return '<tr data-eid="' + esc(ev.id) + '">' +
      '<td class="retry-cb"><input type="checkbox" class="retry-ev-cb" data-eid="' + esc(ev.id) + '"></td>' +
      '<td title="' + esc(ev.id) + '">' + esc(shortId) + '</td>' +
      '<td>' + esc(ev.source || '') + '</td>' +
      '<td>' + esc(ev.eventType || '') + '</td>' +
      '<td><span class="retry-status-pill ' + stCls + '">' + esc(ev.status || '') + '</span></td>' +
      '<td>' + esc(dt) + '</td>' +
    '</tr>';
  }).join('');
  updateRetrySelection();
}

function getSelectedEventIds() {
  var cbs = document.querySelectorAll('.retry-ev-cb:checked');
  var ids = [];
  for (var i = 0; i < cbs.length; i++) ids.push(cbs[i].getAttribute('data-eid'));
  return ids;
}

function getRetryControls() {
  var dryRun = document.getElementById('retryDryRun');
  var maxAcc = document.getElementById('retryMaxAccepted');
  var abortFull = document.getElementById('retryAbortFull');
  return {
    dryRun: dryRun ? dryRun.checked : true,
    maxAccepted: maxAcc ? parseInt(maxAcc.value, 10) || 20 : 20,
    abortOnQueueFull: abortFull ? abortFull.checked : true
  };
}

function updateRetrySelection() {
  var ids = getSelectedEventIds();
  var countEl = document.getElementById('retrySelectedCount');
  var btn = document.getElementById('retrySelectedBtn');
  if (countEl) countEl.textContent = ids.length + ' selected';
  if (btn) btn.disabled = ids.length === 0;
}

function sendRetryBatch(ids) {
  if (!ids.length) return;
  var ctrl = getRetryControls();
  var spinner = document.getElementById('retrySpinner');
  if (spinner) spinner.classList.add('active');
  var body = { ids: ids, dryRun: ctrl.dryRun, maxAccepted: ctrl.maxAccepted, abortOnQueueFull: ctrl.abortOnQueueFull };
  fetch('/api/invoke/events/retry-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      if (spinner) spinner.classList.remove('active');
      if (!res.ok) {
        showRetryResult('Error: ' + (res.data.error || 'Unknown error'), true);
        return;
      }
      var d = res.data;
      var results = d.results || [];
      var accepted = results.filter(function(r) { return r.accepted || r.wouldAccept; }).length;
      var failed = results.filter(function(r) { return !r.accepted && !r.wouldAccept; }).length;
      var mode = ctrl.dryRun ? 'DRY RUN' : 'LIVE';
      var msg = mode + ': ' + accepted + ' accepted, ' + failed + ' failed out of ' + results.length + ' events';
      if (d.aborted) msg += ' (aborted: queue full)';
      showRetryResult(msg, false);
      fetchRetryEvents();
    })
    .catch(function(err) {
      if (spinner) spinner.classList.remove('active');
      showRetryResult('Request failed: ' + (err.message || err), true);
    });
}

function retrySelected() {
  var ids = getSelectedEventIds();
  if (!ids.length) return;
  sendRetryBatch(ids);
}

function retryAllFailed() {
  var ids = _retryEvents
    .filter(function(ev) { return ev.status === 'rejected'; })
    .map(function(ev) { return ev.id; });
  if (!ids.length) {
    showRetryResult('No failed (rejected) events to retry.', true);
    return;
  }
  sendRetryBatch(ids);
}

function showRetryResult(msg, isError) {
  var el = document.getElementById('retryResult');
  if (!el) return;
  el.textContent = msg;
  el.className = 'retry-result visible ' + (isError ? 'retry-result-err' : 'retry-result-ok');
}

function applyRetryFilters() {
  var srcEl = document.getElementById('retryFilterSource');
  var stEl = document.getElementById('retryFilterStatus');
  var typeEl = document.getElementById('retryFilterType');
  var src = srcEl ? srcEl.value : '';
  var st = stEl ? stEl.value : '';
  var tp = typeEl ? typeEl.value.trim() : '';
  var url = '/api/invoke/events?limit=50';
  if (src) url += '&source=' + encodeURIComponent(src);
  if (st) url += '&status=' + encodeURIComponent(st);
  if (tp) url += '&type=' + encodeURIComponent(tp);
  var spinner = document.getElementById('retrySpinner');
  if (spinner) spinner.classList.add('active');
  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _retryEvents = data.events || [];
      renderRetryTable();
      if (spinner) spinner.classList.remove('active');
    })
    .catch(function(err) {
      showRetryResult('Filter fetch failed: ' + (err.message || err), true);
      if (spinner) spinner.classList.remove('active');
    });
}

function openEventDrawer(eventId) {
  var drawer = document.getElementById('retryDrawer');
  var body = document.getElementById('retryDrawerBody');
  var title = document.getElementById('retryDrawerTitle');
  if (!drawer || !body) return;
  if (title) title.textContent = 'Loading...';
  body.innerHTML = '';
  drawer.classList.add('open');
  var ev = null;
  for (var i = 0; i < _retryEvents.length; i++) {
    if (_retryEvents[i].id === eventId) { ev = _retryEvents[i]; break; }
  }
  if (!ev) {
    if (title) title.textContent = 'Event Detail';
    body.innerHTML = '<div style="color:var(--muted)">Event not found in loaded list.</div>';
    return;
  }
  if (title) title.textContent = 'Event ' + (ev.id || '').slice(0, 8);
  var stCls = 'retry-st-' + (ev.status || 'ignored');
  var dt = '';
  try { dt = new Date(ev.receivedAt).toLocaleString(); } catch(e) { dt = ev.receivedAt || ''; }
  var h = '';
  h += '<div class="drawer-field"><div class="drawer-label">ID</div><div>' + esc(ev.id || '') + '</div></div>';
  h += '<div class="drawer-field"><div class="drawer-label">Source</div><div>' + esc(ev.source || '') + '</div></div>';
  h += '<div class="drawer-field"><div class="drawer-label">Event Type</div><div>' + esc(ev.eventType || '') + '</div></div>';
  h += '<div class="drawer-field"><div class="drawer-label">Status</div><div><span class="retry-status-pill ' + stCls + '">' + esc(ev.status || '') + '</span></div></div>';
  h += '<div class="drawer-field"><div class="drawer-label">Received At</div><div>' + esc(dt) + '</div></div>';
  if (ev.instruction) {
    h += '<div class="drawer-field"><div class="drawer-label">Instruction</div><pre>' + esc(ev.instruction) + '</pre></div>';
  }
  if (ev.retryOfEventId) {
    h += '<div class="retry-drawer-lineage"><div class="drawer-label">Retry Lineage</div>';
    h += 'Retry of: <a data-drawer-eid="' + esc(ev.retryOfEventId) + '">' + esc(ev.retryOfEventId.slice(0, 8)) + '</a>';
    h += '</div>';
  }
  if (ev.metadata) {
    var meta = '';
    try { meta = JSON.stringify(ev.metadata, null, 2); } catch(e) { meta = String(ev.metadata); }
    h += '<div class="drawer-field"><div class="drawer-label">Metadata</div><pre>' + esc(meta) + '</pre></div>';
  }
  if (ev.status === 'rejected') {
    h += '<button type="button" class="btn btn-p" data-action="retrySingleFromDrawer" data-eid="' + esc(ev.id) + '" style="margin-top:8px">Retry This Event</button>';
  }
  body.innerHTML = h;
}

function closeEventDrawer() {
  var drawer = document.getElementById('retryDrawer');
  if (drawer) drawer.classList.remove('open');
}

/* event delegation wiring (added to global click handler) */
function handleRetryAction(action) {
  if (action === 'openRetry') { openRetryPanel(); return true; }
  if (action === 'closeRetry') { closeRetryPanel(); return true; }
  if (action === 'retrySelected') { retrySelected(); return true; }
  if (action === 'retryAllFailed') { retryAllFailed(); return true; }
  if (action === 'applyRetryFilters') { applyRetryFilters(); return true; }
  if (action === 'closeDrawer') { closeEventDrawer(); return true; }
  if (action === 'retrySingleFromDrawer') { return false; /* handled below */ }
  return false;
}

/* checkbox delegation */
document.addEventListener('change', function(e) {
  var target = e.target;
  if (target && target.id === 'retrySelectAll') {
    var cbs = document.querySelectorAll('.retry-ev-cb');
    for (var i = 0; i < cbs.length; i++) cbs[i].checked = target.checked;
    updateRetrySelection();
    return;
  }
  if (target && target.classList && target.classList.contains('retry-ev-cb')) {
    updateRetrySelection();
  }
});

/* click outside modal */
document.addEventListener('click', function(ev) {
  var modal = document.getElementById('retryModal');
  if (modal && ev.target === modal) closeRetryPanel();
});

/* row click -> open drawer; pill click on rejected -> one-click retry */
document.addEventListener('click', function(ev) {
  var target = ev.target;
  /* one-click retry on rejected status pill */
  if (target && target.classList && target.classList.contains('retry-status-pill') && target.classList.contains('retry-st-rejected')) {
    var row = target.closest('tr[data-eid]');
    if (row) {
      var eid = row.getAttribute('data-eid');
      if (eid && confirm('Retry event ' + eid + '?')) {
        sendRetryBatch([eid]);
      }
    }
    ev.stopPropagation();
    return;
  }
  /* single retry from drawer button */
  if (target && target.closest && target.closest('[data-action="retrySingleFromDrawer"]')) {
    var btn = target.closest('[data-action="retrySingleFromDrawer"]');
    var singleId = btn.getAttribute('data-eid');
    if (singleId && confirm('Retry event ' + singleId + '?')) {
      sendRetryBatch([singleId]);
      closeEventDrawer();
    }
    return;
  }
  /* lineage link in drawer */
  if (target && target.hasAttribute && target.hasAttribute('data-drawer-eid')) {
    var linkedId = target.getAttribute('data-drawer-eid');
    if (linkedId) openEventDrawer(linkedId);
    return;
  }
  /* row click -> open drawer (skip checkbox column) */
  var tr = target && target.closest ? target.closest('tr[data-eid]') : null;
  if (tr && tr.closest('.retry-tbl')) {
    var isCheckbox = target.tagName === 'INPUT' || (target.closest && target.closest('.retry-cb'));
    if (!isCheckbox) {
      openEventDrawer(tr.getAttribute('data-eid'));
    }
  }
});
`;
}
