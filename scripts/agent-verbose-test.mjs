// Verbose agent-by-agent test — runs each phase individually and prints what happened.
// Self-terminates. Exit code 0 = all pass.
const BASE = process.env.APP_URL || "http://localhost:3100";
const SECRET = process.env.CRON_SECRET || "dev-cron-secret";
const H = { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const PG = { host: "127.0.0.1", port: 5433, database: "seo", user: "postgres", password: "seo123" };
const results = [];
function check(name, ok, detail = "") { results.push({ name, ok, detail }); console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sql(q) { const { Client } = await import("pg"); const c = new Client(PG); await c.connect(); try { return (await c.query(q)).rows; } finally { await c.end(); } }
async function api(path, method = "GET", body, timeoutMs = 120000) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const json = await res.json().catch(() => null);
  const ms = Date.now() - t0;
  return { status: res.status, json, ms };
}

(async () => {
  console.log("=== VERBOSE AGENT TEST ===\n");

  // ─── SETUP ───
  console.log("[SETUP] Creating demo campaign...");
  const rows = await sql(`INSERT INTO campaigns (name,keywords,status,phase,owner_email,website_url,objective,budget_total,budget_used,currency,min_dr,geos,desired_deals,max_per_deal,autonomy_mode,demo_mode)
    VALUES ('AgentTest ${Date.now()}', ARRAY['AI photo editor','photo restoration'], 'running', 'planning',
      'test@local', 'https://imagine.example', 'Acquire 2 placements', 1000, 0, 'USD', 30, ARRAY['US','UK'], 2, 300, 'autonomous', true)
    RETURNING id`);
  const cid = rows[0].id;
  console.log(`  Campaign ID: ${cid}\n`);

  // ─── PHASE 1: DISCOVERY ───
  console.log("[AGENT 1] DISCOVERY AGENT — finding prospects via demo fixtures...");
  const disc1 = await api(`/api/campaigns/${cid}/tick`, "POST", null, 60000);
  console.log(`  Response: ${JSON.stringify(disc1.json)}`);
  console.log(`  Time: ${disc1.ms}ms`);
  check("discovery: tick returns ok", disc1.json?.ok === true, `phase_after=${disc1.json?.phase_after}`);
  const p1 = await sql(`SELECT count(*) as n, status FROM campaign_prospects WHERE campaign_id='${cid}' GROUP BY status`);
  console.log(`  Prospects created: ${JSON.stringify(p1)}`);
  check("discovery: prospects > 0", p1.reduce((s, r) => s + Number(r.n), 0) > 0);

  // ─── PHASE 2: QUALIFICATION ───
  console.log("\n[AGENT 2] QUALIFICATION AGENT — scoring prospects...");
  for (let i = 0; i < 3; i++) {
    const q = await api(`/api/campaigns/${cid}/tick`, "POST", null, 60000);
    console.log(`  Tick ${i+1}: phase=${q.json?.phase_after} action=${q.json?.action} (${q.ms}ms)`);
    if (q.json?.phase_after !== "qualifying") break;
  }
  const p2 = await sql(`SELECT status, count(*) as n FROM campaign_prospects WHERE campaign_id='${cid}' GROUP BY status`);
  console.log(`  After qualification: ${JSON.stringify(p2)}`);
  const qualified = p2.find(r => r.status === "qualified");
  check("qualification: qualified prospects exist", qualified && Number(qualified.n) > 0, `${qualified?.n ?? 0} qualified`);

  // ─── PHASE 3: CONTACT RESOLUTION ───
  console.log("\n[AGENT 3] CONTACT INTEL AGENT — resolving author emails...");
  for (let i = 0; i < 3; i++) {
    const c = await api(`/api/campaigns/${cid}/tick`, "POST", null, 60000);
    console.log(`  Tick ${i+1}: phase=${c.json?.phase_after} action=${c.json?.action} (${c.ms}ms)`);
    if (c.json?.phase_after !== "resolving_contacts") break;
  }
  const p3 = await sql(`SELECT status, count(*) as n FROM campaign_prospects WHERE campaign_id='${cid}' GROUP BY status`);
  console.log(`  After contact resolution: ${JSON.stringify(p3)}`);
  const ready = p3.find(r => r.status === "ready");
  check("contacts: ready prospects exist", ready && Number(ready.n) > 0, `${ready?.n ?? 0} ready`);

  // ─── PHASE 4: OUTREACH ───
  console.log("\n[AGENT 4] OUTREACH AGENT — sending initial emails...");
  for (let i = 0; i < 4; i++) {
    const o = await api(`/api/campaigns/${cid}/tick`, "POST", null, 60000);
    console.log(`  Tick ${i+1}: phase=${o.json?.phase_after} action=${o.json?.action} (${o.ms}ms)`);
    if (o.json?.phase_after !== "outreaching") break;
  }
  const emails = await sql(`SELECT count(*) as n FROM outreach_emails WHERE workflow_id IN (SELECT id FROM workflows WHERE campaign_id='${cid}')`);
  const p4 = await sql(`SELECT status, count(*) as n FROM campaign_prospects WHERE campaign_id='${cid}' GROUP BY status`);
  console.log(`  Emails sent: ${emails[0].n}`);
  console.log(`  After outreach: ${JSON.stringify(p4)}`);
  check("outreach: emails > 0", Number(emails[0].n) > 0, `${emails[0].n} emails`);

  // ─── PHASE 5: NEGOTIATION ───
  console.log("\n[AGENT 5] NEGOTIATION AGENT — processing replies and negotiating...");
  // Wait for persona replies to arrive (demo pacing)
  await sleep(10000);
  for (let i = 0; i < 6; i++) {
    const n = await api(`/api/campaigns/${cid}/tick`, "POST", null, 120000);
    console.log(`  Tick ${i+1}: phase=${n.json?.phase_after} action=${n.json?.action} (${n.ms}ms)`);
    if (n.json?.phase_after === "completed") break;
  }
  const deals = await sql(`SELECT agreed_price, status, domain_host FROM deals WHERE campaign_id='${cid}'`);
  const ivs = await sql(`SELECT type, status FROM interventions WHERE campaign_id='${cid}'`);
  const events = await sql(`SELECT agent, action FROM agent_events WHERE campaign_id='${cid}' ORDER BY id DESC LIMIT 10`);
  console.log(`  Deals: ${JSON.stringify(deals)}`);
  console.log(`  Interventions: ${JSON.stringify(ivs)}`);
  console.log(`  Recent events: ${JSON.stringify(events.map(e => `${e.agent}:${e.action}`))}`);
  check("negotiation: deal exists", deals.length > 0, `$${deals[0]?.agreed_price}`);
  check("negotiation: events recorded", events.length > 5, `${events.length} events`);

  // ─── PHASE 6: COMPLETION ───
  console.log("\n[AGENT 6] DEAL AGENT — checking campaign completion...");
  const final = await sql(`SELECT phase, status, budget_used FROM campaigns WHERE id='${cid}'`);
  console.log(`  Final state: ${JSON.stringify(final[0])}`);
  check("completion: campaign phase is completed or monitoring", ["completed","monitoring"].includes(final[0]?.phase), `phase=${final[0]?.phase}`);

  // ─── BUDGET INTEGRITY ───
  console.log("\n[BUDGET] Checking ledger integrity...");
  const ledger = await sql(`SELECT entry_type, amount FROM budget_ledger WHERE campaign_id='${cid}' ORDER BY created_at`);
  const commits = ledger.filter(l => l.entry_type === "commit");
  const totalCommit = commits.reduce((s, l) => s + Number(l.amount), 0);
  console.log(`  Ledger entries: ${ledger.length} (${commits.length} commits)`);
  console.log(`  Total committed: $${totalCommit}`);
  check("budget: total committed <= budget_total", totalCommit <= 1000, `$${totalCommit}`);

  // ─── CLEANUP ───
  console.log("\n[CLEANUP] Removing test data...");
  await sql(`DELETE FROM agent_events WHERE campaign_id='${cid}'`);
  await sql(`DELETE FROM interventions WHERE campaign_id='${cid}'`);
  await sql(`DELETE FROM budget_ledger WHERE campaign_id='${cid}'`);
  await sql(`DELETE FROM deals WHERE campaign_id='${cid}'`);
  await sql(`DELETE FROM outreach_emails WHERE workflow_id IN (SELECT id FROM workflows WHERE campaign_id='${cid}')`);
  await sql(`DELETE FROM workflows WHERE campaign_id='${cid}'`);
  await sql(`DELETE FROM campaign_prospects WHERE campaign_id='${cid}'`);
  await sql(`DELETE FROM campaigns WHERE id='${cid}'`);
  console.log("  Done.\n");

  // ─── SUMMARY ───
  const failed = results.filter(r => !r.ok);
  console.log("=== SUMMARY ===");
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILURES:");
    failed.forEach(f => console.log(`  - ${f.name}: ${f.detail}`));
  }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error("TEST CRASHED:", e.message); process.exit(1); });
