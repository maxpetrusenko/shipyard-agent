/**
 * Shared top navigation for dashboard / runs / benchmarks pages.
 */

export type NavPage = 'chat' | 'runs' | 'benchmarks';

/**
 * Shared design tokens for all server-rendered pages.
 * Keep page-specific overrides outside this block.
 */
export const SHIPYARD_THEME_VARS = `
:root{
  color-scheme:light;
  --bg:#f7f5f2;
  --bg2:#f0ede8;
  --card:#ffffff;
  --card2:#f5f3ef;
  --border:#e5e0d8;
  --border-bright:#d8d1c6;
  --text:#1a1815;
  --text-bright:#0d0c0a;
  --dim:#5c5549;
  --muted:#8a816f;
  --accent:#c45a3c;
  --accent-dim:rgba(196,90,60,.14);
  --accent-glow:rgba(196,90,60,.07);
  --accent-strong:#a0432a;
  --green:#2d8659;
  --green-dim:rgba(45,134,89,.12);
  --red:#c53030;
  --red-dim:rgba(197,48,48,.11);
  --red-soft:#e57373;
  --red-softer:#ef9a9a;
  --yellow:#b8860b;
  --yellow-dim:rgba(184,134,11,.12);
  --cyan:#0e7490;
  --cyan-dim:rgba(14,116,144,.10);
  --purple:#6b21a8;
  --purple-dim:rgba(107,33,168,.10);
  --pink:#be185d;
  --pink-dim:rgba(190,24,93,.10);
  --neutral-dim:rgba(110,102,88,.18);
  --neutral-soft:rgba(138,129,111,.10);
  --text-inverse:#fffaf5;
  --text-link-soft:#e8a88c;
  --shadow:0 4px 16px rgba(42,38,31,.06);
  --shadow-glow:0 0 14px var(--accent-glow);
  --shadow-lg:0 12px 32px rgba(42,38,31,.10);
  --shadow-ring:0 0 0 3px var(--accent-dim);
  --shadow-raised:0 -2px 6px rgba(42,38,31,.04);
  --overlay-backdrop:rgba(42,38,31,.25);
  --overlay-backdrop-strong:rgba(22,19,15,.65);
  --header-backdrop:rgba(247,245,242,.92);
  --composer-backdrop-start:rgba(255,255,255,.5);
  --composer-backdrop-mid:rgba(255,255,255,.95);
  --composer-backdrop-end:var(--bg);
  --sidebar-bg:#f0ede8;
  --sidebar-hover:rgba(0,0,0,.04);
  --danger-border-soft:rgba(200,40,40,.18);
  --danger-border-med:rgba(200,40,40,.22);
  --danger-border-strong:rgba(200,40,40,.28);
  --danger-bg-soft:rgba(200,40,40,.06);
  --danger-bg-med:rgba(220,50,50,.06);
  --danger-bg-strong:rgba(220,50,50,.10);
  --danger-border-panel:rgba(220,50,50,.24);
  --warning-border-soft:rgba(180,100,0,.22);
  --success-border-soft:rgba(16,150,100,.30);
  --success-bg-soft:rgba(16,150,100,.10);
  --warn-border-soft:rgba(200,130,10,.30);
  --warn-bg-soft:rgba(200,130,10,.10);
  --danger-border-badge:rgba(220,50,50,.30);
  --danger-bg-badge:rgba(220,50,50,.10);
  --kbd-key-shadow:0 1px 2px rgba(42,38,31,.10);
  --btn-accent-shadow:0 2px 10px var(--accent-dim);
  --btn-accent-shadow-soft:0 2px 8px var(--accent-dim);
  --radius-sm:6px;
  --mono:'JetBrains Mono',monospace;
  --sans:'Space Grotesk',sans-serif;
  --radius:8px;
  --radius-lg:14px;
  --radius-xl:18px;
  --radius-pill:999px;
  --z-header:40;
  --z-composer:30;
  --z-modal:100;
  --z-overlay:90;
  --text-xs:9px;
  --text-sm:10px;
  --text-base:11px;
  --text-md:12px;
  --text-lg:13px;
  --text-xl:14px;
  --search-icon:#a09484;
  --bench-type-safety:#818cf8;
  --bench-test-health:#10b981;
  --bench-security:#ef4444;
  --bench-run-speed:#f59e0b;
  --bench-build-speed:#fb923c;
  --bench-token-efficiency:#22d3ee;
  --bench-edit-quality:#a78bfa;
  --bench-code-volume:#f472b6;
  --transition:.15s ease
}`;

