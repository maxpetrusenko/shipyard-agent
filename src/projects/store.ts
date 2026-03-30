import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export interface ProjectRecord {
  id: string;
  label: string;
  workDir: string;
  createdAt: string;
  updatedAt: string;
}

function defaultProjectsFilePath(): string {
  return process.env['SHIPYARD_PROJECTS_FILE']?.trim()
    || join(process.cwd(), 'results', 'projects.json');
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'project';
}

function normalizeWorkDir(workDir: string): string {
  return resolve(workDir);
}

function safeReadProjects(filePath: string): ProjectRecord[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is ProjectRecord => {
        return Boolean(
          entry
          && typeof entry === 'object'
          && typeof (entry as Record<string, unknown>)['id'] === 'string'
          && typeof (entry as Record<string, unknown>)['label'] === 'string'
          && typeof (entry as Record<string, unknown>)['workDir'] === 'string',
        );
      })
      .map((entry) => ({
        ...entry,
        workDir: normalizeWorkDir(entry.workDir),
      }));
  } catch {
    return [];
  }
}

function atomicWrite(filePath: string, projects: ProjectRecord[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(projects, null, 2)}\n`, 'utf8');
  try {
    renameSync(tempPath, filePath);
  } catch (error) {
    try { unlinkSync(tempPath); } catch {}
    throw error;
  }
}

export class ProjectStore {
  private readonly filePath: string;
  private readonly defaultWorkDir: string;

  constructor(options?: { filePath?: string; defaultWorkDir?: string }) {
    this.filePath = options?.filePath ?? defaultProjectsFilePath();
    this.defaultWorkDir = normalizeWorkDir(options?.defaultWorkDir ?? process.cwd());
  }

  list(): ProjectRecord[] {
    const projects = safeReadProjects(this.filePath);
    const defaultProject = this.ensureDefaultProjectRecord(projects);
    if (!projects.some((project) => project.id === 'default')) {
      atomicWrite(this.filePath, [defaultProject, ...projects.filter((project) => project.id !== 'default')]);
    }
    const deduped = new Map<string, ProjectRecord>();
    for (const project of [defaultProject, ...projects.filter((entry) => entry.id !== 'default')]) {
      deduped.set(project.id, project);
    }
    return Array.from(deduped.values()).sort((left, right) => {
      if (left.id === 'default') return -1;
      if (right.id === 'default') return 1;
      return left.label.localeCompare(right.label);
    });
  }

  get(projectId: string): ProjectRecord | null {
    return this.list().find((project) => project.id === projectId) ?? null;
  }

  getByWorkDir(workDir: string): ProjectRecord | null {
    const normalized = normalizeWorkDir(workDir);
    return this.list().find((project) => normalizeWorkDir(project.workDir) === normalized) ?? null;
  }

  create(input: { label: string; slug?: string; workDir?: string }): ProjectRecord {
    const label = input.label.trim();
    if (!label) throw new Error('Project label is required.');

    const existing = this.list();
    const now = new Date().toISOString();
    const requestedDir = input.workDir?.trim()
      ? normalizeWorkDir(input.workDir)
      : join(dirname(this.defaultWorkDir), this.uniqueProjectSlug(input.slug ?? label, existing));

    if (existsSync(requestedDir) && !statSync(requestedDir).isDirectory()) {
      throw new Error(`Project path is not a directory: ${requestedDir}`);
    }
    mkdirSync(requestedDir, { recursive: true });

    const id = this.uniqueProjectSlug(input.slug ?? label, existing);
    const project: ProjectRecord = {
      id,
      label,
      workDir: requestedDir,
      createdAt: now,
      updatedAt: now,
    };
    atomicWrite(this.filePath, [...existing.filter((entry) => entry.id !== 'default'), project]);
    return project;
  }

  upsertRuntimeProject(input: { projectId?: string | null; label?: string | null; workDir: string }): ProjectRecord {
    const normalizedWorkDir = normalizeWorkDir(input.workDir);
    const current = (input.projectId ? this.get(input.projectId) : null)
      ?? this.getByWorkDir(normalizedWorkDir);
    if (current) return current;

    const existing = this.list();
    const now = new Date().toISOString();
    const label = input.label?.trim() || basename(normalizedWorkDir) || 'Project';
    const id = this.uniqueProjectSlug(input.projectId ?? label, existing, input.projectId ?? undefined);
    const project: ProjectRecord = {
      id,
      label,
      workDir: normalizedWorkDir,
      createdAt: now,
      updatedAt: now,
    };
    atomicWrite(this.filePath, [...existing.filter((entry) => entry.id !== 'default'), project]);
    return project;
  }

  setDefaultWorkDir(workDir: string, label?: string): ProjectRecord {
    const normalized = normalizeWorkDir(workDir);
    const projects = safeReadProjects(this.filePath).filter((entry) => entry.id !== 'default');
    const defaultProject = this.buildDefaultProject(normalized, label);
    atomicWrite(this.filePath, [defaultProject, ...projects]);
    return defaultProject;
  }

  private ensureDefaultProjectRecord(projects: ProjectRecord[]): ProjectRecord {
    const existing = projects.find((entry) => entry.id === 'default');
    if (existing) return existing;
    return this.buildDefaultProject(this.defaultWorkDir);
  }

  private buildDefaultProject(workDir: string, label?: string): ProjectRecord {
    const now = new Date().toISOString();
    return {
      id: 'default',
      label: label?.trim() || basename(workDir) || 'Default Project',
      workDir,
      createdAt: now,
      updatedAt: now,
    };
  }

  private uniqueProjectSlug(seed: string, existing: ProjectRecord[], preferredId?: string): string {
    const taken = new Set(existing.map((project) => project.id));
    const base = slugify(preferredId ?? seed);
    if (!taken.has(base)) return base;
    let index = 2;
    while (taken.has(`${base}-${index}`)) index += 1;
    return `${base}-${index}`;
  }
}
