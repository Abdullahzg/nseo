// Integration tests against the real schema (needs DATABASE_URL → local Supabase Postgres).
// These prove the structural guarantees the product depends on:
//   - a guest campaign cannot be real (CHECK constraint)
//   - nothing on a demo/guest campaign can ever be scheduled for real sending (trigger)
//   - the budget can never be overspent under concurrency (commit_budget)
//   - only one tick can hold a campaign's lock (acquire_tick_lock)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const URL = process.env.DATABASE_URL;

// A DATABASE_URL that points at nothing is the normal case: CI has no Postgres, and a developer
// who has not started the local Supabase still has the variable sitting in .env.local. Probe once
// and skip the suite when the database is not actually there, so an absent database reads as
// "integration tests skipped" rather than a failing build.
let reachable = false;
if (URL) {
  try {
    const probe = new pg.Client({ connectionString: URL, connectionTimeoutMillis: 2000 });
    await probe.connect();
    await probe.end();
    reachable = true;
  } catch {
    reachable = false;
  }
}

const d = describe.skipIf(!reachable);

d("database walls", () => {
  let c: pg.Client;
  const ids: string[] = [];
  beforeAll(async () => { c = new pg.Client({ connectionString: URL }); await c.connect(); });
  afterAll(async () => { if (ids.length) await c.query("delete from campaigns where id = any($1)", [ids]); await c.end(); });

  async function mkCampaign(over: Record<string, unknown> = {}): Promise<string> {
    const cols = { name: "t", keywords: JSON.stringify(["a", "b", "c"]), desired_deals: 2, budget_total: 100, max_per_deal: 50, demo_mode: true, phase: "monitoring", ...over };
    const keys = Object.keys(cols);
    const r = await c.query(`insert into campaigns (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`, Object.values(cols));
    ids.push(r.rows[0].id);
    return r.rows[0].id;
  }

  it("a guest campaign with demo_mode=false is rejected by the CHECK constraint", async () => {
    await expect(mkCampaign({ guest_id: "g_test", demo_mode: false })).rejects.toThrow(/guest_campaigns_are_demo/);
  });

  it("scheduling a real send on a demo campaign is rejected by the trigger", async () => {
    const id = await mkCampaign({ demo_mode: true });
    await expect(c.query("insert into outreach_emails (campaign_id, kind, status, to_email) values ($1,'initial','scheduled','x@y.z')", [id])).rejects.toThrow(/cannot schedule real email/);
    // and flipping an existing row to scheduled is also blocked
    const r = await c.query("insert into outreach_emails (campaign_id, kind, status, to_email) values ($1,'initial','sent','x@y.z') returning id", [id]);
    await expect(c.query("update outreach_emails set status='scheduled' where id=$1", [r.rows[0].id])).rejects.toThrow(/cannot schedule real email/);
  });

  it("scheduling a real send on a real owner campaign is allowed", async () => {
    const id = await mkCampaign({ demo_mode: false, owner_email: "o@x" });
    await expect(c.query("insert into outreach_emails (campaign_id, kind, status, to_email) values ($1,'initial','scheduled','x@y.z')", [id])).resolves.toBeTruthy();
  });

  it("commit_budget never overspends under concurrency", async () => {
    const id = await mkCampaign({ budget_total: 100 });
    const clients = await Promise.all(Array.from({ length: 6 }, async () => { const k = new pg.Client({ connectionString: URL }); await k.connect(); return k; }));
    try {
      const results = await Promise.all(clients.map((k) => k.query("select commit_budget($1, 30) as ok", [id]).then((r) => r.rows[0].ok as boolean)));
      expect(results.filter(Boolean).length).toBe(3); // 3 × 30 = 90 ≤ 100; a 4th would be 120
      const { rows } = await c.query("select budget_used from campaigns where id=$1", [id]);
      expect(Number(rows[0].budget_used)).toBe(90);
    } finally { await Promise.all(clients.map((k) => k.end())); }
  });

  it("acquire_tick_lock admits exactly one concurrent holder", async () => {
    const id = await mkCampaign();
    const clients = await Promise.all(Array.from({ length: 5 }, async () => { const k = new pg.Client({ connectionString: URL }); await k.connect(); return k; }));
    try {
      const results = await Promise.all(clients.map((k) => k.query("select acquire_tick_lock($1, 60) as ok", [id]).then((r) => r.rows[0].ok as boolean)));
      expect(results.filter(Boolean).length).toBe(1);
      await c.query("update campaigns set tick_lock_until = now() - interval '1 second' where id=$1", [id]);
      const again = await c.query("select acquire_tick_lock($1, 60) as ok", [id]);
      expect(again.rows[0].ok).toBe(true);
    } finally { await Promise.all(clients.map((k) => k.end())); }
  });

  it("acquire_thread_lock admits exactly one negotiator per thread (Needs-you answer vs inbox reply vs tick)", async () => {
    const id = await mkCampaign();
    const { rows } = await c.query("insert into outreach_emails (campaign_id, kind, subject, body, status) values ($1, 'initial', 's', 'b', 'sent') returning id", [id]);
    const emailId = rows[0].id;
    const clients = await Promise.all(Array.from({ length: 5 }, async () => { const k = new pg.Client({ connectionString: URL }); await k.connect(); return k; }));
    try {
      const results = await Promise.all(clients.map((k) => k.query("select acquire_thread_lock($1, 60) as ok", [emailId]).then((r) => r.rows[0].ok as boolean)));
      expect(results.filter(Boolean).length).toBe(1);
      await c.query("update outreach_emails set thread_lock_until = null where id=$1", [emailId]);
      expect((await c.query("select acquire_thread_lock($1, 60) as ok", [emailId])).rows[0].ok).toBe(true);
    } finally { await Promise.all(clients.map((k) => k.end())); }
  });

  it("a send run claims a row atomically: only one of two concurrent runs may send it", async () => {
    const id = await mkCampaign();
    await c.query("update campaigns set demo_mode=false, guest_id=null, owner_email='o@x' where id=$1", [id]);
    const { rows } = await c.query("insert into outreach_emails (campaign_id, kind, subject, body, status, scheduled_at) values ($1, 'initial', 's', 'b', 'scheduled', now()) returning id", [id]);
    const emailId = rows[0].id;
    const clients = await Promise.all(Array.from({ length: 4 }, async () => { const k = new pg.Client({ connectionString: URL }); await k.connect(); return k; }));
    try {
      const results = await Promise.all(clients.map((k) => k.query("update outreach_emails set status='sending', claimed_at=now() where id=$1 and status='scheduled' returning id", [emailId]).then((r) => r.rowCount ?? 0)));
      expect(results.reduce((s, n) => s + n, 0)).toBe(1);
    } finally { await Promise.all(clients.map((k) => k.end())); }
  });

  it("add_tokens accumulates the daily total", async () => {
    const key = `tokens:test-${Date.now()}`;
    await c.query("select add_tokens($1, 100)", [key]);
    const r = await c.query("select add_tokens($1, 50) as total", [key]);
    expect(Number(r.rows[0].total)).toBe(150);
    await c.query("delete from app_state where key=$1", [key]);
  });
});
