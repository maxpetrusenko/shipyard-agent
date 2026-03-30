import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  pickDirectory: vi.fn(),
}));

vi.mock('../../src/server/native-dialogs.js', () => ({
  pickDirectory: mocks.pickDirectory,
}));

import { createApp } from '../../src/app.js';
import { ProjectInstructionLoop } from '../../src/runtime/project-loop.js';

let server: Server;
let baseUrl: string;
let rootDir: string;
let projectsFile: string;
let loop: ProjectInstructionLoop;

beforeEach(async () => {
  mocks.pickDirectory.mockReset();
  rootDir = mkdtempSync(join(tmpdir(), 'shipyard-project-picker-'));
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

describe('project directory picker route', () => {
  it('returns picked directory path', async () => {
    mocks.pickDirectory.mockReturnValue({ cancelled: false, workDir: '/Users/max/Desktop/Gauntlet/ship2' });

    const res = await fetch(`${baseUrl}/api/projects/pick-directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDir: '/Users/max/Desktop/Gauntlet' }),
    });

    expect(res.status).toBe(200);
    expect(mocks.pickDirectory).toHaveBeenCalledWith('/Users/max/Desktop/Gauntlet');
    expect(await res.json()).toEqual({
      cancelled: false,
      workDir: '/Users/max/Desktop/Gauntlet/ship2',
    });
  });

  it('returns cancelled when picker is dismissed', async () => {
    mocks.pickDirectory.mockReturnValue({ cancelled: true });

    const res = await fetch(`${baseUrl}/api/projects/pick-directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true, workDir: null });
  });
});
