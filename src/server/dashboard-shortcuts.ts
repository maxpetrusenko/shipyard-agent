/**
 * Keyboard shortcuts overlay styles + helpers for the dashboard.
 */

export function getShortcutsStyles(): string {
  return `
.kbd-overlay{position:fixed;inset:0;z-index:var(--z-overlay);display:flex;align-items:center;justify-content:center;background:var(--overlay-backdrop);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity var(--transition)}
.kbd-overlay.open{opacity:1;pointer-events:auto}
.kbd-overlay.open .kbd-card{transform:translateY(0);opacity:1}
.kbd-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-xl);width:min(420px,90vw);padding:24px;box-shadow:var(--shadow-lg);transform:translateY(8px);opacity:0;transition:transform var(--transition),opacity var(--transition)}
.kbd-title{font-size:var(--text-xl);font-weight:700;margin-bottom:14px;letter-spacing:-.01em}
.kbd-row{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;font-size:var(--text-md);border-radius:var(--radius)}
.kbd-row:nth-child(even){background:var(--bg2)}
.kbd-key{font-family:var(--mono);font-size:var(--text-base);font-weight:600;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:2px 10px;min-width:60px;text-align:center;color:var(--text);box-shadow:var(--kbd-key-shadow)}
@keyframes fade-in{from{opacity:0}to{opacity:1}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
.anim-fade{animation:fade-in var(--transition)}
.thinking-shimmer{background:linear-gradient(90deg,var(--bg2) 25%,var(--card2) 50%,var(--bg2) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite}
`;
}

export function getShortcutsHtml(): string {
  return `
<div class="kbd-overlay" id="kbdOverlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
  <div class="kbd-card">
    <div class="kbd-title">Keyboard Shortcuts</div>
    <div class="kbd-row"><span>New chat</span><span class="kbd-key">Cmd+N</span></div>
    <div class="kbd-row"><span>Search chats</span><span class="kbd-key">Cmd+K</span></div>
    <div class="kbd-row"><span>Config</span><span class="kbd-key">Cmd+,</span></div>
    <div class="kbd-row"><span>Stop run</span><span class="kbd-key">Cmd+.</span></div>
    <div class="kbd-row"><span>Close panel</span><span class="kbd-key">Escape</span></div>
    <div class="kbd-row"><span>Send message</span><span class="kbd-key">Cmd+Enter</span></div>
  </div>
</div>`;
}

export function getShortcutsScript(): string {
  return `
function showShortcuts() {
  var ov = document.getElementById('kbdOverlay');
  if (ov) ov.classList.add('open');
}
function hideShortcuts() {
  var ov = document.getElementById('kbdOverlay');
  if (ov) ov.classList.remove('open');
}

`;
}
