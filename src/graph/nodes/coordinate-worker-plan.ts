import { runWorker, type WorkerResult } from '../../multi-agent/worker.js';
import { runVerification } from './verify.js';
import type {
  ContextEntry,
  FileEdit,
  LLMMessage,
  ShipyardStateType,
  ToolCallRecord,
  VerificationResult,
} from '../state.js';

const MAX_STEP_REPAIR_ATTEMPTS = 2;
const VERIFY_OUTPUT_LIMIT = 4_000;

type WorkerSummary = {
  subtaskId: string;
  phase: 'done' | 'error';
  editCount: number;
  toolCallCount: number;
  error: string | null;
  durationMs: number;
  stepIndex: number;
  attempt: number;
  kind: 'implement' | 'repair';
  verificationPassed: boolean;
  verificationErrors: number;
};

function mergeTokenUsage(
  total: { input: number; output: number; cacheRead?: number; cacheCreation?: number },
  delta: WorkerResult['tokenUsage'],
): void {
  if (!delta) return;
  total.input += delta.input;
  total.output += delta.output;
  total.cacheRead = (total.cacheRead ?? 0) + (delta.cacheRead ?? 0);
  total.cacheCreation = (total.cacheCreation ?? 0) + (delta.cacheCreation ?? 0);
}

function mergeOverlaySnapshots(
  current: string | null,
  incoming: string | null,
): string | null {
  if (!incoming) return current;
  const merged = current
    ? JSON.parse(current) as Record<string, string | null>
    : {};
  const next = JSON.parse(incoming) as Record<string, string | null>;
  for (const [filePath, content] of Object.entries(next)) {
    if (!(filePath in merged)) {
      merged[filePath] = content;
    }
  }
  return Object.keys(merged).length > 0 ? JSON.stringify(merged) : null;
}

function buildPlanContext(
  state: ShipyardStateType,
  stepIndex: number,
): ContextEntry {
  const lines = [
    `Original instruction: ${state.instruction}`,
    `Current step: ${stepIndex + 1}/${state.steps.length}`,
    ...state.steps.map((step, idx) =>
      `${idx + 1}. [${idx === stepIndex ? 'current' : step.status}] ${step.description}`,
    ),
  ];
  return {
    label: 'Coordinator Plan',
    content: lines.join('\n'),
    source: 'system',
  };
}

function buildWorkerInstruction(
  state: ShipyardStateType,
  stepIndex: number,
): string {
  const step = state.steps[stepIndex]!;
  const files = step.files.length > 0 ? step.files.join('\n- ') : 'No explicit file list';
  return [
    `Execute exactly plan step ${stepIndex + 1}/${state.steps.length}.`,
    '',
    `Step goal: ${step.description}`,
    '',
    'Primary files in scope:',
    `- ${files}`,
    '',
    'Requirements:',
    '- finish this vertical slice end to end',
    '- include tests or test updates needed for this slice',
    '- keep changes scoped; only touch adjacent files when required for correctness',
    '- stop when this step is complete and repository is ready for orchestrator verification',
  ].join('\n');
}

