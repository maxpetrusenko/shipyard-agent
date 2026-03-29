export function getHeaderStyles(): string {
  return `
.hdr{display:flex;align-items:center;height:48px;padding:0 16px;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:var(--z-header);background:var(--header-backdrop);backdrop-filter:blur(12px)}
.hdr-left{display:flex;align-items:center;gap:10px;min-width:0;flex-shrink:0}
.hdr-mobile-actions{display:flex;align-items:center;gap:6px}
.hdr-mobile-toggle{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--dim);cursor:pointer;transition:all var(--transition);padding:0}
.hdr-mobile-toggle:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-glow)}
.hdr-mobile-toggle:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.hdr-mobile-toggle svg{width:15px;height:15px;display:block}

/* Left: wordmark */
.hdr-wordmark{font-family:var(--sans);font-size:15px;font-weight:600;letter-spacing:-.02em;color:var(--text);text-decoration:none;flex-shrink:0;cursor:default;user-select:none}
.hdr-wordmark .wm-ship{color:var(--accent)}

/* Center: mode tabs */

/* Right: indicators + gear */
.hdr-right{display:flex;align-items:center;gap:10px;margin-left:auto;flex-shrink:0}
.hdr-link{font-family:var(--sans);font-size:11px;font-weight:600;color:var(--muted);text-decoration:none;padding:4px 0;transition:color var(--transition)}
.hdr-link:hover{color:var(--text)}
/* run status chip */
.hdr-status{display:none;align-items:center;gap:5px;padding:3px 8px;border-radius:var(--radius);font-size:10px;font-family:var(--mono);font-weight:600;text-transform:uppercase;letter-spacing:.04em;transition:all var(--transition)}
.hdr-status.visible{display:inline-flex}
.hdr-status .ldot{margin-right:0}
.wsdot{width:6px;height:6px;border-radius:50%;display:inline-block;flex-shrink:0}
.wsdot.on{background:var(--green);box-shadow:0 0 6px var(--green-dim)}
.wsdot.off{background:var(--red);box-shadow:0 0 6px var(--red-dim)}
.hdr-gear{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;border:1px solid var(--border);background:transparent;color:var(--dim);cursor:pointer;transition:all .15s ease;flex-shrink:0}
.hdr-gear:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-glow)}
.hdr-gear:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.hdr-gear svg{display:block}
@media(max-width:920px){.hdr{height:auto;min-height:56px;padding:10px 12px;gap:10px}.hdr-right{gap:8px}.hdr-link{display:none}}
@media(max-width:640px){.hdr-wordmark{font-size:14px}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
`;
}

export function getHeaderHtml(repoBranch: string, repoLastCommit: string): string {
  const repoInfo = `${repoBranch} \u00b7 ${repoLastCommit.slice(0, 55)}`;
  return `
  <div class="hdr">
    <div class="hdr-left">
      <div class="hdr-mobile-actions">
        <button type="button" class="hdr-mobile-toggle" id="hdrSidebarToggle" data-action="toggleSidebar" aria-label="Toggle tasks" aria-expanded="false">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="3" y1="4" x2="13" y2="4"/><line x1="3" y1="8" x2="13" y2="8"/><line x1="3" y1="12" x2="13" y2="12"/></svg>
        </button>
        <button type="button" class="hdr-mobile-toggle" id="hdrInspectorToggle" data-action="toggleInspector" aria-label="Toggle panels" aria-expanded="false">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><line x1="10" y1="3" x2="10" y2="13"/></svg>
        </button>
      </div>
      <span class="hdr-wordmark" title="${repoInfo}"><span class="wm-ship">Ship</span>yard</span>
    </div>
    <div class="hdr-right">
      <span class="hdr-status" id="hdrStatus"></span>
      <a class="hdr-link" href="/runs">Runs</a>
      <a class="hdr-link" href="/benchmarks">Benchmarks</a>
      <span class="wsdot off" id="wsDot"></span>
      <button type="button" class="hdr-gear" data-action="openRetry" title="Retry Events" aria-label="Retry Events">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8a6.5 6.5 0 0 1 11.48-4.18"/><path d="M14.5 8a6.5 6.5 0 0 1-11.48 4.18"/><polyline points="13 1.5 13 4.5 10 4.5"/><polyline points="3 14.5 3 11.5 6 11.5"/></svg>
      </button>
      <button type="button" class="hdr-gear" data-action="openSettings" title="Settings (Cmd+,)" aria-label="Settings">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M13.5 8a5.5 5.5 0 0 1-.16 1.32l1.46 1.14a.35.35 0 0 1 .08.44l-1.38 2.4a.35.35 0 0 1-.42.15l-1.72-.69a5.2 5.2 0 0 1-1.14.66l-.26 1.83a.34.34 0 0 1-.34.29H7.38a.34.34 0 0 1-.34-.29l-.26-1.83a5.4 5.4 0 0 1-1.14-.66l-1.72.69a.35.35 0 0 1-.42-.15L2.12 10.9a.35.35 0 0 1 .08-.44l1.46-1.14A5.6 5.6 0 0 1 3.5 8c0-.45.06-.9.16-1.32L2.2 5.54a.35.35 0 0 1-.08-.44l1.38-2.4a.35.35 0 0 1 .42-.15l1.72.69c.35-.26.73-.48 1.14-.66L7.04 .75A.34.34 0 0 1 7.38.46h2.24c.17 0 .31.12.34.29l.26 1.83c.41.18.79.4 1.14.66l1.72-.69a.35.35 0 0 1 .42.15l1.38 2.4a.35.35 0 0 1-.08.44l-1.46 1.14c.1.42.16.87.16 1.32z"/></svg>
      </button>
    </div>
  </div>`;
}

export function getHeaderScript(): string {
  return `
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
