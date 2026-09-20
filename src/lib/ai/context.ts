// Per-request credentials. A tick, a plan preview or an intervention answer runs inside
// withKeys(), and every model / search call inside it uses those keys — the owner's own for real
// campaigns, the platform's for guest demos. AsyncLocalStorage keeps concurrent requests apart.
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestKeys { nebius?: string | null; tavily?: string | null; owner?: string | null }
const als = new AsyncLocalStorage<RequestKeys>();

export function withKeys<T>(keys: RequestKeys, fn: () => Promise<T>): Promise<T> { return als.run(keys, fn); }
export function currentKeys(): RequestKeys { return als.getStore() ?? {}; }

/** Owners may use the platform's Nebius key when they have not added their own (default on; set PLATFORM_KEY_FOR_OWNERS=false to require BYOK). */
export const PLATFORM_KEY_FOR_OWNERS = process.env.PLATFORM_KEY_FOR_OWNERS !== "false";

export function resolveNebiusKey(): string | null {
  const k = currentKeys();
  if (k.nebius) return k.nebius;
  if (k.owner && !PLATFORM_KEY_FOR_OWNERS) return null;
  return process.env.NEBIUS_API_KEY?.trim() || null;
}
export function resolveTavilyKey(): string | null {
  return currentKeys().tavily || process.env.TAVILY_API_KEY?.trim() || null;
}
