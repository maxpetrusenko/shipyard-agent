/**
 * Next-action policy engine.
 *
 * Converts run outcome + intent context into suggested next actions.
 */

import { hasSuccessfulPrToolCall } from '../tools/commit-and-open-pr.js';
import type { RunResult } from './loop.js';
import type { LLMMessage } from '../graph/state.js';

export type NextActionId =
  | 'confirm_plan'
  | 'edit_plan'
  | 'resume_run'
  | 'inspect_failure'
  | 'retry_with_feedback'
  | 'open_pr'
  | 'continue_iteration'
  | 'provide_clarification'
  | 'continue_chat';

export interface NextAction {
  id: NextActionId;
  label: string;
  description: string;
  recommended: boolean;
  prompt?: string;
}

const NEXT_ACTIONS_MARKER = '## Suggested Next Steps';

function pushAction(
  actions: NextAction[],
  action: NextAction,
): void {
  if (!actions.some((a) => a.id === action.id)) actions.push(action);
}

export function deriveNextActions(run: RunResult): NextAction[] {
  const actions: NextAction[] = [];
  const threadKind = run.threadKind ?? 'ask';
  const verificationPassed = Boolean(run.verificationResult?.passed);
  const hasEdits = (run.fileEdits?.length ?? 0) > 0;
  const hasReviewFeedback = Boolean(run.reviewFeedback && run.reviewFeedback.trim());
  const hasPr =
    hasSuccessfulPrToolCall(run.toolCallHistory ?? []) ||
    run.messages.some((m) => m.role === 'assistant' && /PR:\s*https?:\/\//i.test(m.content));

  if (run.phase === 'awaiting_confirmation') {
    pushAction(actions, {
      id: 'confirm_plan',
      label: 'Confirm plan',
      description: 'Approve the generated plan and continue execution.',
      recommended: true,
      prompt: 'Looks good, proceed with this plan.',
    });
    pushAction(actions, {
      id: 'edit_plan',
      label: 'Edit plan',
      description: 'Adjust plan scope before code changes begin.',
      recommended: false,
      prompt: 'Revise the plan: narrow scope to the critical files only.',
    });
    return actions;
  }

  if (run.phase === 'paused') {
    pushAction(actions, {
      id: 'resume_run',
      label: 'Resume run',
      description: 'Continue execution from the paused step.',
      recommended: true,
      prompt: 'Resume and continue from the current step.',
    });
    return actions;
  }

  if (run.phase === 'error') {
    pushAction(actions, {
      id: 'inspect_failure',
      label: 'Inspect failure',
      description: 'Review the error and tool output before retrying.',
      recommended: true,
      prompt: 'Summarize the failure root cause and propose a concrete fix plan.',
    });
    pushAction(actions, {
      id: 'retry_with_feedback',
      label: 'Retry with fix',
      description: 'Retry run with explicit feedback constraints.',
      recommended: false,
      prompt: 'Retry this task and fix the reported failure first.',
    });
    return actions;
  }

  if (run.phase !== 'done') return actions;

  if (threadKind === 'ask') {
    pushAction(actions, {
      id: 'continue_chat',
      label: 'Continue chat',
      description: 'Ask a follow-up question in the same thread.',
      recommended: true,
      prompt: 'Continue with the next question.',
    });
    return actions;
  }

  if (!verificationPassed || hasReviewFeedback || Boolean(run.error)) {
    pushAction(actions, {
      id: 'retry_with_feedback',
      label: 'Retry with feedback',
      description: 'Run again with tighter constraints from verification/review.',
      recommended: true,
      prompt: 'Retry and fix all verification/review issues before completion.',
    });
    return actions;
  }

  if (hasEdits && !hasPr) {
    pushAction(actions, {
      id: 'open_pr',
      label: 'Open PR',
      description: 'Commit and open a draft PR for this completed change.',
      recommended: true,
      prompt: 'Open a draft PR for these completed changes.',
    });
  }

  if (hasEdits) {
    pushAction(actions, {
      id: 'continue_iteration',
      label: 'Continue iteration',
      description: 'Apply a follow-up improvement on top of current changes.',
      recommended: !hasPr,
      prompt: 'Continue with a second pass focused on cleanup and edge cases.',
    });
  } else {
    pushAction(actions, {
      id: 'provide_clarification',
      label: 'Clarify scope',
      description: 'No file changes detected; clarify desired modifications.',
      recommended: true,
      prompt: 'No files changed. Here is the exact change I need: ...',
    });
  }

  return actions;
}

export function appendNextActionsToAssistantMessage(
  messages: LLMMessage[],
  actions: NextAction[] | undefined,
): LLMMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  if (!Array.isArray(actions) || actions.length === 0) return messages;
  // Avoid cluttering normal chat replies with boilerplate follow-up hints.
  if (actions.every((a) => a.id === 'continue_chat')) return messages;

  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const m = out[i];
    if (m?.role !== 'assistant') continue;
    if (m.content.includes(NEXT_ACTIONS_MARKER)) return out;

    const lines = [m.content.trim(), '', NEXT_ACTIONS_MARKER];
    const top = actions.slice(0, 3);
    for (const action of top) {
      const rec = action.recommended ? ' [recommended]' : '';
      lines.push(`- ${action.label}${rec}: ${action.description}`);
      if (action.prompt) {
        lines.push(`  Prompt: ${action.prompt}`);
      }
    }
    out[i] = { ...m, content: lines.join('\n') };
    return out;
  }
  return out;
}
