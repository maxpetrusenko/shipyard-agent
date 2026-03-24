/**
 * Settings page: model family + per-stage overrides (stored in localStorage; sent with each run).
 */

import type { Request, Response } from 'express';
import { MODEL_CATALOG } from '../config/model-policy.js';
import { NAV_STYLES, topNav } from './html-shared.js';

const ROLES: { key: string; label: string }[] = [
  { key: 'planning', label: 'Planning' },
  { key: 'coding', label: 'Execution (coding)' },
  { key: 'review', label: 'Review' },
  { key: 'summary', label: 'Summary / report' },
  { key: 'chat', label: 'Chat (Ask mode)' },
];

function optionRows(): string {
  const opts = MODEL_CATALOG.map(
    (m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`,
  ).join('');
  return ROLES.map(
    (r) => `
    <label class="set-row">
      <span>${escapeHtml(r.label)}</span>
      <select data-role="${escapeHtml(r.key)}" class="stageSel">
        <option value="">(use family default)</option>
        ${opts}
      </select>
    </label>`,
  ).join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

export function settingsHandler() {
  return (_req: Request, res: Response) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shipyard Settings</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#060a12;--card:#111827;--border:#2a3250;--text:#e2e8f0;--dim:#6b7a90;--accent:#818cf8;--accent-glow:rgba(129,140,248,.12);--mono:'JetBrains Mono',monospace;--sans:'Space Grotesk',sans-serif;--radius:8px;--radius-lg:14px;--shadow:0 4px 20px rgba(0,0,0,.4);--transition:.15s ease}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:var(--mono);font-size:13px;min-height:100vh;padding:28px 20px}
.wrap{max-width:720px;margin:0 auto}
.hdr{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--border)}
h1{font-family:var(--sans);font-size:22px;font-weight:700}
h1 span{color:var(--accent)}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px 20px;box-shadow:var(--shadow);margin-bottom:16px}
.lbl{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--dim);margin-bottom:10px}
.set-row{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
.set-row span{font-size:11px;color:var(--dim)}
.set-row select{background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:6px 10px;font-size:11px;font-family:var(--mono);max-width:100%}
.family-row{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:16px;font-size:12px}
.family-row label{cursor:pointer;display:flex;align-items:center;gap:6px;color:var(--text)}
.hint{font-size:11px;color:var(--dim);line-height:1.6;margin-top:8px}
.btn{background:var(--accent);color:#fff;border:none;border-radius:var(--radius);padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--mono)}
.btn:hover{opacity:.9}
#saveSt{font-size:11px;color:var(--dim);margin-top:10px}
${NAV_STYLES}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1><span>Shipyard</span> Agent</h1>
    ${topNav('settings')}
  </div>
  <div class="card">
    <div class="lbl">Model family defaults</div>
    <p class="hint">Anthropic: Sonnet for most stages, Haiku for execution. OpenAI: GPT-5.3 Codex for planning and review-quality paths, GPT-5 Mini for execution and lighter stages. Per-stage env vars (SHIPYARD_*_MODEL) override these.</p>
    <div class="family-row">
      <label><input type="radio" name="fam" value="anthropic" checked> Anthropic</label>
      <label><input type="radio" name="fam" value="openai"> OpenAI</label>
    </div>
  </div>
  <div class="card">
    <div class="lbl">Per-stage overrides</div>
    <p class="hint">Optional. Leave default to use the family preset for that stage.</p>
    ${optionRows()}
    <button type="button" class="btn" id="saveBtn">Save</button>
    <div id="saveSt"></div>
  </div>
  <p class="hint">Preferences are stored in this browser (localStorage) and sent with each run from the Chat page.</p>
</div>
<script>
var STORAGE_KEY = 'shipyard_model_prefs';
function load() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { family: 'anthropic', models: {} };
    return JSON.parse(raw);
  } catch (e) {
    return { family: 'anthropic', models: {} };
  }
}
function save(p) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}
function apply() {
  var p = load();
  var fam = p.family === 'openai' ? 'openai' : 'anthropic';
  document.querySelectorAll('input[name="fam"]').forEach(function (el) {
    el.checked = el.value === fam;
  });
  var models = p.models || {};
  document.querySelectorAll('.stageSel').forEach(function (sel) {
    var k = sel.getAttribute('data-role');
    sel.value = models[k] || '';
  });
}
document.getElementById('saveBtn').addEventListener('click', function () {
  var fam = 'anthropic';
  document.querySelectorAll('input[name="fam"]').forEach(function (el) {
    if (el.checked) fam = el.value;
  });
  var models = {};
  document.querySelectorAll('.stageSel').forEach(function (sel) {
    var k = sel.getAttribute('data-role');
    if (sel.value) models[k] = sel.value;
  });
  save({ family: fam, models: models });
  document.getElementById('saveSt').textContent = 'Saved.';
  setTimeout(function () { document.getElementById('saveSt').textContent = ''; }, 2000);
});
apply();
</script>
</body>
</html>`;
    res.type('html').send(html);
  };
}
