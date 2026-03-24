/**
 * Benchmarks comparison page served at GET /benchmarks.
 *
 * Self-contained HTML with Chart.js (CDN) for radar + line charts.
 * Dark theme matches the main dashboard.
 */

import type { Request, Response } from 'express';
import { NAV_STYLES, topNav } from './html-shared.js';

export function benchmarksHandler() {
  return (_req: Request, res: Response) => {
    res.type('html').send(PAGE_HTML);
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
:root{--bg:#060a12;--bg2:#0a0e17;--card:#111827;--card2:#1a2035;--border:#2a3250;--border-bright:#3a4570;--text:#e2e8f0;--text-bright:#f1f5f9;--dim:#6b7a90;--muted:#4a5568;--accent:#818cf8;--accent-dim:rgba(129,140,248,.25);--accent-glow:rgba(129,140,248,.12);--green:#10b981;--green-dim:rgba(16,185,129,.2);--red:#ef4444;--red-dim:rgba(239,68,68,.2);--yellow:#f59e0b;--yellow-dim:rgba(245,158,11,.2);--cyan:#22d3ee;--purple:#a78bfa;--pink:#f472b6;--orange:#fb923c;--mono:'JetBrains Mono',monospace;--sans:'Space Grotesk',sans-serif;--radius:8px;--radius-lg:14px;--shadow:0 4px 20px rgba(0,0,0,.4);--shadow-glow:0 0 40px var(--accent-glow);--transition:.15s ease}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:var(--mono);font-size:13px;min-height:100vh;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--dim)}
a{color:var(--accent);text-decoration:none;transition:color var(--transition)}
a:hover{color:var(--text-bright);text-decoration:none}

.wrap{max-width:1200px;margin:0 auto;padding:28px 20px}
.hdr{display:flex;align-items:center;gap:14px;margin-bottom:24px;flex-wrap:wrap;padding-bottom:16px;border-bottom:1px solid var(--border);position:relative}
.hdr::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--accent-dim),transparent)}
h1{font-family:var(--sans);font-size:24px;font-weight:700;letter-spacing:-.03em}
h1 span{color:var(--accent);text-shadow:0 0 24px var(--accent-dim)}

.top-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:820px){.top-row{grid-template-columns:1fr}}

.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px 22px;box-shadow:var(--shadow)}
.card-title{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--dim);margin-bottom:14px;font-family:var(--mono)}

.chip-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.chip{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:6px 14px;font-size:11px;color:var(--dim);box-shadow:var(--shadow)}
.chip b{color:var(--text-bright);font-weight:600}
.chip.ok b{color:var(--green)}
.chip.warn b{color:var(--yellow)}
.chip.bad b{color:var(--red)}

.filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.filter-btn{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:6px 14px;font-size:11px;color:var(--dim);cursor:pointer;user-select:none;display:flex;align-items:center;gap:7px;transition:all var(--transition);font-family:var(--mono)}
.filter-btn:hover{border-color:var(--border-bright);color:var(--text)}
.filter-btn.active{border-color:var(--accent);color:var(--text-bright);background:var(--accent-glow);box-shadow:0 0 12px var(--accent-glow)}
.filter-btn .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;box-shadow:0 0 6px currentColor}

.chart-wrap{position:relative;width:100%;max-height:400px}
.chart-wrap canvas{width:100%!important}

