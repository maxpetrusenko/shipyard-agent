/**
 * Resolved work directory for the target repo (same default as `loadEnv().SHIPYARD_WORK_DIR`).
 */
export const WORK_DIR = process.env['SHIPYARD_WORK_DIR'] ?? process.cwd();
