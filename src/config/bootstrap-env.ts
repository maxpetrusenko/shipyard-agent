/**
 * Load `.env` exactly once, even when modules are imported without going
 * through the main server entrypoint.
 */

import dotenv from 'dotenv';

let envLoaded = false;

export function ensureEnvLoaded(): void {
  if (envLoaded) return;
  dotenv.config();
  envLoaded = true;
}
