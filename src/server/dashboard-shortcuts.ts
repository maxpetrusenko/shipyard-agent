/**
 * Keyboard shortcuts, empty-state cards, and CSS animations.
 * Injected into the dashboard <script> + HTML by the glue file.
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
.welcome-card{text-align:center;padding:64px 32px;color:var(--dim)}
.welcome-icon{width:48px;height:48px;margin:0 auto 16px;border-radius:var(--radius-lg);background:var(--accent-glow);border:1px solid var(--accent-dim);display:flex;align-items:center;justify-content:center}
.welcome-title{font-size:20px;font-weight:700;color:var(--text);margin-bottom:8px;letter-spacing:-.02em}
.welcome-sub{font-size:var(--text-md);margin-bottom:24px;line-height:1.5;color:var(--dim)}
.welcome-prompts{display:flex;flex-direction:column;gap:8px;max-width:460px;margin:0 auto}
.welcome-prompt{position:relative;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:10px 36px 10px 14px;font-size:var(--text-md);color:var(--text);cursor:pointer;text-align:left;font-family:var(--mono);transition:all var(--transition)}
.welcome-prompt:hover{border-color:var(--accent);background:var(--accent-glow);transform:translateX(4px)}
.welcome-prompt::after{content:'\\2192';position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0;color:var(--accent);transition:opacity var(--transition)}
.welcome-prompt:hover::after{opacity:1}
.no-keys-banner{background:var(--yellow-dim);border:1px solid var(--warning-border-soft);border-radius:var(--radius-lg);padding:10px 14px;font-size:var(--text-base);font-family:var(--mono);color:var(--yellow);margin-bottom:12px;display:flex;align-items:center;gap:8px}
.no-keys-icon{flex-shrink:0;width:16px;height:16px}
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

function renderWelcomeEmpty() {
  return '<div class="welcome-card anim-fade">' +
    '<div class="welcome-icon">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<title>Shipyard Agent</title><path d="M2 20l3.5-3.5"/><path d="M18 4l-8 8"/><path d="M18 4h-4"/><path d="M18 4v4"/>' +
        '<path d="M2 12C2 6.5 6.5 2 12 2"/>' +
      '</svg>' +
    '</div>' +
    '<div class="welcome-title">Shipyard Agent</div>' +
    '<div class="welcome-sub">What would you like to build?</div>' +
    '<div class="welcome-prompts">' +
      '<button type="button" class="welcome-prompt" data-action="applyNextAction" data-prompt="Fix the failing tests in the project">Fix the failing tests in the project</button>' +
      '<button type="button" class="welcome-prompt" data-action="applyNextAction" data-prompt="Refactor the largest file to be under 500 lines">Refactor the largest file to be under 500 lines</button>' +
      '<button type="button" class="welcome-prompt" data-action="applyNextAction" data-prompt="Add error handling to the API routes">Add error handling to the API routes</button>' +
    '</div>' +
  '</div>';
}

function renderNoKeysBanner() {
  return '<div class="no-keys-banner">' +
    '<svg class="no-keys-icon" viewBox="0 0 16 16" fill="none" stroke="var(--yellow)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<title>Warning</title><path d="M8 1.5L1.5 13h13L8 1.5z"/><path d="M8 6v3"/><circle cx="8" cy="11" r=".5" fill="var(--yellow)"/>' +
    '</svg>' +
    '<span>No API keys configured. Open settings to add your Anthropic or OpenAI key.</span>' +
  '</div>';
}
`;
}
