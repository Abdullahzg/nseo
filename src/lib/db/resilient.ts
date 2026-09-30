// Postgres is not always awake. A paused free-tier Supabase project, a laptop resuming from sleep,
// or a container restart all answer the first request with PostgREST's "Could not query the
// database for the schema cache" (PGRST002) or a bare 502/503 — and the screen that asked dead-ends
// on an error nobody can act on. Every query goes through this fetch, which waits and tries again.
//
// What may be retried, and why:
//   • PGRST002 — PostgREST could not load its schema, so the statement never ran. Safe for any
//     method, including a POST: nothing was written.
//   • 502/503/504 and network failures — the request may or may not have run, so only GET and HEAD
//     (reads) are retried. A write is never replayed; the caller sees the error.

const RETRY_STATUS = new Set([502, 503, 504]);
const SCHEMA_CACHE = /PGRST002|schema cache/i;

export interface RetryOpts { tries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void>; }

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A fetch that rides out a database still waking up. Wraps any fetch implementation. */
export function resilientFetch(inner: typeof fetch, opts: RetryOpts = {}): typeof fetch {
  const tries = opts.tries ?? 4;
  const base = opts.baseDelayMs ?? 400;
  const sleep = opts.sleep ?? wait;
  return async function retryingFetch(input: any, init?: any): Promise<Response> {
    // `input` is a URL string or a Request; only a Request carries a method of its own.
    const method = String(init?.method ?? (typeof input === "object" && input !== null ? input.method : null) ?? "GET").toUpperCase();
    const isRead = method === "GET" || method === "HEAD";
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= tries; attempt++) {
      const last = attempt === tries;
      try {
        const res = await inner(input, init);
        if (res.ok) return res;
        // A schema-cache failure comes back with PostgREST's code in the body; anything else is the
        // answer, right or wrong, and belongs to the caller.
        const body = await res.clone().text().catch(() => "");
        const retryable = SCHEMA_CACHE.test(body) || (isRead && RETRY_STATUS.has(res.status));
        if (last || !retryable) return res;
        await sleep(base * attempt);
      } catch (e) {
        lastError = e;
        if (last || !isRead) throw e;
        await sleep(base * attempt);
      }
    }
    throw lastError ?? new Error("fetch failed");
  } as typeof fetch;
}

/** True when an error from the database is "it is still waking up", not "you asked for something wrong". */
export function isWakingUp(message: string | null | undefined): boolean {
  return !!message && SCHEMA_CACHE.test(message);
}

/** What to show a person when the database is still waking up. */
export const WAKING_UP_MESSAGE = "The database is waking up — give it a few seconds and try again.";