/**
 * Base reset + global defaults for server-rendered app pages.
 * Pages can layer local layout/body sizing rules on top.
 */
export const SHIPYARD_BASE_STYLES = `
*{margin:0;padding:0;box-sizing:border-box}
html{color-scheme:light}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--mono);-webkit-font-smoothing:antialiased}
input,textarea,select,button{color-scheme:light}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--dim)}
a{color:var(--accent);text-decoration:none;transition:color var(--transition)}
a:hover{color:var(--text-bright);text-decoration:none}
code{background:var(--card2);padding:2px 6px;border-radius:4px;font-size:var(--text-base)}
/* Toast notifications */
.toast-container{position:fixed;bottom:20px;right:20px;z-index:var(--z-modal);display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none}
.toast{padding:10px 16px;border-radius:var(--radius);font-size:11px;font-family:var(--mono);box-shadow:var(--shadow-lg);animation:toastIn .2s ease;max-width:300px;pointer-events:auto}
.toast-info{background:var(--card);border:1px solid var(--border);color:var(--text)}
.toast-success{background:var(--success-bg-soft);border:1px solid var(--success-border-soft);color:var(--green)}
.toast-error{background:var(--danger-bg-soft);border:1px solid var(--danger-border-badge);color:var(--red)}
.toast-warning{background:var(--warn-bg-soft);border:1px solid var(--warn-border-soft);color:var(--yellow)}
@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
/* Focus-visible rings for interactive right-rail elements */
.rr-instr-area:focus-visible,.rr-show-all:focus-visible,.rr-badge:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
.chat-right button:focus-visible{outline:none;box-shadow:var(--shadow-ring)}
`;

/**
 * Shared badge primitives used by settings and dashboard side panels.
 */
export const SHIPYARD_BADGE_STYLES = `
.status-badge,.side-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:var(--radius-pill);font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.08em;border:1px solid var(--border)}
.status-badge.ok,.side-badge.ok{color:var(--green);border-color:var(--success-border-soft);background:var(--success-bg-soft)}
.status-badge.off,.side-badge.off{color:var(--red);border-color:var(--danger-border-badge);background:var(--danger-bg-badge)}
.status-badge.warn,.side-badge.warn{color:var(--yellow);border-color:var(--warn-border-soft);background:var(--warn-bg-soft)}
`;

/** Shared JS helpers injected into every dashboard page script. */
export function getSharedHelperScript(): string {
  return `
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'})[c]; });
}
function renderEmptyState(msg) {
  return '<div class="detail-empty">' + esc(msg) + '</div>';
}
function phCls(p) {
  var m = { done:'pp-done', error:'pp-error', routing:'pp-routing', planning:'pp-planning', executing:'pp-executing', verifying:'pp-verifying', reviewing:'pp-reviewing', idle:'pp-idle', awaiting_confirmation:'pp-awaiting_confirmation', paused:'pp-paused' };
  return m[p] || 'pp-idle';
}
function fmtDur(ms) {
  ms = Number(ms || 0);
  if (ms < 1000) return ms + 'ms';
  var s = Math.round(ms / 100) / 10;
  if (s < 60) return s + 's';
  var m = Math.floor(s / 60);
  var rem = Math.round(s % 60);
  return m + 'm ' + rem + 's';
}
function shortP(p) {
  var s = String(p || '');
  return s.length > 64 ? '\u2026' + s.slice(-63) : s;
}
function setBadge(el, text, type) {
  if (!el) return;
  el.className = 'side-badge ' + type;
  el.textContent = text;
}
`;
}

