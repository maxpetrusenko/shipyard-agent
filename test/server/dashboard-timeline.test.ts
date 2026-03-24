import { describe, it, expect } from 'vitest';
import { getTimelineScript } from '../../src/server/dashboard-timeline.js';

describe('dashboard timeline script', () => {
  it('includes a debug action for assistant replies', () => {
    const script = getTimelineScript();
    expect(script).toContain('data-action="openDebug"');
  });

  it('includes a debug action in the run header', () => {
    const script = getTimelineScript();
    expect(script).toContain('data-chat-header-action="debug"');
  });

  it('renders the debug button on user messages, not assistant messages', () => {
    const script = getTimelineScript();
    expect(script).toContain(`msg-user"><div class="msg-meta-row"><div class="msg-meta">You</div>' + traceBtn + '</div>`);
    expect(script).not.toContain(`msg-asst"><div class="msg-meta-row"><div class="msg-meta">Shipyard</div>' + traceBtn + '</div>`);
  });

  it('does not render trace buttons as disabled', () => {
    const script = getTimelineScript();
    expect(script).not.toContain('disabled>i</button>');
  });
});