.snapshot-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}
.snapshot-form input{background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:7px 12px;font-size:11px;font-family:var(--mono);transition:border-color var(--transition)}
.snapshot-form input:focus{border-color:var(--accent);outline:none;box-shadow:0 0 0 2px var(--accent-glow)}
.snapshot-form button{background:var(--accent);color:#060a12;border:none;border-radius:var(--radius);padding:7px 16px;font-size:11px;font-weight:700;cursor:pointer;font-family:var(--mono);transition:all var(--transition);box-shadow:0 2px 12px var(--accent-dim)}
.snapshot-form button:hover{opacity:.88;transform:translateY(-1px)}
.snapshot-form button:active{transform:translateY(0)}
.snapshot-form button:disabled{opacity:.4;cursor:not-allowed;transform:none}
.snapshot-status{font-size:11px;color:var(--dim);margin-top:8px}

.empty-msg{text-align:center;padding:48px 24px;color:var(--dim);font-size:12px;line-height:1.9}
.empty-msg code{background:var(--card2);padding:2px 8px;border-radius:4px;font-size:11px}
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
      <input id="snapDir" placeholder="Target directory (absolute path)" style="width:320px" value="">
      <input id="snapLabel" placeholder="Label (e.g. original, refactored)" style="width:160px">
      <button id="snapBtn" onclick="captureSnapshot()">Capture Snapshot</button>
    </div>
    <div id="snapStatus" class="snapshot-status"></div>
  </div>

</div>

<script>
var CRITERIA = [
  { key: 'typeSafety', label: 'Type Safety', color: '#818cf8' },
  { key: 'testHealth', label: 'Test Health', color: '#10b981' },
  { key: 'security', label: 'Security', color: '#ef4444' },
  { key: 'runSpeed', label: 'Run Speed', color: '#f59e0b' },
  { key: 'buildSpeed', label: 'Build Speed', color: '#fb923c' },
  { key: 'tokenEfficiency', label: 'Token Efficiency', color: '#22d3ee' },
  { key: 'editQuality', label: 'Edit Quality', color: '#a78bfa' },
  { key: 'codeVolume', label: 'Code Volume', color: '#f472b6' }
];

var activeCriteria = {};
CRITERIA.forEach(function(c) { activeCriteria[c.key] = true; });

var radarChart = null;
var lineChart = null;
var benchData = null;

function initFilters() {
  var container = document.getElementById('filters');
  var html = '';
  CRITERIA.forEach(function(c) {
    html += '<div class="filter-btn active" data-key="' + c.key + '" onclick="toggleCriterion(this)" tabindex="0" role="checkbox" aria-checked="true" aria-label="Toggle ' + c.label + '">';
    html += '<span class="dot" style="background:' + c.color + '"></span>';
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
    datasets.push({
      label: data.baseline.label,
      data: activeKeys.map(function(k) { return getScore(data.baseline.scores, k); }),
      borderColor: '#ef4444',
      backgroundColor: 'rgba(239,68,68,0.08)',
      borderWidth: 2,
      pointRadius: 4,
      pointBackgroundColor: '#ef4444'
    });
  }

  if (data.snapshots.length > 0) {
    var latest = data.snapshots[data.snapshots.length - 1];
    datasets.push({
      label: latest.label + ' (snapshot)',
      data: activeKeys.map(function(k) { return getScore(latest.scores, k); }),
      borderColor: '#10b981',
      backgroundColor: 'rgba(16,185,129,0.12)',
      borderWidth: 2,
      pointRadius: 4,
      pointBackgroundColor: '#10b981'
    });
  }

  if (data.runs.length > 0) {
    var lastRun = data.runs[data.runs.length - 1];
    datasets.push({
      label: 'Latest Run',
      data: activeKeys.map(function(k) { return getScore(lastRun.scores, k); }),
      borderColor: '#818cf8',
      backgroundColor: 'rgba(129,140,248,0.10)',
      borderWidth: 2,
      pointRadius: 4,
      pointBackgroundColor: '#818cf8'
    });
  }

  return datasets;
}

function buildLineDatasets(data, activeKeys) {
  if (data.runs.length === 0) return { labels: [], datasets: [] };

  var labels = data.runs.map(function(r, i) {
    if (r.savedAt) {
      var d = new Date(r.savedAt);
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
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

    datasets.push({
      label: crit.label,
      data: data.runs.map(function(r) { return getScore(r.scores, key); }),
      borderColor: crit.color,
      backgroundColor: crit.color + '18',
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: crit.color,
      tension: 0.3,
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
        legend: { position: 'bottom', labels: { color: '#e2e8f0', font: { family: "'JetBrains Mono', monospace", size: 11 }, padding: 16 } }
      },
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: { stepSize: 20, color: '#6b7a90', backdropColor: 'transparent', font: { size: 9 } },
          grid: { color: '#2a3250' },
          angleLines: { color: '#2a3250' },
          pointLabels: { color: '#e2e8f0', font: { family: "'JetBrains Mono', monospace", size: 10 } }
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
        legend: { position: 'bottom', labels: { color: '#e2e8f0', font: { family: "'JetBrains Mono', monospace", size: 11 }, padding: 16 } }
      },
      scales: {
        x: { ticks: { color: '#6b7a90', font: { size: 9 }, maxRotation: 45 }, grid: { color: '#2a3250' } },
        y: { min: 0, max: 100, ticks: { stepSize: 20, color: '#6b7a90', font: { size: 9 } }, grid: { color: '#2a3250' } }
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
