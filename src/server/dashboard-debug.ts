export const RUN_DEBUG_STYLES = `
.dbg-modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(3,6,12,.72);backdrop-filter:blur(10px);z-index:40}
.dbg-modal.open{display:flex}
.dbg-card{width:min(760px,100%);max-height:min(86dvh,820px);overflow:auto;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--border-bright);border-radius:var(--radius-lg);box-shadow:var(--shadow-glow),var(--shadow)}
.dbg-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border)}
.dbg-title{font-size:12px;font-weight:700;color:var(--text-bright);letter-spacing:.02em}
.dbg-close{width:28px;height:28px;border-radius:999px}
.dbg-body{padding:16px}
.dbg-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}
.dbg-row{padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius);background:rgba(10,14,23,.8)}
.dbg-k{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
.dbg-v{font-size:12px;color:var(--text);line-height:1.45;word-break:break-word}
.dbg-v code{font-size:11px}
.dbg-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.dbg-empty{padding:20px;border:1px dashed var(--border-bright);border-radius:var(--radius);color:var(--dim);text-align:center}
@media(max-width:760px){.dbg-grid{grid-template-columns:1fr}.dbg-modal{padding:12px}}
`;

export function getRunDebugModalHtml(): string {
  return `
<div class="dbg-modal" id="runDebugModal" aria-hidden="true">
  <div class="dbg-card" role="dialog" aria-modal="true" aria-labelledby="runDebugTitle">
    <div class="dbg-hd">
      <div class="dbg-title" id="runDebugTitle">Run debug</div>
      <button type="button" class="btn btn-g dbg-close" data-action="closeRunDebug" aria-label="Close debug">x</button>
    </div>
    <div class="dbg-body" id="runDebugBody"></div>
  </div>
</div>`;
}

export function getRunDebugScript(): string {
  return `
var runDebugCache = {};

function dbgEsc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function dbgDur(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}
function dbgDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch (e) {
    return iso;
  }
}
function dbgNum(n) {
  return typeof n === 'number' ? n.toLocaleString() : '—';
}
function dbgCode(v) {
  return v ? '<code>' + dbgEsc(v) + '</code>' : '—';
}
function dbgRow(k, v) {
  return '<div class="dbg-row"><div class="dbg-k">' + dbgEsc(k) + '</div><div class="dbg-v">' + v + '</div></div>';
}
function renderRunDebug(snapshot) {
  var external = snapshot.traceUrl ? dbgCode(snapshot.traceUrl) : '<span style="color:var(--dim)">external trace missing</span>';
  var primaryModel = snapshot.primaryModel ? dbgCode(snapshot.primaryModel) : '<span style="color:var(--dim)">no model used</span>';
  var tokenUsage = snapshot.tokenUsage
    ? [
        'input ' + dbgNum(snapshot.tokenUsage.input),
        'output ' + dbgNum(snapshot.tokenUsage.output),
        snapshot.tokenUsage.cacheRead != null ? 'cache read ' + dbgNum(snapshot.tokenUsage.cacheRead) : null,
        snapshot.tokenUsage.cacheCreation != null ? 'cache write ' + dbgNum(snapshot.tokenUsage.cacheCreation) : null
      ].filter(Boolean).join('<br>')
    : '<span style="color:var(--dim)">none</span>';

  var html = '';
  html += '<div class="dbg-actions">';
  html += '<button type="button" class="btn btn-g" data-action="openDebugLink" data-url="' + dbgEsc(snapshot.openTraceUrl) + '">Open trace</button>';
  html += '<button type="button" class="btn btn-g" data-action="copyDebugLink" data-url="' + dbgEsc(snapshot.openTraceUrl) + '">Copy trace URL</button>';
  html += '<button type="button" class="btn btn-g" data-action="openDebugLink" data-url="/api/runs/' + dbgEsc(snapshot.runId) + '">Open run JSON</button>';
  html += '</div>';
  html += '<div class="dbg-grid">';
  html += dbgRow('Run ID', dbgCode(snapshot.runId));
  html += dbgRow('Phase', dbgEsc(snapshot.phase || '—'));
  html += dbgRow('Thread kind', dbgEsc(snapshot.threadKind || '—'));
  html += dbgRow('Run mode', dbgEsc(snapshot.runMode || '—'));
  html += dbgRow('Execution path', dbgEsc(snapshot.executionPath || '—'));
  html += dbgRow('Primary role', dbgEsc(snapshot.primaryRole || '—'));
  html += dbgRow('Primary model', primaryModel);
  html += dbgRow('Queue wait', dbgDur(snapshot.queueWaitMs));
  html += dbgRow('Duration', dbgDur(snapshot.durationMs));
  html += dbgRow('Queued', dbgEsc(dbgDate(snapshot.queuedAt)));
  html += dbgRow('Started', dbgEsc(dbgDate(snapshot.startedAt)));
  html += dbgRow('Saved', dbgEsc(dbgDate(snapshot.savedAt)));
  html += dbgRow('Tokens', tokenUsage);
  html += dbgRow('External trace', external);
  html += dbgRow('Local trace', dbgCode(snapshot.localTraceUrl));
  html += dbgRow('Run model override', snapshot.modelOverride ? dbgCode(snapshot.modelOverride) : '<span style="color:var(--dim)">none</span>');
  html += dbgRow('Counts', 'messages ' + dbgNum(snapshot.messageCount) + '<br>tools ' + dbgNum(snapshot.toolCallCount) + '<br>edits ' + dbgNum(snapshot.fileEditCount) + '<br>steps ' + dbgNum(snapshot.stepCount));
  html += dbgRow('Instruction', snapshot.instruction ? dbgEsc(snapshot.instruction) : '<span style="color:var(--dim)">empty</span>');
  html += dbgRow('Error', snapshot.error ? dbgEsc(snapshot.error) : '<span style="color:var(--dim)">none</span>');
  html += '</div>';
  return html;
}
function setRunDebugBody(html) {
  var body = document.getElementById('runDebugBody');
  if (body) body.innerHTML = html;
}
function openRunDebug(runId) {
  if (!runId) return;
  var modal = document.getElementById('runDebugModal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  setRunDebugBody('<div class="dbg-empty">Loading debug…</div>');
  fetch('/api/runs/' + encodeURIComponent(runId) + '/debug')
    .then(function(res){
      if (!res.ok) throw new Error('debug fetch failed');
      return res.json();
    })
    .then(function(snapshot){
      runDebugCache[runId] = snapshot;
      setRunDebugBody(renderRunDebug(snapshot));
    })
    .catch(function(err){
      setRunDebugBody('<div class="dbg-empty">Debug unavailable<br><span style="font-size:11px;color:var(--muted)">' + dbgEsc(err.message || 'unknown error') + '</span></div>');
    });
}
function closeRunDebug() {
  var modal = document.getElementById('runDebugModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}
function copyRunDebugLink(url) {
  if (!url || !navigator.clipboard) return;
  var href = /^https?:\\/\\//.test(url) ? url : (location.origin + url);
  navigator.clipboard.writeText(href).then(function(){
    var st = document.getElementById('subSt');
    if (st) st.textContent = 'Trace URL copied';
  }).catch(function(){});
}
`;
}
