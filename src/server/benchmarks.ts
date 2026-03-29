/**
 * Benchmarks comparison page served at GET /benchmarks.
 *
 * Self-contained HTML with Chart.js (CDN) for radar + line charts.
 * Light theme aligned with dashboard surfaces.
 */

import type { Request, Response } from 'express';
import { WORK_DIR } from '../config/work-dir.js';
import {
  NAV_STYLES,
  SHIPYARD_BASE_STYLES,
  SHIPYARD_THEME_VARS,
  topNav,
} from './html-shared.js';

function escAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderPageHtml(defaultSnapshotDir: string): string {
  return PAGE_HTML.replace('__DEFAULT_SNAPSHOT_DIR__', escAttr(defaultSnapshotDir));
}

export function benchmarksHandler() {
  return (_req: Request, res: Response) => {
    res.type('html').send(renderPageHtml(WORK_DIR || process.cwd()));
  };
}

// ---------------------------------------------------------------------------
// Full page HTML
// ---------------------------------------------------------------------------

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shipyard Benchmarks</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
${SHIPYARD_THEME_VARS}
${SHIPYARD_BASE_STYLES}
body{font-size:14px;min-height:100vh}

.wrap{max-width:1200px;margin:0 auto;padding:28px 20px}
.hdr{display:flex;align-items:center;gap:14px;margin-bottom:24px;flex-wrap:wrap;padding-bottom:16px;border-bottom:1px solid var(--border);position:relative}
.hdr::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--accent-dim),transparent)}
h1{font-family:var(--sans);font-size:24px;font-weight:700;letter-spacing:-.03em}
h1 span{color:var(--accent)}

.top-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:820px){.top-row{grid-template-columns:1fr}}

.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px 22px;box-shadow:var(--shadow)}
.card-title{font-size:11px;text-transform:uppercase;letter-spacing:1.6px;color:var(--dim);margin-bottom:14px;font-family:var(--mono)}

.chip-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.chip{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:7px 14px;font-size:12px;color:var(--dim);box-shadow:var(--shadow)}
.chip b{color:var(--text-bright);font-weight:600}
.chip.ok b{color:var(--green)}
.chip.warn b{color:var(--yellow)}
.chip.bad b{color:var(--red)}

.filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.filter-btn{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:7px 14px;font-size:12px;color:var(--dim);cursor:pointer;user-select:none;display:flex;align-items:center;gap:7px;transition:all var(--transition);font-family:var(--mono)}
.filter-btn:hover{border-color:var(--border-bright);color:var(--text)}
.filter-btn.active{border-color:var(--accent);color:var(--text-bright);background:var(--accent-glow);box-shadow:0 0 12px var(--accent-glow)}
.filter-btn .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;box-shadow:0 0 6px currentColor}

.chart-wrap{position:relative;width:100%;max-height:420px}
.chart-wrap canvas{width:100%!important}

.snapshot-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}
.snapshot-form input{background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:8px 12px;font-size:12px;font-family:var(--mono);transition:border-color var(--transition)}
.snapshot-form input:focus{border-color:var(--accent);outline:none;box-shadow:0 0 0 2px var(--accent-glow)}
.snapshot-form button{background:var(--accent);color:var(--text-inverse);border:none;border-radius:var(--radius);padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--mono);transition:all var(--transition);box-shadow:var(--btn-accent-shadow)}
.snapshot-form button:hover{opacity:.88;transform:translateY(-1px)}
.snapshot-form button:active{transform:translateY(0)}
.snapshot-form button:disabled{opacity:.4;cursor:not-allowed;transform:none}
.snapshot-status{font-size:12px;color:var(--dim);margin-top:8px}

