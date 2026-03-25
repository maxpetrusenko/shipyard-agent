/**
 * Timeline data model + renderers for the unified dashboard feed.
 * Returns vanilla JS as a string for injection into the dashboard <script> block.
 */

export function getTimelineScript(): string {
  return `
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
function mkToolCall(ts, name, ok, fp, detail, durMs) { return mkEntry('tool_call', ts, { name: name, ok: ok, fp: fp, detail: detail, durMs: durMs }); }
function mkFileEdit(ts, path, tier, oldStr, newStr) { return mkEntry('file_edit', ts, { path: path, tier: tier, oldStr: oldStr, newStr: newStr }); }
function mkVerification(ts, passed, errCount, tcOut, testOut) { return mkEntry('verification', ts, { passed: passed, errCount: errCount, tcOut: tcOut, testOut: testOut }); }
function mkReview(ts, decision, feedback) { return mkEntry('review', ts, { decision: decision, feedback: feedback }); }
function mkPhase(ts, phase) { return mkEntry('phase', ts, { phase: phase }); }
function isTimelineMessage(entry) { return entry && (entry.type === 'user_msg' || entry.type === 'asst_msg'); }
function normalizeRunMessages(messages) {
  var out = [];
  var list = Array.isArray(messages) ? messages : [];
  for (var i = 0; i < list.length; i++) {
    var msg = list[i];
    if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue;
    out.push({ role: msg.role, content: msg.content || '' });
  }
  return out;
}
function messageEntryFromRunMessage(msg, ts) {
  return msg.role === 'user' ? mkUserMsg(ts, msg.content) : mkAsstMsg(ts, msg.content);
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
    entries.push(mkToolCall(tsT, tc.tool_name, ok, fp, detail, tc.duration_ms));
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
    entries.push(mkVerification(base + dur - 2000, vr.passed, vr.errorCount, vr.typecheckOutput, vr.testOutput));
  }

  // Review
  var rf = r.reviewFeedback;
  if (rf) {
    entries.push(mkReview(base + dur - 1000, rf.decision, rf.feedback));
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
function traceBtnHtml(_traceUrl, runId) {
  return '<button type="button" class="trace-btn" data-action="openDebug" data-rid="' + tlEsc(runId || '') + '" aria-label="Open debug" title="Open debug">i</button>';
}

function renderTlCollapsible(idx, label, accentColor, startCollapsed, bodyHtml, tag) {
  var cls = startCollapsed ? ' collapsed' : '';
  var tagHtml = '';
  if (tag) {
    var tagCls = tag === 'ok' ? 'tl-tag tl-tag-ok' : (tag === 'fail' ? 'tl-tag tl-tag-fail' : 'tl-tag');
    tagHtml = '<span class="' + tagCls + '">' + tlEsc(tag) + '</span>';
  }
  return '<div class="tl-row' + cls + '" id="tl-' + idx + '">' +
    '<div class="tl-hdr" data-action="toggleTl" data-idx="' + idx + '" style="border-left-color:' + (accentColor || 'var(--dim)') + '">' +
      '<span class="tl-chev">&#9654;</span>' +
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

function renderTimelineEntry(entry, idx) {
  var d = entry.data;
  var currentRun = selectedRunId ? runsMap[selectedRunId] : null;
  var traceBtn = traceBtnHtml(currentRun && currentRun.traceUrl, currentRun && currentRun.runId);
  switch (entry.type) {
    case 'user_msg':
      return '<div class="msg msg-user"><div class="msg-meta-row"><div class="msg-meta">You</div>' + traceBtn + '</div>' + tlEsc(d.content) + '</div>';
    case 'asst_msg':
      return '<div class="msg msg-asst"><div class="msg-meta">Shipyard</div>' + tlEsc(d.content) + '</div>';
    case 'thinking':
      if (!d.sealed) {
        // Active streaming: render as a visible dashed-border block with live indicator
        return '<div class="msg msg-asst" style="border-color:var(--purple);border-style:dashed">' +
          '<div class="msg-meta" style="color:var(--purple)"><span class="ldot"></span> Thinking</div>' +
          '<pre id="liveThinkPre" style="white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit;font-size:inherit;max-height:400px;overflow-y:auto">' + tlEsc(d.text) + '</pre></div>';
      }
      // Sealed: collapsible block
      var bodyHtml = '<pre class="tl-pre">' + tlEsc(d.text) + '</pre>';
      return renderTlCollapsible(idx, 'Thought process', 'var(--purple)', true, bodyHtml, null);
    case 'tool_call':
      var tcLabel = tlEsc(d.name);
      if (d.fp) tcLabel += ' <span style="color:var(--dim)">&middot; ' + tlEsc(tlShortPath(d.fp)) + '</span>';
      var tcBody = '<div class="tl-detail">' + tlEsc(d.detail) + '</div>';
      if (d.durMs) tcBody += '<div class="tl-detail" style="margin-top:4px">' + d.durMs + 'ms</div>';
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
    case 'phase':
      var phColor = 'var(--dim)';
      var ph = d.phase;
      if (ph === 'executing') phColor = 'var(--yellow)';
      else if (ph === 'planning') phColor = 'var(--accent)';
      else if (ph === 'verifying') phColor = 'var(--cyan)';
      else if (ph === 'reviewing') phColor = 'var(--cyan)';
      else if (ph === 'done') phColor = 'var(--green)';
      else if (ph === 'error') phColor = 'var(--red)';
      return '<div class="tl-phase"><span class="tl-phase-dot" style="background:' + phColor + '"></span>' + tlEsc(ph) + '</div>';
    default:
      return '';
  }
}

function runDeleteBlocked(r) {
  if (!r || !curRunId || r.runId !== curRunId) return false;
  var ph = lastState.phase;
  return !!(ph && ['done', 'error', 'idle'].indexOf(ph) < 0);
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
  var deleteBlocked = runDeleteBlocked(r);
  h += '<div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
  h += '<div style="font-size:14px;font-weight:600;color:var(--text-bright);flex:1;min-width:120px;line-height:1.3;cursor:pointer" data-action="renameChat" data-rid="' + tlEsc(r.runId) + '" title="Click to rename">' + tlEsc(humanTitle(r)) + '</div>';
  h += '<div style="display:flex;align-items:center;gap:6px">';
  h += '<button type="button" class="chat-act" data-action="openDebug" data-chat-header-action="debug" data-rid="' + tlEsc(r.runId) + '">Debug</button>';
  h += '<button type="button" class="chat-act" data-action="renameChat" data-chat-header-action="rename" data-rid="' + tlEsc(r.runId) + '">Rename</button>';
  h += '<button type="button" class="chat-act chat-act-del" data-action="deleteChat" data-chat-header-action="delete" data-rid="' + tlEsc(r.runId) + '"' + (deleteBlocked ? ' disabled title="Stop run before deleting"' : '') + '>Delete</button>';
  h += '</div>';
  h += '<span class="pbadge ' + phCls(r.phase) + '">' + tlEsc(r.phase) + '</span>';
  if (r.threadKind === 'ask') h += '<span class="pp-thread-ask">ask</span>';
  h += '</div>';

  // Error box
  if (r.error) {
    h += '<div class="run-phase-error" role="alert" style="margin-bottom:12px"><strong>Error</strong><br>' + tlEsc(r.error) + '</div>';
  }

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
    for (var i = 0; i < tl.length; i++) {
      h += renderTimelineEntry(tl[i], i);
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

  // Empty state
  if (!tl || !tl.length) {
    if (!isActive) {
      h += '<div style="padding:16px;text-align:center;color:var(--muted);font-size:11px">No activity yet</div>';
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
    timelineMap[rid].push(mkToolCall(Date.now(), a.tool_name, a.ok, a.file_path || '', a.detail || '', a.duration_ms));
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
