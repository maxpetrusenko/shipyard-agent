/**
 * Shared top navigation for dashboard / runs / benchmarks pages.
 */

export type NavPage = 'chat' | 'runs' | 'benchmarks';

export const NAV_STYLES = `
.app-nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:12px}
.app-nav a{font-size:11px;border:1px solid var(--border);border-radius:var(--radius);padding:5px 14px;color:var(--dim);text-decoration:none;transition:all var(--transition);font-family:var(--mono)}
.app-nav a:hover{border-color:var(--accent);color:var(--accent);box-shadow:0 0 12px var(--accent-glow)}
.app-nav a.active{border-color:var(--accent);color:var(--text-bright);background:var(--accent-glow)}
.chat-layout{display:grid;grid-template-columns:220px 1fr;gap:16px;align-items:stretch;min-height:calc(100dvh - 200px)}
@media(max-width:960px){.chat-layout{grid-template-columns:1fr;min-height:calc(100dvh - 240px)}}
.chat-side{font-size:11px;color:var(--dim)}
.chat-side .side-hd{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:8px}
.chat-center{min-width:0;display:flex;flex-direction:column;min-height:0;height:100%;align-self:stretch}
.chat-shell{display:flex;flex-direction:column;flex:1;min-height:0;height:100%;max-height:none}
.chat-thread{flex:1;min-height:0;overflow-y:auto;padding:8px 4px 16px;scroll-behavior:smooth;border:1px solid var(--border);border-radius:var(--radius-lg);background:linear-gradient(180deg,var(--bg2),var(--bg))}
.chat-composer{flex-shrink:0;padding-top:12px;margin-top:0;border-top:1px solid var(--border)}
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
.chat-act-del{color:var(--red);border-color:rgba(239,68,68,.35)}
.chat-act-del:hover{border-color:var(--red);color:#fca5a5}
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
