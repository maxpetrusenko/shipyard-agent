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
  --bg:#f6f8fc;
  --bg2:#edf2f8;
  --card:#ffffff;
  --card2:#f8fbff;
  --border:#d5dfeb;
  --border-bright:#b9c8de;
  --text:#0f172a;
  --text-bright:#020617;
  --dim:#475569;
  --muted:#64748b;
  --accent:#2563eb;
  --accent-dim:rgba(37,99,235,.2);
  --accent-glow:rgba(37,99,235,.11);
  --accent-strong:#1e3a8a;
  --green:#059669;
  --green-dim:rgba(5,150,105,.14);
  --red:#dc2626;
  --red-dim:rgba(220,38,38,.13);
  --red-soft:#f87171;
  --red-softer:#fca5a5;
  --yellow:#d97706;
  --yellow-dim:rgba(217,119,6,.14);
  --cyan:#0891b2;
  --cyan-dim:rgba(34,211,238,.12);
  --purple:#7c3aed;
  --purple-dim:rgba(167,139,250,.12);
  --pink:#db2777;
  --pink-dim:rgba(244,114,182,.12);
  --neutral-dim:rgba(75,85,99,.2);
  --neutral-soft:rgba(127,145,167,.12);
  --text-inverse:#ffffff;
  --text-link-soft:#93c5fd;
  --shadow:0 8px 22px rgba(15,23,42,.08);
  --shadow-glow:0 0 20px var(--accent-glow);
  --shadow-lg:0 18px 38px rgba(15,23,42,.14);
  --shadow-ring:0 0 0 3px var(--accent-dim);
  --shadow-raised:0 -2px 8px rgba(15,23,42,.06);
  --overlay-backdrop:rgba(15,23,42,.3);
  --overlay-backdrop-strong:rgba(3,6,12,.72);
  --header-backdrop:rgba(246,248,252,.92);
  --composer-backdrop-start:rgba(250,251,252,.6);
  --composer-backdrop-mid:rgba(250,251,252,.95);
  --composer-backdrop-end:var(--bg);
  --danger-border-soft:rgba(220,38,38,.2);
  --danger-border-med:rgba(220,38,38,.25);
  --danger-border-strong:rgba(220,38,38,.3);
  --danger-bg-soft:rgba(220,38,38,.08);
  --danger-bg-med:rgba(239,68,68,.06);
  --danger-bg-strong:rgba(239,68,68,.12);
  --danger-border-panel:rgba(239,68,68,.28);
  --warning-border-soft:rgba(217,119,6,.25);
  --success-border-soft:rgba(16,185,129,.35);
  --success-bg-soft:rgba(16,185,129,.12);
  --warn-border-soft:rgba(245,158,11,.35);
  --warn-bg-soft:rgba(245,158,11,.12);
  --danger-border-badge:rgba(239,68,68,.35);
  --danger-bg-badge:rgba(239,68,68,.12);
  --kbd-key-shadow:0 1px 2px rgba(15,23,42,.12);
  --btn-accent-shadow:0 2px 12px var(--accent-dim);
  --btn-accent-shadow-soft:0 2px 10px var(--accent-dim);
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
  --search-icon:#9ca3af;
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
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--mono);-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--dim)}
a{color:var(--accent);text-decoration:none;transition:color var(--transition)}
a:hover{color:var(--text-bright);text-decoration:none}
code{background:var(--card2);padding:2px 6px;border-radius:4px;font-size:var(--text-base)}
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
function renderEmptyState(msg) {
  return '<div class="detail-empty">' + esc(msg) + '</div>';
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
.chat-layout{display:grid;grid-template-columns:220px 1fr;gap:16px;align-items:stretch;min-height:0;height:100%;flex:1;overflow:hidden}
@media(max-width:960px){.chat-layout{grid-template-columns:1fr}}
.chat-side{font-size:11px;color:var(--dim);min-height:0;overflow-y:auto}
.chat-side .side-hd{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:8px}
.chat-center{min-width:0;display:flex;flex-direction:column;min-height:0;height:100%;align-self:stretch;overflow:hidden}
.chat-shell{display:flex;flex-direction:column;flex:1;min-height:0;height:100%;max-height:none}
.chat-thread{flex:1;min-height:0;overflow-y:auto;padding:8px 4px 16px;scroll-behavior:smooth;border:1px solid var(--border);border-radius:var(--radius-lg);background:linear-gradient(180deg,var(--bg2),var(--bg))}
.chat-composer{position:sticky;bottom:0;z-index:15;flex-shrink:0;padding-top:12px;margin-top:0;border-top:1px solid var(--border);background:linear-gradient(180deg,var(--composer-backdrop-start) 0%,var(--composer-backdrop-mid) 24%,var(--composer-backdrop-end) 100%);backdrop-filter:blur(8px)}
.msg{margin-bottom:14px;max-width:min(92%,720px)}
.msg-user{margin-left:auto;background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:10px 14px;font-size:12px;line-height:1.5;color:var(--text)}
.msg-asst{margin-right:auto;background:var(--card);border:1px solid var(--border-bright);border-radius:var(--radius-lg);padding:10px 14px;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.msg-meta{font-size:10px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em}
.msg-meta-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
.msg-meta-row .msg-meta{margin-bottom:0}
.trace-btn{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;border:1px solid var(--border-bright);background:transparent;color:var(--dim);font:600 10px/1 var(--mono);cursor:pointer;transition:all var(--transition);padding:0}
.trace-btn:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-glow)}
.thinking-inline{display:flex;align-items:center;gap:8px;padding:10px 14px;border:1px dashed var(--border-bright);border-radius:var(--radius);color:var(--dim);font-size:11px;margin-bottom:12px;background:var(--card)}
.chat-item-wrap{display:flex;align-items:stretch;gap:2px;margin-bottom:4px;border-radius:var(--radius);border:1px solid transparent;overflow:hidden}
.chat-item-wrap:hover{background:var(--card2)}
.chat-item-wrap.active{border-color:var(--accent);background:var(--accent-glow)}
.chat-item-body{flex:1;min-width:0;text-align:left;padding:9px 10px;line-height:1.35;background:transparent;color:inherit;font-family:inherit;border:none;cursor:pointer;border-radius:var(--radius) 0 0 var(--radius)}
.chat-item-actions{display:flex;flex-direction:column;justify-content:center;gap:4px;padding:6px 8px 6px 4px;flex-shrink:0}
.chat-act{font-size:9px;padding:3px 8px;border-radius:var(--radius);border:1px solid var(--border);background:var(--card);color:var(--dim);cursor:pointer;font-family:var(--mono);line-height:1.2}
.chat-act:hover{border-color:var(--accent);color:var(--accent)}
.chat-act-del{color:var(--red);border-color:var(--danger-border-badge)}
.chat-act-del:hover{border-color:var(--red);color:var(--red-softer)}
.chat-item-title{font-size:11px;color:var(--text);font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.chat-item-sub{font-size:9px;color:var(--muted);margin-top:3px}
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
`;

export function topNav(active: NavPage): string {
  const link = (page: NavPage, href: string, label: string) =>
    `<a href="${href}" class="${active === page ? 'active' : ''}" ${active === page ? 'aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="app-nav" aria-label="Site">${link('chat', '/dashboard', 'Chat')}${link('runs', '/runs', 'Runs')}${link('benchmarks', '/benchmarks', 'Benchmarks')}</nav>`;
}
