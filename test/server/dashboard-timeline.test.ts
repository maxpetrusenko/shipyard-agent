import { describe, it, expect } from 'vitest';
import { getTimelineScript } from '../../src/server/dashboard-timeline.js';

describe('dashboard timeline script', () => {
  it('includes a debug action in assistant chat bubbles', () => {
    const script = getTimelineScript();
    expect(script).toContain('data-action="openDebug"');
    expect(script).toContain('data-rid="');
  });

  it('does not render debug actions in the run header', () => {
    const script = getTimelineScript();
    expect(script).not.toContain('data-chat-header-action="debug"');
    expect(script).not.toContain('data-chat-header-action="rename"');
    expect(script).not.toContain('data-chat-header-action="delete"');
  });

  it('renders debug buttons for user and assistant chat messages', () => {
    const script = getTimelineScript();
    expect(script).toContain("renderMsgMetaRow('You', selectedRunId)");
    expect(script).toContain('function traceBtnHtml(runId)');
    expect(script).toContain("renderMsgMetaRow('Shipyard', selectedRunId)");
  });

  it('shows trace affordance on progress and placeholder assistant bubbles', () => {
    const script = getTimelineScript();
    expect(script).toContain("<div class=\"msg-meta\">Agent progress</div>' + traceBtnHtml(r.runId)");
    expect(script).toContain("renderMsgMetaRow('Shipyard', r.runId)");
  });

  it('drops the trace source explainer banner from the thread', () => {
    const script = getTimelineScript();
    expect(script).not.toContain('Trace source');
    expect(script).not.toContain('Local reconstructed timeline from run messages, tool history, and websocket events. External LangSmith trace stays separate in Debug.');
  });

  it('renders terminal errors as the last assistant bubble', () => {
    const script = getTimelineScript();
    expect(script).toContain('function renderTerminalErrorBubble(errorText, runId)');
    expect(script).toContain("if (r.error) {");
    expect(script).toContain("h += renderTerminalErrorBubble(r.error, r.runId);");
  });

  it('forwards live tool payload into timeline cards', () => {
    const script = getTimelineScript();
    expect(script).toContain('a.tool_input || null');
    expect(script).toContain('a.tool_result || null');
  });

  it('supports websearch alias for rich activity details', () => {
    const script = getTimelineScript();
    expect(script).toContain("n === 'web_search' || n === 'websearch'");
  });
});
