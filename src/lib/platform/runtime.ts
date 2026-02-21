import type { PlatformEnv } from './types';

let runtimeEnv: PlatformEnv | null = null;

/**
 * Set the active platform environment for the current runtime.
 * This is used to provide bindings when running on Cloudflare Workers.
 */
export function setRuntimeEnv(env: PlatformEnv): void {
  runtimeEnv = env;
}

/**
 * Get the active runtime platform environment, if set.
 */
export function getRuntimeEnv(): PlatformEnv | null {
  return runtimeEnv;
}