.empty-msg{text-align:center;padding:48px 24px;color:var(--dim);font-size:13px;line-height:1.9}
.empty-msg code{background:var(--card2);padding:2px 8px;border-radius:4px;font-size:12px}
${NAV_STYLES}
</style>
</head>
<body>
<div class="wrap">

  <div class="hdr">
    <h1>Shipyard <span>Benchmarks</span></h1>
    ${topNav('benchmarks')}
  </div>

  <div id="chips" class="chip-row"></div>

  <div class="filters" id="filters"></div>

  <div class="top-row">
    <div class="card">
      <div class="card-title">Multi-criteria comparison</div>
      <div class="chart-wrap">
        <canvas id="radarChart"></canvas>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Trend over runs</div>
      <div class="chart-wrap">
        <canvas id="lineChart"></canvas>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="card-title">Capture Snapshot</div>
    <div style="font-size:11px;color:var(--dim);margin-bottom:10px">
      Run typecheck, tests, security audit, and LOC count on a target directory. Results are stored for comparison.
    </div>
    <div class="snapshot-form">
      <input id="snapDir" placeholder="Target directory (absolute path)" style="width:320px" value="__DEFAULT_SNAPSHOT_DIR__">
      <input id="snapLabel" placeholder="Label (e.g. original, refactored)" style="width:160px">
      <button id="snapBtn" onclick="captureSnapshot()">Capture Snapshot</button>
    </div>
    <div id="snapStatus" class="snapshot-status"></div>
  </div>

</div>

<script>
function cssVar(name, fallback) {
  var value = getComputedStyle(document.documentElement).getPropertyValue(name);
  var trimmed = value ? value.trim() : '';
  return trimmed || fallback || '';
}

