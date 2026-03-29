/**
 * Timeline data model + renderers for the unified dashboard feed.
 * Returns vanilla JS as a string for injection into the dashboard <script> block.
 */

export function getTimelineScript(): string {
  return `
// ---- Inject timeline polish styles ----
(function(){
  var s = document.createElement('style');
  s.textContent = [
    '.tl-avatar{width:24px;height:24px;border-radius:50%;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;letter-spacing:.02em;line-height:1}',
    '.tl-avatar-user{background:var(--card2);color:var(--dim);border:1px solid var(--border)}',
    '.tl-avatar-agent{background:var(--accent-glow);color:var(--accent);border:1px solid var(--accent-dim)}',
    '.tl-tool-icon{width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;color:var(--dim);flex-shrink:0}',
    '.tl-tool-icon svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}',
    '.tl-msg-row{display:flex;align-items:flex-start;gap:8px}',
    '.tl-msg-row-user{justify-content:flex-end}',
    '.tl-msg-row-agent{justify-content:flex-start}',
    '.tl-phase{display:flex;align-items:center;gap:8px;padding:4px 12px;font-size:10px;color:var(--muted);letter-spacing:.04em;margin:6px 0;font-weight:500}',
    '.tl-phase-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}',
    '.tl-row{margin-bottom:6px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}',
    '.tl-hdr{border-left:3px solid var(--border)}',
    '.tl-chev{font-size:7px;color:var(--muted);transition:transform .2s}',
    '.msg-think-active{border-color:var(--purple-dim)!important;border-style:dashed!important;background:var(--card)!important}',
    '.msg-think-active .msg-meta{color:var(--purple)!important}',
    '.tl-think-sealed .tl-hdr{border-left-color:var(--purple-dim)!important;background:var(--card)!important}',
    '.tl-think-sealed .tl-body{background:var(--card)!important;border-top-color:var(--border)!important}',
    '.tl-think-sealed .tl-pre{color:var(--muted)!important;font-size:11px}',
  ].join('\\n');
  document.head.appendChild(s);
})();

// ---- Timeline data model ----
var timelineMap = {};  // runId -> TimelineEntry[]
var lastPhaseForRun = {};
var verResultSeen = {};
var reviewSeen = {};
function mkEntry(type, ts, data) {
  return { type: type, ts: ts || Date.now(), data: data };
}
function mkUserMsg(ts, content) { return mkEntry('user_msg', ts, { content: content }); }
function mkAsstMsg(ts, content) { return mkEntry('asst_msg', ts, { content: content }); }
function mkThinking(ts, text) { return mkEntry('thinking', ts, { text: text, sealed: false }); }
function mkToolCall(ts, name, ok, fp, detail, durMs, toolInput, toolResult) { return mkEntry('tool_call', ts, { name: name, ok: ok, fp: fp, detail: detail, durMs: durMs, toolInput: toolInput || null, toolResult: toolResult || null }); }
function mkFileEdit(ts, path, tier, oldStr, newStr) { return mkEntry('file_edit', ts, { path: path, tier: tier, oldStr: oldStr, newStr: newStr }); }
function mkVerification(ts, passed, errCount, tcOut, testOut) { return mkEntry('verification', ts, { passed: passed, errCount: errCount, tcOut: tcOut, testOut: testOut }); }
function mkReview(ts, decision, feedback) { return mkEntry('review', ts, { decision: decision, feedback: feedback }); }
function mkNextActions(ts, actions) { return mkEntry('next_actions', ts, { actions: actions || [] }); }
function mkPhase(ts, phase) { return mkEntry('phase', ts, { phase: phase }); }
function isTimelineMessage(entry) { return entry && (entry.type === 'user_msg' || entry.type === 'asst_msg'); }
function normalizeRunMessages(messages) {
  var out = [];
  var list = Array.isArray(messages) ? messages : [];
  for (var i = 0; i < list.length; i++) {
    var msg = list[i];
    if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue;
    var content = msg.content || '';
    if (msg.role === 'assistant') {
      content = sanitizeAssistantContent(content);
      if (!content.trim()) continue;
    }
    out.push({ role: msg.role, content: content });
  }
  return out;
}
function sanitizeAssistantContent(raw) {
  var text = String(raw || '');
  if (!text) return '';
  // Strip planner envelopes that are useful for the agent but noisy in chat UI.
  text = text.replace(/<plan>[\\s\\S]*?<\\/plan>/gi, '').trim();
  // Strip internal markers that leak from graph nodes.
  text = text.replace(/STEP_COMPLETE/g, '').trim();
  // Strip internal bracket-prefixed status lines (e.g. [Review] done: OK, [Compaction] ...).
  text = text.replace(/^\\[(Review|Compaction|Watchdog|Follow-up)\\][^\\n]*/gm, '').trim();
  // Suppress raw JSON payload responses from internal nodes.
  var compact = text.replace(/\\s+/g, ' ').trim();
  if (
    (/^\\{[\\s\\S]*\\}$/.test(text) || /^\\[[\\s\\S]*\\]$/.test(text)) &&
    /(decision|steps|verification|review|tool|phase|feedback)/i.test(compact)
  ) {
    return '[internal agent payload hidden]';
  }
  return text;
}
function shouldSuppressThinkingChunk(raw) {
  var t = String(raw || '').trim();
  if (!t) return true;
  if (/<plan>/i.test(t)) return true;
  var looksJson = (/^\\{[\\s\\S]*\\}$/.test(t) || /^\\[[\\s\\S]*\\]$/.test(t));
  if (looksJson && /(tool_use|tool_result|decision|steps|phase|review|verification)/i.test(t)) {
    return true;
  }
  return false;
}
function messageEntryFromRunMessage(msg, ts) {
  return msg.role === 'user'
    ? mkUserMsg(ts, msg.content)
    : mkAsstMsg(ts, sanitizeAssistantContent(msg.content));
}
function lastUserMessageIndex(messages) {
  for (var i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}
function seedTimelineFromMessages(runId, messages) {
  var normalized = normalizeRunMessages(messages);
  if (!normalized.length) return;
  if (!timelineMap[runId]) timelineMap[runId] = [];
  var tl = timelineMap[runId];
  for (var i = 0; i < tl.length; i++) {
    if (isTimelineMessage(tl[i])) return;
  }
  var seedUntil = lastUserMessageIndex(normalized);
  if (seedUntil < 0) seedUntil = normalized.length - 1;
  var seed = [];
  for (var j = 0; j <= seedUntil; j++) {
    seed.push(messageEntryFromRunMessage(normalized[j], Date.now() - (seedUntil - j + 1)));
  }
  if (seed.length) tl.unshift.apply(tl, seed);
}
function appendTrailingMessages(runId, messages) {
  var normalized = normalizeRunMessages(messages);
  if (!normalized.length) return;
  if (!timelineMap[runId]) timelineMap[runId] = [];
  var tl = timelineMap[runId];
  var existingCount = 0;
  for (var i = 0; i < tl.length; i++) {
    if (isTimelineMessage(tl[i])) existingCount++;
  }
  for (var j = existingCount; j < normalized.length; j++) {
    tl.push(messageEntryFromRunMessage(normalized[j], Date.now() + j));
  }
}
function syncTimelineFromRun(runId, run) {
  if (!runId || !run) return;
  if (!timelineMap[runId] || !timelineMap[runId].length) {
    timelineMap[runId] = buildTimeline(run);
    return;
  }
  seedTimelineFromMessages(runId, run.messages);
  appendTrailingMessages(runId, run.messages);
}

// Clear live timeline so buildTimeline reconstructs from full persisted data
function clearRunTimeline(runId) {
  console.log('[TL] clearRunTimeline', runId);
  delete timelineMap[runId];
  delete lastPhaseForRun[runId];
  delete verResultSeen[runId];
  delete reviewSeen[runId];
}

// Build timeline from a completed/persisted run
function buildTimeline(r) {
  console.log('[TL] buildTimeline', r.runId, 'msgs=' + (r.messages||[]).length, 'tools=' + (r.toolCallHistory||[]).length, 'edits=' + (r.fileEdits||[]).length);
  var entries = [];
  var msgs = r.messages || [];
  var edits = r.fileEdits || [];
  var tools = r.toolCallHistory || [];
  var dur = r.durationMs || 0;
  var base = r.savedAt ? new Date(r.savedAt).getTime() - dur : Date.now() - dur;
  var msgList = normalizeRunMessages(msgs);
  var latestUserIdx = lastUserMessageIndex(msgList);
  var leadMsgs = latestUserIdx >= 0 ? msgList.slice(0, latestUserIdx + 1) : msgList.slice();
  var trailingMsgs = latestUserIdx >= 0 ? msgList.slice(latestUserIdx + 1) : [];
  var totalEvents = leadMsgs.length + trailingMsgs.length + edits.length + tools.length;
  var step = totalEvents > 1 ? dur / totalEvents : 0;
  var tIdx = 0;

  // Earlier turns + latest user turn first
  for (var i = 0; i < leadMsgs.length; i++) {
    var m = leadMsgs[i];
    var ts = base + (tIdx++ * step);
    entries.push(messageEntryFromRunMessage(m, ts));
  }

  // Tool calls
  for (var j = 0; j < tools.length; j++) {
    var tc = tools[j];
    var tsT = base + (tIdx++ * step);
    var ok = !(tc.tool_result || '').startsWith('Error');
    var fp = tc.tool_input && tc.tool_input.file_path ? String(tc.tool_input.file_path) : '';
    var detail = fp || JSON.stringify(tc.tool_input || {}).slice(0, 120);
    entries.push(mkToolCall(tsT, tc.tool_name, ok, fp, detail, tc.duration_ms, tc.tool_input, tc.tool_result));
  }

  // File edits
  for (var k = 0; k < edits.length; k++) {
    var ed = edits[k];
    var tsE = base + (tIdx++ * step);
    entries.push(mkFileEdit(tsE, ed.file_path, ed.tier, ed.old_string, ed.new_string));
  }

  // Assistant/result messages after live work for the latest turn
  for (var mIdx = 0; mIdx < trailingMsgs.length; mIdx++) {
    var msg = trailingMsgs[mIdx];
    var tsM = base + (tIdx++ * step);
    entries.push(messageEntryFromRunMessage(msg, tsM));
  }

  // Verification
  var vr = r.verificationResult;
  if (vr) {
    entries.push(
      mkVerification(
        base + dur - 2000,
        vr.passed,
        vr.errorCount !== undefined ? vr.errorCount : vr.error_count,
        vr.typecheckOutput !== undefined ? vr.typecheckOutput : vr.typecheck_output,
        vr.testOutput !== undefined ? vr.testOutput : vr.test_output,
      ),
    );
  }

  // Review
  var rf = r.reviewFeedback;
  if (rf) {
    if (typeof rf === 'string') {
      entries.push(mkReview(base + dur - 1000, 'review', rf));
    } else {
      entries.push(mkReview(base + dur - 1000, rf.decision, rf.feedback));
    }
  }

  if (Array.isArray(r.nextActions) && r.nextActions.length > 0) {
    entries.push(mkNextActions(base + dur - 500, r.nextActions));
  }

  entries.sort(function(a,b){ return a.ts - b.ts; });
  return entries;
}

// ---- Renderers ----
function tlEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function tlShortPath(p) {
  if (!p) return '';
  return (WORK_DIR && p.indexOf(WORK_DIR) === 0) ? p.slice(WORK_DIR.length).replace(/^\\//, '') : p;
}
function tlToolIcon(name) {
  var n = String(name || '').toLowerCase();
  var isWebSearch = n === 'web_search' || n === 'websearch';
  if (n === 'read_file' || n === 'grep' || n === 'glob') {
    return '<span class="tl-tool-icon"><svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4"/><line x1="10" y1="10" x2="14" y2="14"/></svg></span>';
  }
  if (n === 'edit_file' || n === 'write_file') {
    return '<span class="tl-tool-icon"><svg viewBox="0 0 16 16"><path d="M11.5 1.5l3 3L5 14H2v-3z"/><line x1="9.5" y1="3.5" x2="12.5" y2="6.5"/></svg></span>';
  }
  if (n === 'bash') {
    return '<span class="tl-tool-icon"><svg viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="12" rx="2"/><polyline points="4 6 7 8 4 10"/><line x1="9" y1="10" x2="12" y2="10"/></svg></span>';
  }
  if (isWebSearch) {
    return '<span class="tl-tool-icon"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="3" ry="6"/><line x1="2" y1="8" x2="14" y2="8"/></svg></span>';
  }
  return '<span class="tl-tool-icon"><svg viewBox="0 0 16 16"><path d="M10.3 1.7a4 4 0 0 0-5 5L2 10l1 3 3-1 3.3-3.3a4 4 0 0 0 5-5l-2.3 2.3-1.4-1.4L12.8 3.3a4 4 0 0 0-2.5-1.6z"/></svg></span>';
}
function tlAvatarUser() {
  return '<span class="tl-avatar tl-avatar-user">Y</span>';
}
function tlAvatarAgent() {
  return '<span class="tl-avatar tl-avatar-agent">S</span>';
}
function traceBtnHtml(runId) {
  return '<button type="button" class="trace-btn" data-action="openDebug" data-rid="' + tlEsc(runId || '') + '" title="Open debug" aria-label="Open debug">i</button>';
}
function renderMsgMetaRow(label, runId) {
  var traceBtn = traceBtnHtml(runId);
  return '<div class="msg-meta-row"><div class="msg-meta">' + tlEsc(label) + '</div>' + traceBtn + '</div>';
}
function renderTlCollapsible(idx, label, accentColor, startCollapsed, bodyHtml, tag) {
  var cls = startCollapsed ? ' collapsed' : '';
  var tagHtml = '';
  if (tag) {
    var tagCls = tag === 'ok' ? 'tl-tag tl-tag-ok' : (tag === 'fail' ? 'tl-tag tl-tag-fail' : 'tl-tag');
    tagHtml = '<span class="' + tagCls + '">' + tlEsc(tag) + '</span>';
  }
  // Softer chevron: small SVG instead of unicode triangle
  var chevSvg = '<span class="tl-chev" style="display:inline-flex;align-items:center"><svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="2,1 6,4 2,7"/></svg></span>';
  return '<div class="tl-row' + cls + '" id="tl-' + idx + '">' +
    '<div class="tl-hdr" data-action="toggleTl" data-idx="' + idx + '" style="border-left-color:' + (accentColor || 'var(--border)') + '">' +
      chevSvg +
      '<span style="flex:1">' + label + '</span>' +
      tagHtml +
    '</div>' +
    '<div class="tl-body">' + bodyHtml + '</div>' +
  '</div>';
}

function renderTlDiff(ed) {
  var oldLines = (ed.oldStr || '').split('\\n');
  var newLines = (ed.newStr || '').split('\\n');
  if (ed.tier === 4) {
    return '<div class="tl-diff"><span style="color:var(--dim)">full rewrite (' + newLines.length + ' lines)</span></div>';
  }
  var h = '<div class="tl-diff">';
  for (var i = 0; i < Math.min(oldLines.length, 20); i++) h += '<div style="color:var(--red)">- ' + tlEsc(oldLines[i]) + '</div>';
  for (var j = 0; j < Math.min(newLines.length, 20); j++) h += '<div style="color:var(--green)">+ ' + tlEsc(newLines[j]) + '</div>';
  if (oldLines.length > 20) h += '<div style="color:var(--dim)">... ' + (oldLines.length - 20) + ' more removed</div>';
  if (newLines.length > 20) h += '<div style="color:var(--dim)">... ' + (newLines.length - 20) + ' more added</div>';
  h += '</div>';
  return h;
}

function truncLines(text, max) {
  if (!text) return '';
  var lines = String(text).split('\\n');
  var shown = lines.slice(0, max);
  var rest = lines.length - max;
  var h = '<pre class="tl-pre">' + tlEsc(shown.join('\\n')) + '</pre>';
  if (rest > 0) h += '<div style="font-size:10px;color:var(--muted);margin-top:2px">... ' + rest + ' more lines</div>';
  return h;
}

function renderRichToolBody(d) {
  var n = String(d.name || '').toLowerCase();
  var isWebSearch = n === 'web_search' || n === 'websearch';
  var inp = d.toolInput || {};
  var res = d.toolResult || '';

  // ---- Web search: show query + result links ----
  if (isWebSearch && res) {
    var h = '';
    var query = inp.query || inp.search_query || inp.q || '';
    if (query) h += '<div style="font-size:11px;color:var(--text);margin-bottom:6px"><strong>Query:</strong> ' + tlEsc(String(query)) + '</div>';
    try {
      var parsed = typeof res === 'string' ? JSON.parse(res) : res;
      var results = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed && parsed.results)
          ? parsed.results
          : Array.isArray(parsed && parsed.items)
            ? parsed.items
            : [];
      if (Array.isArray(results) && results.length) {
        h += '<div class="tl-search-results">';
        for (var i = 0; i < Math.min(results.length, 8); i++) {
          var r = results[i];
          var title = r.title || r.name || '';
          var url = r.url || r.link || '';
          var snippet = r.snippet || r.description || '';
          var domain = '';
          try { domain = new URL(url).hostname; } catch(e){}
          h += '<div class="tl-search-item">';
          h += '<div style="display:flex;align-items:center;gap:6px">';
          if (domain) h += '<img src="https://www.google.com/s2/favicons?sz=16&domain=' + tlEsc(domain) + '" width="14" height="14" style="border-radius:2px;flex-shrink:0">';
          var safeUrl = /^https?:\/\//i.test(url) ? url : '#';
          h += '<a href="' + tlEsc(safeUrl) + '" target="_blank" rel="noopener" style="color:var(--accent);font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + tlEsc(title) + '</a>';
          h += '</div>';
          if (snippet) h += '<div style="font-size:10px;color:var(--muted);margin-top:2px;line-height:1.4">' + tlEsc(snippet.slice(0, 160)) + '</div>';
          if (domain) h += '<div style="font-size:9px;color:var(--dim);margin-top:1px">' + tlEsc(domain) + '</div>';
          h += '</div>';
        }
        if (results.length > 8) h += '<div style="font-size:10px;color:var(--muted);padding:4px 0">+ ' + (results.length - 8) + ' more results</div>';
        h += '</div>';
        return h;
      }
    } catch(e) {}
    // Fallback: show raw result truncated
    if (query) return h + truncLines(res, 15);
  }

  // ---- Bash: show command + output ----
  if (n === 'bash') {
    var bh = '';
    var cmd = inp.command || inp.cmd || d.detail || '';
    if (cmd) bh += '<div style="background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 10px;margin-bottom:6px;font-family:var(--mono);font-size:11px;color:var(--text);white-space:pre-wrap;word-break:break-all;max-height:60px;overflow:auto"><span style="color:var(--accent);user-select:none">$ </span>' + tlEsc(String(cmd)) + '</div>';
    if (res && res !== '{}' && res !== 'null') {
      bh += truncLines(res, 15);
    }
    return bh || '<div class="tl-detail" style="color:var(--muted);font-size:11px">' + tlEsc(d.detail) + '</div>';
  }

  // ---- Read file: show path + preview ----
  if (n === 'read_file') {
    var rh = '';
    var rp = inp.file_path ? tlShortPath(String(inp.file_path)) : d.fp ? tlShortPath(d.fp) : '';
    if (rp) rh += '<div style="font-size:11px;color:var(--accent);margin-bottom:4px;font-family:var(--mono)">' + tlEsc(rp) + '</div>';
    if (res && res.length > 0) {
      rh += truncLines(res, 20);
    }
    return rh || '<div class="tl-detail" style="color:var(--muted);font-size:11px">' + tlEsc(d.detail) + '</div>';
  }

  // ---- Grep: show pattern + matches ----
  if (n === 'grep') {
    var gh = '';
    if (inp.pattern) gh += '<div style="font-size:11px;margin-bottom:4px"><span style="color:var(--dim)">pattern:</span> <code style="color:var(--accent)">' + tlEsc(String(inp.pattern)) + '</code></div>';
    if (inp.path) gh += '<div style="font-size:10px;color:var(--muted);margin-bottom:4px">in ' + tlEsc(tlShortPath(String(inp.path))) + '</div>';
    if (res) gh += truncLines(res, 12);
    return gh || '<div class="tl-detail" style="color:var(--muted);font-size:11px">' + tlEsc(d.detail) + '</div>';
  }

  // ---- Glob: show pattern + file list ----
  if (n === 'glob') {
    var glh = '';
    if (inp.pattern) glh += '<div style="font-size:11px;margin-bottom:4px"><span style="color:var(--dim)">pattern:</span> <code style="color:var(--accent)">' + tlEsc(String(inp.pattern)) + '</code></div>';
    if (res) glh += truncLines(res, 15);
    return glh || '<div class="tl-detail" style="color:var(--muted);font-size:11px">' + tlEsc(d.detail) + '</div>';
  }

  // ---- Edit/write: show file path ----
  if (n === 'edit_file' || n === 'write_file') {
    var efp = inp.file_path ? tlShortPath(String(inp.file_path)) : d.fp ? tlShortPath(d.fp) : '';
    var eh = '';
    if (efp) eh += '<div style="font-size:11px;color:var(--accent);margin-bottom:4px;font-family:var(--mono)">' + tlEsc(efp) + '</div>';
    if (res && res !== '{}' && res !== 'OK') eh += '<div class="tl-detail" style="font-size:10px;color:var(--muted)">' + tlEsc(String(res).slice(0, 200)) + '</div>';
    return eh || '<div class="tl-detail" style="color:var(--muted);font-size:11px">' + tlEsc(d.detail) + '</div>';
  }

  // ---- Default: show input summary + result preview ----
  var dh = '<div class="tl-detail" style="padding:4px 0;color:var(--muted);font-size:11px">' + tlEsc(d.detail) + '</div>';
  if (res && res !== '{}' && res.length > 10) {
    dh += truncLines(res, 10);
  }
  return dh;
}

function renderTimelineEntry(entry, idx) {
  var d = entry.data;
  switch (entry.type) {
    case 'user_msg':
      return '<div class="tl-msg-row tl-msg-row-user"><div class="msg msg-user">' + renderMsgMetaRow('You', selectedRunId) + tlEsc(d.content) + '</div>' + tlAvatarUser() + '</div>';
    case 'asst_msg':
      return '<div class="tl-msg-row tl-msg-row-agent">' + tlAvatarAgent() + '<div class="msg msg-asst">' + renderMsgMetaRow('Shipyard', selectedRunId) + tlEsc(d.content) + '</div></div>';
    case 'thinking':
      if (!d.sealed) {
        // Active streaming: softer dashed-border block with live indicator
        return '<div class="tl-msg-row tl-msg-row-agent">' + tlAvatarAgent() +
          '<div class="msg msg-asst msg-think-active">' +
          '<div class="msg-meta" style="color:var(--purple)"><span class="ldot"></span> Thinking</div>' +
          '<pre id="liveThinkPre" style="white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit;font-size:inherit;max-height:400px;overflow-y:auto;color:var(--muted)">' + tlEsc(d.text) + '</pre></div></div>';
      }
      // Sealed: softer collapsible block
      var bodyHtml = '<pre class="tl-pre" style="color:var(--muted)">' + tlEsc(d.text) + '</pre>';
      return '<div class="tl-think-sealed">' + renderTlCollapsible(idx, 'Thought process', 'var(--purple-dim)', true, bodyHtml, null) + '</div>';
    case 'tool_call':
      var tcIcon = tlToolIcon(d.name);
      var tcLabel = tcIcon + tlEsc(d.name);
      if (d.fp) tcLabel += ' <span style="color:var(--muted);font-weight:400">&middot; ' + tlEsc(tlShortPath(d.fp)) + '</span>';
      var tcBody = renderRichToolBody(d);
      if (d.durMs) tcBody += '<div class="tl-detail" style="margin-top:4px;font-size:10px;color:var(--muted)">' + d.durMs + 'ms</div>';
      return renderTlCollapsible(idx, tcLabel, d.ok ? 'var(--green)' : 'var(--red)', true, tcBody, d.ok ? 'ok' : 'fail');
    case 'file_edit':
      var feLabel = 'Edited <span style="color:var(--accent)">' + tlEsc(tlShortPath(d.path)) + '</span>';
      if (d.tier) feLabel += ' <span style="color:var(--dim);font-size:10px">(tier ' + d.tier + ')</span>';
      return renderTlCollapsible(idx, feLabel, 'var(--accent)', true, renderTlDiff(d), null);
    case 'verification':
      var vTag = d.passed ? 'ok' : 'fail';
      var vLabel = 'Verification ' + (d.passed ? 'passed' : 'failed');
      if (typeof d.errCount === 'number' && d.errCount > 0) vLabel += ' (' + d.errCount + ' errors)';
      var vBody = '';
      if (d.tcOut) vBody += '<div class="tl-detail" style="margin-bottom:6px"><strong style="color:var(--dim)">Typecheck</strong><pre class="tl-pre">' + tlEsc(d.tcOut) + '</pre></div>';
      if (d.testOut) vBody += '<div class="tl-detail"><strong style="color:var(--dim)">Tests</strong><pre class="tl-pre">' + tlEsc(d.testOut) + '</pre></div>';
      if (!vBody) vBody = '<div class="tl-detail">No output captured</div>';
      return renderTlCollapsible(idx, vLabel, d.passed ? 'var(--green)' : 'var(--red)', true, vBody, vTag);
    case 'review':
      var rLabel = 'Review: ' + tlEsc(d.decision || 'done');
      var rBody = '<div class="tl-detail">' + tlEsc(d.feedback || 'No feedback') + '</div>';
      return renderTlCollapsible(idx, rLabel, 'var(--cyan)', true, rBody, null);
    case 'next_actions':
      var acts = Array.isArray(d.actions) ? d.actions : [];
      if (!acts.length) return '';
      var aBody = '<div class="tl-detail">';
      for (var ai = 0; ai < acts.length; ai++) {
        var a = acts[ai] || {};
        var badge = a.recommended ? ' <span class="tl-tag tl-tag-ok">recommended</span>' : '';
        aBody += '<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed var(--border)">' +
          '<div><strong>' + tlEsc(a.label || a.id || 'Action') + '</strong>' + badge + '</div>' +
          '<div style="color:var(--dim);margin-top:2px">' + tlEsc(a.description || '') + '</div>';
        if (a.prompt) {
          aBody += '<div style="margin-top:6px">' +
            '<button type="button" class="btn btn-g" data-action="applyNextAction" data-prompt="' + tlEsc(a.prompt) + '" style="font-size:10px;padding:4px 8px">Use Prompt</button>' +
            '</div>';
        }
        aBody += '</div>';
      }
      aBody += '</div>';
      return renderTlCollapsible(idx, 'Suggested next actions', 'var(--accent)', false, aBody, null);
    case 'phase':
      var phColor = 'var(--muted)';
      var ph = d.phase;
      if (ph === 'executing') phColor = 'var(--yellow)';
      else if (ph === 'planning') phColor = 'var(--accent)';
      else if (ph === 'verifying') phColor = 'var(--cyan)';
      else if (ph === 'reviewing') phColor = 'var(--cyan)';
      else if (ph === 'done') phColor = 'var(--green)';
      else if (ph === 'error') phColor = 'var(--red)';
      var phLabel = ph.charAt(0).toUpperCase() + ph.slice(1);
      return '<div class="tl-phase"><span class="tl-phase-dot" style="background:' + phColor + '"></span><span style="color:' + phColor + '">' + tlEsc(phLabel) + '</span></div>';
    default:
      return '';
  }
}

function isInternalEntry(entry) {
  return entry && (
    entry.type === 'thinking' ||
    entry.type === 'tool_call' ||
    entry.type === 'file_edit' ||
    entry.type === 'verification' ||
    entry.type === 'review' ||
    entry.type === 'phase' ||
    entry.type === 'next_actions'
  );
}

function phaseGoal(phase) {
  if (phase === 'planning') return 'I am mapping impacted files and planning safe execution order';
  if (phase === 'executing') return 'I am applying the planned edits and checking each change';
  if (phase === 'verifying') return 'I am validating changes with lint/type-check/tests before finalizing';
  if (phase === 'reviewing') return 'I am reviewing completeness and edge cases before completion';
  if (phase === 'done') return 'I am done. Final summary and next steps are ready';
  if (phase === 'error') return 'I hit an error and am preparing recovery guidance';
  return 'I am progressing through the task';
}

function collectPhaseNotes(entries, runPhase) {
  var notes = [];
  var current = null;

  function startPhase(phase) {
    current = {
      phase: phase || runPhase || 'executing',
      toolCalls: 0,
      touched: {},
      checks: {},
      inspect: {},
    };
  }

  function flushPhase() {
    if (!current) return;
    var parts = [phaseGoal(current.phase)];
    var inspect = Object.keys(current.inspect);
    var checks = Object.keys(current.checks);
    if (inspect.length) parts.push('Currently ' + inspect.slice(0, 2).join(' and '));
    if (checks.length) parts.push('Now ' + checks.slice(0, 2).join(' and '));
    var touched = Object.keys(current.touched);
    if (touched.length) {
      var show = touched.slice(0, 3);
      var suffix = touched.length > show.length ? ' +' + (touched.length - show.length) + ' more' : '';
      parts.push('Touched files: ' + show.join(', ') + suffix);
    }
    notes.push(parts.join(' · '));
    current = null;
  }

  startPhase(runPhase || 'executing');

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e) continue;
    if (e.type === 'phase' && e.data && e.data.phase) {
      var nextPhase = String(e.data.phase);
      if (!current || current.phase !== nextPhase) {
        flushPhase();
        startPhase(nextPhase);
      }
      continue;
    }
    if (!current) startPhase(runPhase || 'executing');

    if (e.type === 'tool_call') {
      current.toolCalls++;
      var name = String((e.data && e.data.name) || '');
      var detail = String((e.data && e.data.detail) || '').toLowerCase();
      if (name === 'grep' || detail.indexOf('grep ') >= 0 || detail.indexOf('rg ') >= 0) {
        current.inspect['searching for impacted code'] = true;
      } else if (name === 'read_file' || detail.indexOf('read') >= 0) {
        current.inspect['reading target files'] = true;
      }
      if (name === 'bash') {
        if (detail.indexOf('type-check') >= 0 || detail.indexOf('tsc') >= 0) current.checks['running type-check'] = true;
        if (detail.indexOf('pnpm test') >= 0 || detail.indexOf('vitest') >= 0) current.checks['running tests'] = true;
        if (detail.indexOf('lint') >= 0) current.checks['running lint checks'] = true;
        if (detail.indexOf('git diff') >= 0 || detail.indexOf('git status') >= 0) current.checks['reviewing diffs before finalizing'] = true;
        if (detail.indexOf('revert') >= 0 || detail.indexOf('checkout') >= 0 || detail.indexOf('restore') >= 0) {
          current.checks['double-checking rollback/revert safety'] = true;
        }
      }
    } else if (e.type === 'file_edit') {
      var p = tlShortPath(String((e.data && e.data.path) || ''));
      if (p) current.touched[p] = true;
    }
  }

  flushPhase();
  var out = [];
  for (var j = 0; j < notes.length; j++) {
    if (!notes[j]) continue;
    if (j > 0 && notes[j] === notes[j - 1]) continue;
    out.push(notes[j]);
  }
  return out.slice(-4);
}

function renderTerminalErrorBubble(errorText, runId) {
  if (!errorText) return '';
  return '<div class="tl-msg-row tl-msg-row-agent">' + tlAvatarAgent() +
    '<div class="msg msg-asst" role="alert" style="border-color:var(--danger-border-med);background:var(--danger-bg-med);color:var(--red-soft)">' +
    renderMsgMetaRow('Error', runId) + tlEsc(errorText) + '</div></div>';
}

function renderTimeline() {
  var el = document.getElementById('chatThread');
  if (!el) return;
  if (!selectedRunId) {
    el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--dim);font-size:12px;line-height:1.6">Select a chat or use <strong>+ New</strong>. Type below to start.</div>';
    syncComposerUi();
    return;
  }
  var r = runsMap[selectedRunId];
  if (!r) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted)">Loading\\u2026</div>';
    return;
  }

  var h = '';
  // Run header
  h += '<div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
  h += '<div style="font-size:14px;font-weight:600;color:var(--text-bright);flex:1;min-width:120px;line-height:1.3">' + tlEsc(humanTitle(r)) + '</div>';
  h += '<span class="pbadge ' + phCls(r.phase) + '">' + tlEsc(r.phase) + '</span>';
  if (r.threadKind === 'ask') h += '<span class="pp-thread-ask">ask</span>';
  h += '</div>';

  // Get or build timeline
  var tl = timelineMap[selectedRunId];
  if (!tl || !tl.length) {
    tl = buildTimeline(r);
    if (tl.length) timelineMap[selectedRunId] = tl;
  }

  // Render entries
  var entryCount = tl ? tl.length : 0;
  console.log('[TL] renderTimeline', selectedRunId && selectedRunId.slice(0,8), 'entries=' + entryCount, 'phase=' + r.phase);
  if (tl && tl.length) {
    var lastUserTs = null;
    var hasAssistantAfterLastUser = false;
    for (var lu = 0; lu < tl.length; lu++) {
      if (tl[lu] && tl[lu].type === 'user_msg') lastUserTs = tl[lu].ts;
    }
    if (lastUserTs != null) {
      for (var la = 0; la < tl.length; la++) {
        if (tl[la] && tl[la].type === 'asst_msg' && tl[la].ts > lastUserTs) {
          hasAssistantAfterLastUser = true;
          break;
        }
      }
    }

    var internalBatch = [];
    var batchCounter = 0;

    function flushInternalBatch() {
      if (!internalBatch.length) return;
      var notes = collectPhaseNotes(internalBatch, r.phase);
      for (var ni = 0; ni < notes.length; ni++) {
        h += '<div class="tl-msg-row tl-msg-row-agent">' + tlAvatarAgent() +
          '<div class="msg msg-asst" style="border-color:var(--border);background:var(--card2)">' +
          '<div class="msg-meta-row"><div style="display:flex;align-items:center;gap:8px"><div class="msg-meta">Agent progress</div>' + traceBtnHtml(r.runId) + '</div></div>' + tlEsc(notes[ni]) + '</div></div>';
      }

      var detailHtml = '';
      for (var ii = 0; ii < internalBatch.length; ii++) {
        detailHtml += renderTimelineEntry(internalBatch[ii], 20_000 + batchCounter * 1000 + ii);
      }
      h += renderTlCollapsible(
        'internal-' + batchCounter,
        'Activity details (' + internalBatch.length + ')',
        'var(--border)',
        true,
        detailHtml,
        null,
      );
      batchCounter += 1;
      internalBatch = [];
    }

    for (var i = 0; i < tl.length; i++) {
      var entry = tl[i];
      if (isInternalEntry(entry)) {
        // Keep progress/details tied to the latest user turn only.
        if (lastUserTs != null && entry.ts < lastUserTs) continue;
        internalBatch.push(entry);
        continue;
      }
      flushInternalBatch();
      h += renderTimelineEntry(entry, i);
    }
    flushInternalBatch();

    // Guarantee a visible assistant response slot per turn.
    if (lastUserTs != null && !hasAssistantAfterLastUser && !(r.phase === 'error' && r.error)) {
      var statusText = 'Working on this now.';
      if (r.phase === 'done') statusText = 'Done. Summary is being finalized.';
      h += '<div class="tl-msg-row tl-msg-row-agent">' + tlAvatarAgent() + '<div class="msg msg-asst">' + renderMsgMetaRow('Shipyard', r.runId) + tlEsc(statusText) + '</div></div>';
    }
  }

  // Live thinking indicator (only when no active thinking block is already showing)
  var isActive = selectedRunId && lastState.runId === selectedRunId;
  var hasLiveThinking = tl && tl.length && tl[tl.length - 1].type === 'thinking' && !tl[tl.length - 1].data.sealed;
  if (isActive && !hasLiveThinking) {
    var ph = lastState.phase;
    if (ph === 'awaiting_confirmation' && curRunId) {
      h += '<div style="margin-top:8px"><button class="btn btn-p" data-action="confirmPlan" data-rid="' + tlEsc(curRunId) + '">\\u2713 Confirm Plan</button></div>';
    }
  }

  if (r.error) {
    h += renderTerminalErrorBubble(r.error, r.runId);
  }

  // Empty state
  if ((!tl || !tl.length) && !r.error) {
    if (!isActive) {
      h += renderEmptyState('No activity yet');
    }
  }

  el.innerHTML = h;
  el.scrollTop = el.scrollHeight;
  syncComposerUi();
}

// ---- WS event handlers (timeline-aware) ----
function sealLastThinking(runId) {
  var tl = timelineMap[runId];
  if (!tl) return;
  for (var i = tl.length - 1; i >= 0; i--) {
    if (tl[i].type === 'thinking' && !tl[i].data.sealed) {
      console.log('[TL] sealThinking', runId && runId.slice(0,8), 'idx=' + i);
      tl[i].data.sealed = true;
      break;
    }
  }
}

function onTextChunk(data) {
  if (!curRunId) { console.log('[TL] onTextChunk: no curRunId, ignoring'); return; }
  if (!data || shouldSuppressThinkingChunk(data.text)) return;
  var rid = curRunId;
  if (!timelineMap[rid]) timelineMap[rid] = [];
  var tl = timelineMap[rid];
  // Find last unsealed thinking entry
  var last = null;
  for (var i = tl.length - 1; i >= 0; i--) {
    if (tl[i].type === 'thinking' && !tl[i].data.sealed) { last = tl[i]; break; }
  }
  if (!last) {
    last = mkThinking(Date.now(), '');
    tl.push(last);
    console.log('[TL] onTextChunk: new thinking entry at idx=' + (tl.length - 1));
  }
  last.data.text += data.text + '\\n';
  if (selectedRunId === rid) {
    // Try incremental update first (use fixed id for live thinking pre)
    var preEl = document.getElementById('liveThinkPre');
    if (preEl) {
      preEl.textContent = last.data.text;
      var thread = document.getElementById('chatThread');
      if (thread) thread.scrollTop = thread.scrollHeight;
    } else {
      console.log('[TL] onTextChunk: no liveThinkPre found, full render');
      renderTimeline();
    }
  }
}

function onFeedEvent(ev) {
  if (!curRunId) return;
  var rid = curRunId;
  console.log('[TL] onFeedEvent', ev.type, rid && rid.slice(0,8));
  if (!timelineMap[rid]) timelineMap[rid] = [];
  sealLastThinking(rid);
  if (ev.type === 'file_edit') {
    var e = ev.data;
    timelineMap[rid].push(mkFileEdit(Date.now(), e.file_path, e.tier, e.old_string, e.new_string));
  } else if (ev.type === 'tool_activity') {
    var a = ev.data;
    timelineMap[rid].push(mkToolCall(Date.now(), a.tool_name, a.ok, a.file_path || '', a.detail || '', a.duration_ms, a.tool_input || null, a.tool_result || null));
  }
  if (selectedRunId === rid) renderTimeline();
}

function pushPhaseEntry(runId, phase) {
  if (!timelineMap[runId]) timelineMap[runId] = [];
  if (lastPhaseForRun[runId] === phase) return;
  console.log('[TL] pushPhase', runId && runId.slice(0,8), phase);
  lastPhaseForRun[runId] = phase;
  sealLastThinking(runId);
  timelineMap[runId].push(mkPhase(Date.now(), phase));
}

function pushVerificationEntry(runId, vr) {
  if (verResultSeen[runId]) return;
  verResultSeen[runId] = true;
  console.log('[TL] pushVerification', runId && runId.slice(0,8), 'passed=' + vr.passed);
  if (!timelineMap[runId]) timelineMap[runId] = [];
  sealLastThinking(runId);
  timelineMap[runId].push(mkVerification(Date.now(), vr.passed, vr.errorCount, vr.typecheckOutput, vr.testOutput));
}

function pushReviewEntry(runId, rf) {
  if (reviewSeen[runId]) return;
  reviewSeen[runId] = true;
  console.log('[TL] pushReview', runId && runId.slice(0,8), rf.decision);
  if (!timelineMap[runId]) timelineMap[runId] = [];
  sealLastThinking(runId);
  timelineMap[runId].push(mkReview(Date.now(), rf.decision, rf.feedback));
}
`;
}
