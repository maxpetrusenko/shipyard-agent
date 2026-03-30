import type { Pool } from 'pg';
import { listRuns, loadRunFromFile, loadRunsFromFiles, pgRowToRunSummary } from './persistence.js';
import {
  InstructionLoop,
  type LiveFeedListener,
  type LoopStatus,
  type QueuedInstruction,
  type RunResult,
  type StateListener,
  type SubmitModelArg,
} from './loop.js';
import type { ContextEntry } from '../graph/state.js';
import { ProjectStore, type ProjectRecord } from '../projects/store.js';

function isSubmitOptions(arg: SubmitModelArg): arg is Exclude<SubmitModelArg, string | undefined> {
  return Boolean(arg && typeof arg === 'object');
}

export interface ProjectQueueStatus extends LoopStatus {
  projectId: string;
  projectLabel: string;
  workDir: string;
}

export interface ProjectAggregateStatus extends LoopStatus {
  activeRunIds: string[];
  activeProjectIds: string[];
  projectStatuses: ProjectQueueStatus[];
}

export class ProjectInstructionLoop extends InstructionLoop {
  private readonly projectStore: ProjectStore;
  private readonly projectLoops = new Map<string, InstructionLoop>();
  private readonly forwardedStateListeners = new Set<StateListener>();
  private readonly forwardedLiveFeedListeners = new Set<LiveFeedListener>();
  private readonly sharedContexts = new Map<string, ContextEntry>();
  private pgPool: Pool | null = null;

  constructor(options?: { workDir?: string; projectsFile?: string }) {
    super({ workDir: options?.workDir, loadPersistedRuns: false });
    this.projectStore = new ProjectStore({
      defaultWorkDir: options?.workDir,
      filePath: options?.projectsFile,
    });
    const defaultProject = this.projectStore.list()[0]!;
    super.setWorkDir(defaultProject.workDir);
    this.ensureProjectLoop(defaultProject.id);
  }

  override setPool(pool: Pool): void {
    this.pgPool = pool;
    for (const loop of this.projectLoops.values()) loop.setPool(pool);
  }

  override getWorkDir(): string {
    return this.projectStore.list()[0]?.workDir ?? super.getWorkDir();
  }

  listProjects(): ProjectRecord[] {
    return this.projectStore.list();
  }

  createProject(input: { label: string; slug?: string; workDir?: string }): ProjectRecord {
    const project = this.projectStore.create(input);
    this.ensureProjectLoop(project.id);
    return project;
  }

  setDefaultProjectWorkDir(workDir: string, label?: string): ProjectRecord {
    const project = this.projectStore.setDefaultWorkDir(workDir, label);
    super.setWorkDir(project.workDir);
    this.ensureProjectLoop(project.id).setWorkDir(project.workDir);
    return project;
  }

  override onStateChange(fn: StateListener): () => void {
    this.forwardedStateListeners.add(fn);
    return () => this.forwardedStateListeners.delete(fn);
  }

  override onLiveFeed(fn: LiveFeedListener): () => void {
    this.forwardedLiveFeedListeners.add(fn);
    return () => this.forwardedLiveFeedListeners.delete(fn);
  }

  override injectContext(entry: ContextEntry): void {
    this.sharedContexts.set(entry.label, entry);
    for (const loop of this.projectLoops.values()) loop.injectContext(entry);
  }

  override removeContext(label: string): boolean {
    const existed = this.sharedContexts.delete(label);
    for (const loop of this.projectLoops.values()) loop.removeContext(label);
    return existed;
  }

  override getContexts(): Array<{ label: string; content: string; source: string }> {
    return Array.from(this.sharedContexts.values());
  }

  override submit(
    instruction: string,
    contexts?: QueuedInstruction['contexts'],
    confirmPlan?: boolean,
    runMode?: 'auto' | 'chat' | 'code',
    modelArg?: SubmitModelArg,
  ): string {
    const project = this.resolveProjectFromSubmit(modelArg);
    const loop = this.ensureProjectLoop(project.id);
    const nextArg = isSubmitOptions(modelArg)
      ? {
        ...modelArg,
        projectContext: {
          projectId: project.id,
          projectLabel: project.label,
        },
      }
      : modelArg;
    return loop.submit(instruction, contexts, confirmPlan, runMode, nextArg);
  }

  override followUpThread(
    runId: string,
    instruction: string,
    modelArg?: SubmitModelArg,
  ): boolean {
    const loop = this.resolveLoopForRun(runId);
    return loop ? loop.followUpThread(runId, instruction, modelArg) : false;
  }

  override resume(runId: string): string | null {
    const loop = this.resolveLoopForRun(runId);
    return loop ? loop.resume(runId) : null;
  }

  override getRun(runId: string): RunResult | undefined {
    for (const loop of this.projectLoops.values()) {
      const run = loop.getRun(runId);
      if (run) return run;
    }
    return loadRunFromFile(runId) ?? undefined;
  }