function hexToRgba(hex, alpha) {
  if (!hex || hex.charAt(0) !== '#') return hex;
  var raw = hex.slice(1);
  if (raw.length === 3) raw = raw.split('').map(function(ch) { return ch + ch; }).join('');
  if (raw.length !== 6) return hex;
  var r = parseInt(raw.slice(0, 2), 16);
  var g = parseInt(raw.slice(2, 4), 16);
  var b = parseInt(raw.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

var CRITERIA = [
  { key: 'typeSafety', label: 'Type Safety', colorVar: '--bench-type-safety' },
  { key: 'testHealth', label: 'Test Health', colorVar: '--bench-test-health' },
  { key: 'security', label: 'Security', colorVar: '--bench-security' },
  { key: 'runSpeed', label: 'Run Speed', colorVar: '--bench-run-speed' },
  { key: 'buildSpeed', label: 'Build Speed', colorVar: '--bench-build-speed' },
  { key: 'tokenEfficiency', label: 'Token Efficiency', colorVar: '--bench-token-efficiency' },
  { key: 'editQuality', label: 'Edit Quality', colorVar: '--bench-edit-quality' },
  { key: 'codeVolume', label: 'Code Volume', colorVar: '--bench-code-volume' }
];

function criterionColor(criterion) {
  return cssVar(criterion.colorVar, cssVar('--accent'));
}

var activeCriteria = {};
CRITERIA.forEach(function(c) { activeCriteria[c.key] = true; });

var radarChart = null;
var lineChart = null;
var benchData = null;

function initFilters() {
  var container = document.getElementById('filters');
  var html = '';
  CRITERIA.forEach(function(c) {
    var color = criterionColor(c);
    html += '<div class="filter-btn active" data-key="' + c.key + '" onclick="toggleCriterion(this)" tabindex="0" role="checkbox" aria-checked="true" aria-label="Toggle ' + c.label + '">';
    html += '<span class="dot" style="background:' + color + '"></span>';
    html += c.label;
    html += '</div>';
  });
  container.innerHTML = html;
}

function toggleCriterion(el) {
  var key = el.getAttribute('data-key');
  activeCriteria[key] = !activeCriteria[key];
  el.classList.toggle('active');
  el.setAttribute('aria-checked', activeCriteria[key] ? 'true' : 'false');
  updateCharts();
}

function getScore(scores, key) {
  for (var i = 0; i < scores.length; i++) {
    if (scores[i].key === key) return scores[i].score;
  }
  return 0;
}

function getRaw(scores, key) {
  for (var i = 0; i < scores.length; i++) {
    if (scores[i].key === key) return scores[i].raw;
  }
  return '';
}

function getActiveKeys() {
  var keys = [];
  CRITERIA.forEach(function(c) { if (activeCriteria[c.key]) keys.push(c.key); });
  return keys;
}

function getActiveLabels() {
  var labels = [];
  CRITERIA.forEach(function(c) { if (activeCriteria[c.key]) labels.push(c.label); });
  return labels;
}

function buildRadarDatasets(data, activeKeys) {
  var datasets = [];

  if (data.baseline) {
    var baselineColor = cssVar('--red');
    datasets.push({
      label: data.baseline.label,
      data: activeKeys.map(function(k) { return getScore(data.baseline.scores, k); }),
      borderColor: baselineColor,
      backgroundColor: hexToRgba(baselineColor, 0.08),
      borderWidth: 2.4,
      pointRadius: 4.5,
      pointBackgroundColor: baselineColor
    });
  }

  if (data.snapshots.length > 0) {
    var latest = data.snapshots[data.snapshots.length - 1];
    var snapshotColor = cssVar('--green');
    datasets.push({
      label: latest.label + ' (snapshot)',
      data: activeKeys.map(function(k) { return getScore(latest.scores, k); }),
      borderColor: snapshotColor,
      backgroundColor: hexToRgba(snapshotColor, 0.12),
      borderWidth: 2.4,
      pointRadius: 4.5,
      pointBackgroundColor: snapshotColor
    });
  }

  if (data.runs.length > 0) {
    var lastRun = data.runs[data.runs.length - 1];
    var runColor = cssVar('--bench-type-safety');
    datasets.push({
      label: 'Latest Run',
      data: activeKeys.map(function(k) { return getScore(lastRun.scores, k); }),
      borderColor: runColor,
      backgroundColor: hexToRgba(runColor, 0.1),
      borderWidth: 2.4,
      pointRadius: 4.5,
      pointBackgroundColor: runColor
    });
  }

  return datasets;
}

function buildLineDatasets(data, activeKeys) {
  if (data.runs.length === 0) return { labels: [], datasets: [] };

  function formatTexasLabel(value) {
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(new Date(value));
      var map = {};
      parts.forEach(function(part) { map[part.type] = part.value; });
      var hour = map.hour === '24' ? '00' : (map.hour || '00');
      return (map.month || '0') + '/' + (map.day || '0') + ' ' + hour + ':' + (map.minute || '00') + ' CT';
    } catch (e) {
      return value || '';
    }
  }

  var labels = data.runs.map(function(r, i) {
    if (r.savedAt) {
      return formatTexasLabel(r.savedAt);
    }
    return 'Run ' + (i + 1);
  });

  var datasets = [];
  activeKeys.forEach(function(key) {
    var crit = null;
    for (var i = 0; i < CRITERIA.length; i++) {
      if (CRITERIA[i].key === key) { crit = CRITERIA[i]; break; }
    }
    if (!crit) return;
    var color = criterionColor(crit);

    datasets.push({
      label: crit.label,
      data: data.runs.map(function(r) { return getScore(r.scores, key); }),
      borderColor: color,
      backgroundColor: hexToRgba(color, 0.1),
      borderWidth: 2.4,
      pointRadius: 4,
      pointBackgroundColor: color,
      tension: 0.34,
      fill: false
    });
  });

  return { labels: labels, datasets: datasets };
}

function updateCharts() {
  if (!benchData) return;
  var activeKeys = getActiveKeys();
  var activeLabels = getActiveLabels();

  if (radarChart) {
    radarChart.data.labels = activeLabels;
    radarChart.data.datasets = buildRadarDatasets(benchData, activeKeys);
    radarChart.update();
  }

  if (lineChart) {
    var lineData = buildLineDatasets(benchData, activeKeys);
    lineChart.data.labels = lineData.labels;
    lineChart.data.datasets = lineData.datasets;
    lineChart.update();
  }
}

function renderChips(data) {
  var el = document.getElementById('chips');
  var parts = [];

  if (data.baseline) {
    var bts = getRaw(data.baseline.scores, 'testHealth');
    parts.push('<span class="chip ok"><b>' + bts + '</b> baseline tests</span>');
  }

  if (data.snapshots.length > 0) {
    var snap = data.snapshots[data.snapshots.length - 1];
    var tc = getRaw(snap.scores, 'typeSafety');
    var th = getRaw(snap.scores, 'testHealth');
    var sec = getRaw(snap.scores, 'security');
    var cls = tc.indexOf('pass') >= 0 ? 'ok' : 'bad';
    parts.push('<span class="chip ' + cls + '"><b>' + snap.label + '</b> typecheck: ' + tc + '</span>');
    parts.push('<span class="chip"><b>' + th + '</b> tests</span>');
    if (sec !== '0 vulnerabilities') {
      parts.push('<span class="chip warn"><b>' + sec + '</b></span>');
    } else {
      parts.push('<span class="chip ok"><b>0</b> vulns</span>');
    }
  }

  parts.push('<span class="chip"><b>' + data.runs.length + '</b> runs tracked</span>');
  el.innerHTML = parts.join('');
}

function initCharts(data) {
  benchData = data;
  var activeKeys = getActiveKeys();
  var activeLabels = getActiveLabels();
  var textColor = cssVar('--text');
  var dimColor = cssVar('--dim');
  var borderColor = cssVar('--border');
  var sans = cssVar('--sans');
  var mono = cssVar('--mono');

  var radarCtx = document.getElementById('radarChart').getContext('2d');
  radarChart = new Chart(radarCtx, {
    type: 'radar',
    data: {
      labels: activeLabels,
      datasets: buildRadarDatasets(data, activeKeys)
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: textColor, font: { family: sans, size: 12, weight: '600' }, padding: 16 } }
      },
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: { stepSize: 20, color: dimColor, backdropColor: 'transparent', font: { size: 10, family: mono } },
          grid: { color: borderColor },
          angleLines: { color: borderColor },
          pointLabels: { color: textColor, font: { family: sans, size: 12, weight: '600' } }
        }
      }
    }
  });

  var lineData = buildLineDatasets(data, activeKeys);
  var lineCtx = document.getElementById('lineChart').getContext('2d');
  lineChart = new Chart(lineCtx, {
    type: 'line',
    data: {
      labels: lineData.labels,
      datasets: lineData.datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: textColor, font: { family: sans, size: 12, weight: '600' }, padding: 16 } }
      },
      scales: {
        x: { ticks: { color: dimColor, font: { size: 10, family: mono }, maxRotation: 45 }, grid: { color: borderColor } },
        y: { min: 0, max: 100, ticks: { stepSize: 20, color: dimColor, font: { size: 10, family: mono } }, grid: { color: borderColor } }
      },
      interaction: { mode: 'index', intersect: false }
    }
  });

  renderChips(data);
}

