import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../../src/app.js';
import { ProjectInstructionLoop } from '../../src/runtime/project-loop.js';

let server: Server;
let baseUrl: string;
let rootDir: string;
let projectsFile: string;
let loop: ProjectInstructionLoop;

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), 'shipyard-project-routes-'));
  mkdirSync(join(rootDir, 'ship-agent'), { recursive: true });
  projectsFile = join(rootDir, 'projects.json');
  loop = new ProjectInstructionLoop({
    workDir: join(rootDir, 'ship-agent'),
    projectsFile,
  });
  const app = createApp(loop);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('project routes', () => {
  it('creates and lists projects', async () => {
    const createRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Ship 2' }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.id).toContain('ship-2');
    expect(created.workDir).toContain('/ship-2');

    const listRes = await fetch(`${baseUrl}/api/projects`);
    expect(listRes.status).toBe(200);
    const projects = await listRes.json();
    expect(projects.some((project: any) => project.id === created.id)).toBe(true);
  });

  it('creates missing project directories from workDir only', async () => {
    const workDir = join(rootDir, 'ship-3');
    const createRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workDir }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.label).toBe('ship-3');
    expect(created.workDir).toBe(workDir);
    expect(existsSync(workDir)).toBe(true);
  });

  it('submits runs into the selected project workdir', async () => {
    const projectRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Ship Scoped' }),
    });
    const project = await projectRes.json();

    const runRes = await fetch(`${baseUrl}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'hi',
        uiMode: 'ask',
        projectContext: {
          projectId: project.id,
          projectLabel: project.label,
        },
      }),
    });
    expect(runRes.status).toBe(200);
    const run = await runRes.json();
    expect(run.projectContext).toEqual({
      projectId: project.id,
      projectLabel: project.label,
    });
    expect(run.workDir).toBe(project.workDir);
  });

  it('returns per-project queue status details', async () => {
    const projectRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Ship 2' }),
    });
    const project = await projectRes.json();

    const statusRes = await fetch(`${baseUrl}/api/status`);
    expect(statusRes.status).toBe(200);
    const status = await statusRes.json() as {
      activeRunIds: string[];
      projectStatuses: Array<{ projectId: string; projectLabel: string; workDir: string; processing: boolean }>;
    };

    expect(Array.isArray(status.activeRunIds)).toBe(true);
    expect(status.projectStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: 'default', processing: false }),
      expect.objectContaining({
        projectId: project.id,
        projectLabel: project.label,
        workDir: project.workDir,
        processing: false,
      }),
    ]));
  });
});
