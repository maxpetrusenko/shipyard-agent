export function getHeaderStyles(): string {
  return `
.hdr{display:flex;align-items:center;gap:14px;padding:8px 0 10px;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:var(--z-header);background:var(--header-backdrop);backdrop-filter:blur(8px)}
.hdr::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--accent-dim),transparent)}
h1{font-family:var(--sans);font-size:20px;font-weight:700;letter-spacing:-.03em}
h1 .logo-ship{color:var(--accent)}
h1 .logo-yard{color:var(--text)}
.pill{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:4px 12px;font-size:var(--text-base);color:var(--dim);font-family:var(--mono);cursor:pointer;transition:all var(--transition)}
.pill:hover{border-color:var(--accent);color:var(--accent)}
.pill span{color:var(--accent)}
/* run status chip */
.hdr-status{display:none;align-items:center;gap:6px;padding:4px 10px;border-radius:var(--radius);font-size:var(--text-sm);font-family:var(--mono);font-weight:600;text-transform:uppercase;letter-spacing:.04em;transition:all var(--transition)}
.hdr-status.visible{display:inline-flex}
.hdr-status .ldot{margin-right:0}
.hdr-right{display:flex;align-items:center;gap:8px;margin-left:auto}
.hdr-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:var(--radius);border:1px solid var(--border);background:var(--card);color:var(--dim);cursor:pointer;transition:all var(--transition);font-size:var(--text-lg)}
.hdr-icon-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-glow)}
.hdr-icon-btn:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.pill:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.wsdot{width:6px;height:6px;border-radius:50%;display:inline-block}
.wsdot.on{background:var(--green);box-shadow:0 0 6px var(--green-dim)}
.wsdot.off{background:var(--red);box-shadow:0 0 6px var(--red-dim)}
`;
}

export function getHeaderHtml(repoBranch: string, repoLastCommit: string): string {
  return `
  <div class="hdr">
    <h1><a href="/" style="color:inherit;text-decoration:none"><span class="logo-ship">Ship</span><span class="logo-yard">yard</span></a></h1>
    <div class="pill" data-action="copyRepoPill" title="Click to copy"><span>${repoBranch}</span> &middot; ${repoLastCommit.slice(0, 55)}</div>
    <span class="hdr-status" id="hdrStatus"></span>
    <div class="hdr-right">
      <span class="wsdot off" id="wsDot"></span>
      <span id="wsLbl" style="font-size:11px;color:var(--dim)">connecting</span>
      <button type="button" class="hdr-icon-btn" data-action="openRetry" title="Retry Events" aria-label="Retry Events">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><title>Retry events</title><polyline points="1 4 1 10 7 10"/><path d="M3.51 14.49A8 8 0 1 0 1 8"/></svg>
      </button>
      <button type="button" class="hdr-icon-btn" data-action="openSettings" title="Config (Cmd+,)" aria-label="Config">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><title>Config</title><circle cx="8" cy="8" r="2.5"/><path d="M13.5 8a5.5 5.5 0 0 1-.16 1.32l1.46 1.14a.35.35 0 0 1 .08.44l-1.38 2.4a.35.35 0 0 1-.42.15l-1.72-.69a5.2 5.2 0 0 1-1.14.66l-.26 1.83a.34.34 0 0 1-.34.29H7.38a.34.34 0 0 1-.34-.29l-.26-1.83a5.4 5.4 0 0 1-1.14-.66l-1.72.69a.35.35 0 0 1-.42-.15L2.12 10.9a.35.35 0 0 1 .08-.44l1.46-1.14A5.6 5.6 0 0 1 3.5 8c0-.45.06-.9.16-1.32L2.2 5.54a.35.35 0 0 1-.08-.44l1.38-2.4a.35.35 0 0 1 .42-.15l1.72.69c.35-.26.73-.48 1.14-.66L7.04 .75A.34.34 0 0 1 7.38.46h2.24c.17 0 .31.12.34.29l.26 1.83c.41.18.79.4 1.14.66l1.72-.69a.35.35 0 0 1 .42.15l1.38 2.4a.35.35 0 0 1-.08.44l-1.46 1.14c.1.42.16.87.16 1.32z"/></svg>
      </button>
      <button type="button" class="hdr-icon-btn" data-action="showShortcuts" title="Keyboard shortcuts (?)" aria-label="Shortcuts">?</button>
    </div>
  </div>`;
}

export function getHeaderScript(): string {
  return `
function copyRepoPill() {
  var pill = document.querySelector('.pill');
  if (!pill) return;
  var text = pill.textContent || '';
  navigator.clipboard.writeText(text.trim()).then(function() {
    var orig = pill.style.borderColor;
    pill.style.borderColor = 'var(--green)';
    setTimeout(function() { pill.style.borderColor = orig; }, 1000);
  }).catch(function() {});
}

var _phaseColors = {planning:'var(--accent)',executing:'var(--yellow)',verifying:'var(--cyan)',reviewing:'var(--cyan)',routing:'var(--cyan)'};
function syncHeaderStatus() {
  var el = document.getElementById('hdrStatus');
  if (!el) return;
  var phase = lastState && lastState.phase;
  var active = ACTIVE_PHASES;
  if (curRunId && phase && active.indexOf(phase) >= 0) {
    var c = _phaseColors[phase] || 'var(--dim)';
    el.innerHTML = '<span class="ldot" style="background:' + c + ';box-shadow:0 0 6px ' + c + '"></span>' + phase;
    el.style.color = c;
    el.style.background = 'color-mix(in srgb, ' + c + ' 8%, transparent)';
    el.classList.add('visible');
  } else {
    el.classList.remove('visible');
    el.innerHTML = '';
  }
}
`;
}