function showEmpty() {
  document.getElementById('radarChart').parentElement.innerHTML = '<div class="empty-msg">No benchmark data yet.<br>Run <code>./scripts/snapshot.sh /path/to/repo label</code> or use the capture form below to seed comparison data.</div>';
  document.getElementById('lineChart').parentElement.innerHTML = '<div class="empty-msg">Run the agent with <code>pnpm bench 01-strict-typescript</code> to generate trend data.</div>';
}

function captureSnapshot() {
  var dir = document.getElementById('snapDir').value.trim();
  var label = document.getElementById('snapLabel').value.trim();
  var btn = document.getElementById('snapBtn');
  var status = document.getElementById('snapStatus');
  if (!dir || !label) { status.textContent = 'Both directory and label are required.'; return; }
  btn.disabled = true;
  btn.textContent = 'Capturing...';
  status.textContent = 'Running typecheck, tests, audit, LOC count... this may take a minute.';
  fetch('/api/benchmarks/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetDir: dir, label: label })
  })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) { status.textContent = 'Error: ' + d.error; }
      else {
        status.textContent = 'Snapshot captured: ' + d.label + ' (' + d.tests.passed + '/' + d.tests.total + ' tests, ' + d.loc + ' LOC)';
        loadData();
      }
    })
    .catch(function(e) { status.textContent = 'Error: ' + e.message; })
    .finally(function() { btn.disabled = false; btn.textContent = 'Capture Snapshot'; });
}

function loadData() {
  fetch('/api/benchmarks')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var hasData = data.baseline || data.snapshots.length > 0 || data.runs.length > 0;
      if (!hasData) { showEmpty(); renderChips(data); return; }
      if (radarChart) { radarChart.destroy(); radarChart = null; }
      if (lineChart) { lineChart.destroy(); lineChart = null; }
      var rc = document.getElementById('radarChart');
      if (!rc || rc.tagName !== 'CANVAS') {
        rc.parentElement.innerHTML = '<canvas id="radarChart"></canvas>';
      }
      var lc = document.getElementById('lineChart');
      if (!lc || lc.tagName !== 'CANVAS') {
        lc.parentElement.innerHTML = '<canvas id="lineChart"></canvas>';
      }
      initCharts(data);
    })
    .catch(function(e) { console.error('Failed to load benchmark data:', e); showEmpty(); });
}

initFilters();
loadData();
</script>
</body>
</html>`;