export const NAV_STYLES = `
.app-nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:12px}
.app-nav a{font-size:11px;border:1px solid var(--border);border-radius:var(--radius);padding:5px 14px;color:var(--dim);text-decoration:none;transition:all var(--transition);font-family:var(--mono)}
.app-nav a:hover{border-color:var(--accent);color:var(--accent);box-shadow:0 0 12px var(--accent-glow)}
.app-nav a.active{border-color:var(--accent);color:var(--text-bright);background:var(--accent-glow)}
.chat-layout{--sidebar-w:clamp(220px,22vw,280px);--rail-w:clamp(260px,28vw,360px);--detail-w:clamp(300px,34vw,420px);--sidebar-collapsed-w:48px;--rail-collapsed-w:48px;--sidebar-current:var(--sidebar-w);--rail-current:0px;--detail-current:0px;position:relative;display:grid;grid-template-columns:var(--sidebar-current) minmax(0,1fr) var(--rail-current) var(--detail-current);gap:0;align-items:stretch;min-height:0;height:100%;flex:1;overflow:hidden}
/* State-driven layout: 4 columns = sidebar | center | right-rail | detail-panel */
body.state-home .chat-layout{--rail-current:var(--rail-w)}
body.state-task .chat-layout{--rail-current:var(--rail-w)}
body.state-home.detail-open .chat-layout{--detail-current:var(--detail-w)}
body.state-task.detail-open .chat-layout{--detail-current:var(--detail-w)}
body.detail-open:not(.state-home):not(.state-task) .chat-layout{--detail-current:var(--detail-w)}
body.left-rail-collapsed .chat-layout{--sidebar-current:var(--sidebar-collapsed-w)}
body.right-rail-collapsed.state-home .chat-layout{--rail-current:var(--rail-collapsed-w)}
body.right-rail-collapsed.state-task .chat-layout{--rail-current:var(--rail-collapsed-w)}
/* Project hero: visible only in home state */
.project-hero{display:none}
body.state-home .project-hero{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;min-height:0}
body.state-home .chat-thread{display:none}
body.state-home .composer-wrap{max-width:560px;margin:0 auto;width:100%}
/* Right rail column */
.chat-right{min-height:0;overflow-y:auto;font-size:11px;border-left:1px solid var(--border);padding:16px;display:none;width:100%}
body.state-home .chat-right,body.state-task .chat-right{display:block}
/* Right rail: swap sections per state */
.right-home-sections{display:none}
.right-task-sections{display:none}
body.state-home .right-home-sections{display:block}
body.state-task .right-task-sections{display:block}
.shell-backdrop{position:fixed;inset:0;z-index:var(--z-overlay);border:none;background:var(--overlay-backdrop);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity var(--transition)}
body.sidebar-open .shell-backdrop,body.rail-open .shell-backdrop,body.compact-shell.detail-open .shell-backdrop{opacity:1;pointer-events:auto}
@media(max-width:860px){.chat-layout{grid-template-columns:minmax(0,1fr)!important}.chat-center{grid-column:1/-1}.shell-backdrop{display:block}}
@media(min-width:861px){.shell-backdrop{display:none!important}body.left-rail-collapsed .chat-side,body.right-rail-collapsed .chat-right{overflow:hidden}}
/* chat-side base styles now in dashboard-sidebar.ts */
.chat-center{min-width:0;display:flex;flex-direction:column;min-height:0;height:100%;align-self:stretch;overflow:hidden}
.chat-shell{display:flex;flex-direction:column;flex:1;min-height:0;height:100%;max-height:none}
.chat-thread{flex:1;min-height:0;overflow-y:auto;padding:12px 8px 16px;scroll-behavior:smooth;background:var(--bg)}
.chat-composer{position:sticky;bottom:0;z-index:15;flex-shrink:0;padding-top:12px;margin-top:0;border-top:1px solid var(--border);background:linear-gradient(180deg,var(--composer-backdrop-start) 0%,var(--composer-backdrop-mid) 24%,var(--composer-backdrop-end) 100%);backdrop-filter:blur(8px)}
.msg{margin-bottom:16px;max-width:min(92%,720px);font-family:var(--sans)}
.msg-user{margin-left:auto;background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px 16px;font-size:14px;line-height:1.6;color:var(--text)}
.msg-asst{margin-right:auto;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px 16px;font-size:14px;line-height:1.65;white-space:pre-wrap;word-break:break-word;max-height:500px;overflow-y:auto}
[role="alert"]{max-height:200px;overflow-y:auto;border-radius:var(--radius);padding:10px 14px;font-size:13px;line-height:1.5}
.msg-meta{font-size:10px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em}
.msg-meta-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
.msg-meta-row .msg-meta{margin-bottom:0}
.trace-btn{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;border:1px solid var(--border-bright);background:transparent;color:var(--dim);font:600 10px/1 var(--mono);cursor:pointer;transition:all var(--transition);padding:0;text-decoration:none}
.trace-btn:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-glow)}
.thinking-inline{display:flex;align-items:center;gap:8px;padding:10px 14px;border:1px dashed var(--border-bright);border-radius:var(--radius);color:var(--dim);font-size:11px;margin-bottom:12px;background:var(--card)}
/* chat-item-* styles now in dashboard-sidebar.ts */
/* Timeline rows */
.tl-row{margin-bottom:6px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.tl-hdr{display:flex;align-items:center;gap:6px;padding:6px 12px;font-size:11px;cursor:pointer;background:var(--card);border-left:3px solid var(--dim);transition:background .15s;user-select:none}
.tl-hdr:hover{background:var(--card2)}
.tl-chev{font-size:8px;transition:transform .2s;display:inline-block}
.tl-row:not(.collapsed) .tl-chev{transform:rotate(90deg)}
.tl-body{display:none;padding:8px 12px;background:var(--bg2);border-top:1px solid var(--border)}
.tl-row:not(.collapsed) .tl-body{display:block}
.tl-pre{font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin:0;max-height:300px;overflow-y:auto}
.tl-diff{font-size:11px;line-height:1.5;max-height:200px;overflow-y:auto}
.tl-detail{font-size:11px;color:var(--dim);line-height:1.5}
.tl-tag{font-size:9px;font-weight:700;text-transform:uppercase;padding:1px 6px;border-radius:4px;margin-left:auto}
.tl-tag-ok{background:var(--green-dim);color:var(--green)}
.tl-tag-fail{background:var(--red-dim);color:var(--red)}
.tl-phase{display:flex;align-items:center;gap:8px;padding:4px 12px;font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;margin:8px 0}
.tl-phase-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
@media(max-width:720px){.chat-thread{padding:10px 0 12px}.msg{max-width:100%}.msg-user,.msg-asst{max-width:100%;padding:10px 12px;font-size:13px}.run-hdr{grid-template-columns:72px 88px minmax(0,1fr) auto 16px;padding:10px 12px;gap:8px}.app-nav{margin-left:0;width:100%;justify-content:center}}
`;

export function topNav(active: NavPage): string {
  const link = (page: NavPage, href: string, label: string) =>
    `<a href="${href}" class="${active === page ? 'active' : ''}" ${active === page ? 'aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="app-nav" aria-label="Site">${link('chat', '/dashboard', 'Chat')}${link('runs', '/runs', 'Runs')}${link('benchmarks', '/benchmarks', 'Benchmarks')}</nav>`;
}