function buildRepairInstruction(
  state: ShipyardStateType,
  stepIndex: number,
  verification: VerificationResult,
  attempt: number,
): string {
  const step = state.steps[stepIndex]!;
  const failures = [
    verification.typecheck_output ?? '',
    verification.test_output ?? '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, VERIFY_OUTPUT_LIMIT);

  return [
    `Repair verification failures for plan step ${stepIndex + 1}/${state.steps.length}.`,
    '',
    `Step goal: ${step.description}`,
    `Repair attempt: ${attempt}/${MAX_STEP_REPAIR_ATTEMPTS}`,
    '',
    'Current repository already contains the previous worker changes.',
    'Make the minimum fixes needed so verification passes for this step.',
    '',
    'Verification failures:',
    failures || 'Unknown verification failure.',
  ].join('\n');
}

function summarizeVerification(verification: VerificationResult): string {
  const parts = [
    `passed=${verification.passed}`,
    `errors=${verification.error_count}`,
  ];
  if (typeof verification.newErrorCount === 'number') {
    parts.push(`newErrors=${verification.newErrorCount}`);
  }
  return parts.join(', ');
}

async function verifyCurrentWorkspace(
  state: ShipyardStateType,
  currentStepIndex: number,
  fileEdits: FileEdit[],
  toolCallHistory: ToolCallRecord[],
  fileOverlaySnapshots: string | null,
): Promise<Partial<ShipyardStateType>> {
  return runVerification({
    ...state,
    currentStepIndex,
    fileEdits,
    toolCallHistory,
    fileOverlaySnapshots,
    executionIssue: null,
  }, {
    runTests: 'always',
  });
}

function toWorkerSummary(
  result: WorkerResult,
  stepIndex: number,
  attempt: number,
  kind: 'implement' | 'repair',
  verification: VerificationResult | null,
): WorkerSummary {
  return {
    subtaskId: result.subtaskId,
    phase: result.phase,
    editCount: result.fileEdits.length,
    toolCallCount: result.toolCallHistory.length,
    error: result.error,
    durationMs: result.durationMs,
    stepIndex,
    attempt,
    kind,
    verificationPassed: verification?.passed ?? false,
    verificationErrors: verification?.error_count ?? 0,
  };
}

export async function runCoordinatedWorkerPlan(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const newMessages: LLMMessage[] = [...state.messages];

  if (state.forceSequential) {
    newMessages.push({
      role: 'assistant',
      content: '[Coordinator] forceSequential active; falling through to single-agent execute.',
    });
    return { phase: 'executing', messages: newMessages, workerResults: [] };
  }

  let steps = state.steps.map((step) => ({ ...step }));
  let currentStepIndex = Math.max(
    state.currentStepIndex,
    steps.findIndex((step, idx) => idx >= state.currentStepIndex && step.status !== 'done'),
  );
  if (currentStepIndex < 0) currentStepIndex = state.steps.length > 0 ? state.steps.length - 1 : 0;

  const fileEdits: FileEdit[] = [...state.fileEdits];
  const toolCallHistory: ToolCallRecord[] = [...state.toolCallHistory];
  const workerResults: WorkerSummary[] = [];
  const tokenUsage = {
    input: state.tokenUsage?.input ?? 0,
    output: state.tokenUsage?.output ?? 0,
    cacheRead: state.tokenUsage?.cacheRead ?? 0,
    cacheCreation: state.tokenUsage?.cacheCreation ?? 0,
  };
  let fileOverlaySnapshots = state.fileOverlaySnapshots ?? null;

  for (let stepIndex = currentStepIndex; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex];
    if (!step || step.status === 'done') continue;

    newMessages.push({
      role: 'assistant',
      content: `[Coordinator] Starting worker for step ${stepIndex + 1}/${steps.length}: ${step.description}`,
    });

    let verification: VerificationResult | null = null;

    for (let attempt = 0; attempt <= MAX_STEP_REPAIR_ATTEMPTS; attempt += 1) {
      const kind = attempt === 0 ? 'implement' : 'repair';
      const instruction = attempt === 0
        ? buildWorkerInstruction({ ...state, steps }, stepIndex)
        : buildRepairInstruction({ ...state, steps }, stepIndex, verification!, attempt);
      const result = await runWorker(
        `step-${stepIndex + 1}-${kind}-${attempt + 1}`,
        instruction,
        [...state.contexts, buildPlanContext({ ...state, steps }, stepIndex)],
        {
          modelOverride: state.modelOverride ?? null,
          modelFamily: state.modelFamily ?? null,
          modelOverrides: state.modelOverrides ?? null,
        },
      );

      fileEdits.push(...result.fileEdits);
      toolCallHistory.push(...result.toolCallHistory);
      mergeTokenUsage(tokenUsage, result.tokenUsage);
      fileOverlaySnapshots = mergeOverlaySnapshots(
        fileOverlaySnapshots,
        result.fileOverlaySnapshots,
      );

      if (result.phase === 'error') {
        workerResults.push(toWorkerSummary(result, stepIndex, attempt + 1, kind, null));
        steps = steps.map((entry, idx) =>
          idx === stepIndex ? { ...entry, status: 'failed' as const } : entry,
        );
        return {
          phase: 'verifying',
          steps,
          currentStepIndex: stepIndex,
          fileEdits,
          toolCallHistory,
          messages: [
            ...newMessages,
            {
              role: 'assistant',
              content: `[Coordinator] Worker failed on step ${stepIndex + 1}: ${result.error ?? 'unknown error'}`,
            },
          ],
          tokenUsage,
          fileOverlaySnapshots,
          workerResults,
          executionIssue: {
            kind: 'coordination',
            recoverable: true,
            message: `Worker failed on step ${stepIndex + 1}: ${result.error ?? 'unknown error'}`,
            nextAction: 'Retry planning or re-run the step with a narrower repair scope.',
            stopReason: null,
          },
        };
      }

      const verificationState = await verifyCurrentWorkspace(
        { ...state, steps },
        stepIndex,
        fileEdits,
        toolCallHistory,
        fileOverlaySnapshots,
      );
      verification = verificationState.verificationResult ?? null;
      workerResults.push(toWorkerSummary(result, stepIndex, attempt + 1, kind, verification));

      if (!verification) {
        steps = steps.map((entry, idx) =>
          idx === stepIndex ? { ...entry, status: 'failed' as const } : entry,
        );
        return {
          phase: 'error',
          steps,
          currentStepIndex: stepIndex,
          fileEdits,
          toolCallHistory,
          messages: [
            ...newMessages,
            {
              role: 'assistant',
              content: `[Coordinator] Verification failed to produce a result for step ${stepIndex + 1}.`,
            },
          ],
          tokenUsage,
          fileOverlaySnapshots,
          workerResults,
          error: 'Coordinator verification returned no result.',
        };
      }

      if (verification.passed) {
        steps = steps.map((entry, idx) =>
          idx === stepIndex ? { ...entry, status: 'done' as const } : entry,
        );
        newMessages.push({
          role: 'assistant',
          content: `[Coordinator] Step ${stepIndex + 1} verified. ${summarizeVerification(verification)}`,
        });
        break;
      }

      if (attempt === MAX_STEP_REPAIR_ATTEMPTS) {
        steps = steps.map((entry, idx) =>
          idx === stepIndex ? { ...entry, status: 'failed' as const } : entry,
        );
        return {
          phase: 'verifying',
          steps,
          currentStepIndex: stepIndex,
          fileEdits,
          toolCallHistory,
          messages: [
            ...newMessages,
            {
              role: 'assistant',
              content: `[Coordinator] Step ${stepIndex + 1} still failing verification after repairs. ${summarizeVerification(verification)}`,
            },
          ],
          tokenUsage,
          fileOverlaySnapshots,
          workerResults,
          verificationResult: verification,
          executionIssue: {
            kind: 'coordination',
            recoverable: true,
            message: `Step ${stepIndex + 1} failed verification after ${MAX_STEP_REPAIR_ATTEMPTS + 1} worker attempts.`,
            nextAction: 'Replan this step or spawn a narrower repair worker with the verification output.',
            stopReason: null,
          },
        };
      }

      newMessages.push({
        role: 'assistant',
        content: `[Coordinator] Step ${stepIndex + 1} failed verification; spawning repair worker ${attempt + 1}/${MAX_STEP_REPAIR_ATTEMPTS}. ${summarizeVerification(verification)}`,
      });
    }
  }

  return {
    phase: 'verifying',
    steps,
    currentStepIndex: steps.length > 0 ? steps.length - 1 : 0,
    fileEdits,
    toolCallHistory,
    messages: newMessages,
    tokenUsage,
    fileOverlaySnapshots,
    workerResults,
    executionIssue: null,
  };
}
