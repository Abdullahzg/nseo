import { describe, it, expect } from "vitest";
import { resilientFetch, isWakingUp } from "@/lib/db/resilient";

// PostgREST's answer while the database is still waking up.
const schemaCache = () => new Response(JSON.stringify({ code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." }), { status: 503, headers: { "content-type": "application/json" } });
const ok = (body = "[]") => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
const noSleep = async () => {};

function counting(responses: (() => Response | Promise<Response>)[]) {
  let calls = 0;
  const fn = (async () => { const r = responses[Math.min(calls, responses.length - 1)]; calls++; return r(); }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}

describe("resilientFetch (a database that is still waking up)", () => {
  it("retries a read past the schema-cache error and returns the real answer", async () => {
    const c = counting([schemaCache, schemaCache, () => ok('[{"id":1}]')]);
    const f = resilientFetch(c.fn, { sleep: noSleep });
    const res = await f("http://db/rest/v1/campaigns");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('[{"id":1}]');
    expect(c.calls()).toBe(3);
  });

  it("retries a WRITE on the schema-cache error too — that statement never ran", async () => {
    const c = counting([schemaCache, () => ok('{"id":"new"}')]);
    const f = resilientFetch(c.fn, { sleep: noSleep });
    const res = await f("http://db/rest/v1/campaigns", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(c.calls()).toBe(2);
  });

  it("never replays a write that failed with a bare 503 — it may already have been applied", async () => {
    const c = counting([() => new Response("upstream gone", { status: 503 })]);
    const f = resilientFetch(c.fn, { sleep: noSleep });
    const res = await f("http://db/rest/v1/deals", { method: "POST", body: "{}" });
    expect(res.status).toBe(503);
    expect(c.calls()).toBe(1);
  });

  it("does retry a read on a bare 503", async () => {
    const c = counting([() => new Response("upstream gone", { status: 503 }), () => ok()]);
    const f = resilientFetch(c.fn, { sleep: noSleep });
    expect((await f("http://db/rest/v1/deals")).status).toBe(200);
    expect(c.calls()).toBe(2);
  });

  it("passes an ordinary error straight through, unretried", async () => {
    const c = counting([() => new Response('{"message":"column x does not exist"}', { status: 400 })]);
    const f = resilientFetch(c.fn, { sleep: noSleep });
    expect((await f("http://db/rest/v1/campaigns")).status).toBe(400);
    expect(c.calls()).toBe(1);
  });

  it("gives up after the last try and hands back the error", async () => {
    const c = counting([schemaCache]);
    const f = resilientFetch(c.fn, { tries: 3, sleep: noSleep });
    const res = await f("http://db/rest/v1/campaigns");
    expect(res.status).toBe(503);
    expect(c.calls()).toBe(3);
  });

  it("recognises the message a person should not have to read", () => {
    expect(isWakingUp("Could not query the database for the schema cache. Retrying.")).toBe(true);
    expect(isWakingUp("duplicate key value violates unique constraint")).toBe(false);
    expect(isWakingUp(null)).toBe(false);
  });
});