  override async deleteRun(
    runId: string,
  ): Promise<{ ok: true } | { ok: false; error: string; code: 'active' | 'not_found' }> {
    const loop = this.resolveLoopForRun(runId) ?? this.ensureProjectLoop('default');
    return loop.deleteRun(runId);
  }

  override confirmPlan(
    runId: string,
    editedSteps?: Array<{ index: number; description: string; files: string[] }>,
  ): boolean {
    const loop = this.resolveLoopForRun(runId);
    return loop ? loop.confirmPlan(runId, editedSteps) : false;
  }

  override getAllRuns(): RunResult[] {
    const merged = new Map<string, RunResult>();
    for (const run of loadRunsFromFiles()) merged.set(run.runId, run);
    for (const loop of this.projectLoops.values()) {
      for (const run of loop.getAllRuns()) merged.set(run.runId, run);
    }
    return Array.from(merged.values());
  }

  override async getRunsForListingAsync(limit: number, offset = 0): Promise<RunResult[]> {
    const merged = new Map<string, RunResult>();
    for (const run of this.getAllRuns()) merged.set(run.runId, run);
    if (this.pgPool) {
      const rows = await listRuns(this.pgPool, Math.max(limit + offset, 200));
      for (const row of rows) {
        const run = pgRowToRunSummary(row);
        if (!merged.has(run.runId)) merged.set(run.runId, run);
      }
    }
    return Array.from(merged.values())
      .sort((left, right) => (right.savedAt ?? '').localeCompare(left.savedAt ?? ''))
      .slice(offset, offset + limit);
  }

  override getStatus(): ProjectAggregateStatus {
    const projectStatuses = this.projectStore.list().map((project) => ({
      projectId: project.id,
      projectLabel: project.label,
      workDir: project.workDir,
      ...this.ensureProjectLoop(project.id).getStatus(),
    }));
    const active = projectStatuses.filter((status) => status.processing);
    const activeRunIds = active
      .map((status) => status.currentRunId)
      .filter((runId): runId is string => typeof runId === 'string' && runId.length > 0);
    return {
      processing: active.length > 0,
      currentRunId: activeRunIds[0] ?? null,
      queueLength: projectStatuses.reduce((sum, status) => sum + status.queueLength, 0),
      pauseRequested: projectStatuses.some((status) => status.pauseRequested),
      activeRunIds,
      activeProjectIds: active.map((status) => status.projectId),
      projectStatuses,
    };
  }

  override cancel(source: NonNullable<RunResult['cancellation']>['source'] = 'unknown'): boolean {
    let cancelled = false;
    for (const loop of this.projectLoops.values()) {
      cancelled = loop.cancel(source) || cancelled;
    }
    return cancelled;
  }

  override requestPause(): boolean {
    let paused = false;
    for (const loop of this.projectLoops.values()) {
      paused = loop.requestPause() || paused;
    }
    return paused;
  }

  override resumeFromPause(): void {
    for (const loop of this.projectLoops.values()) loop.resumeFromPause();
  }

  private resolveProjectFromSubmit(modelArg?: SubmitModelArg): ProjectRecord {
    if (isSubmitOptions(modelArg) && modelArg.projectContext?.projectId) {
      const existing = this.projectStore.get(modelArg.projectContext.projectId);
      if (existing) return existing;
    }
    return this.projectStore.list()[0]!;
  }

  private resolveProjectForRun(runId: string): ProjectRecord | null {
    const run = this.getRun(runId);
    if (!run) return null;
    if (run.projectContext?.projectId) {
      return this.projectStore.get(run.projectContext.projectId)
        ?? this.projectStore.upsertRuntimeProject({
          projectId: run.projectContext.projectId,
          label: run.projectContext.projectLabel,
          workDir: run.workDir ?? this.getWorkDir(),
        });
    }
    if (run.workDir) {
      return this.projectStore.getByWorkDir(run.workDir)
        ?? this.projectStore.upsertRuntimeProject({
          label: run.projectContext?.projectLabel ?? null,
          workDir: run.workDir,
        });
    }
    return this.projectStore.list()[0] ?? null;
  }

  private resolveLoopForRun(runId: string): InstructionLoop | null {
    const project = this.resolveProjectForRun(runId);
    return project ? this.ensureProjectLoop(project.id) : null;
  }

  private ensureProjectLoop(projectId: string): InstructionLoop {
    const project = this.projectStore.get(projectId);
    if (!project) return this.ensureProjectLoop('default');
    const existing = this.projectLoops.get(project.id);
    if (existing) {
      existing.setWorkDir(project.workDir);
      return existing;
    }
    const loop = new InstructionLoop({
      workDir: project.workDir,
      loadPersistedRuns: false,
      registerRuntimeControls: false,
    });
    if (this.pgPool) loop.setPool(this.pgPool);
    for (const entry of this.sharedContexts.values()) loop.injectContext(entry);
    loop.onStateChange((state) => {
      for (const listener of this.forwardedStateListeners) listener(state);
    });
    loop.onLiveFeed((event) => {
      for (const listener of this.forwardedLiveFeedListeners) listener(event);
    });
    this.projectLoops.set(project.id, loop);
    return loop;
  }
}
