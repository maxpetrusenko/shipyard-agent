/**
 * Resolved work directory for the target repo (same default as `loadEnv().SHIPYARD_WORK_DIR`).
 */
export let WORK_DIR = process.env['SHIPYARD_WORK_DIR'] ?? process.cwd();

export function setWorkDir(nextWorkDir: string): void {
  WORK_DIR = nextWorkDir;
  process.env['SHIPYARD_WORK_DIR'] = nextWorkDir;
}
