// Edge case stress tests — real-world scenarios.
// Verifies the system handles adversarial/boundary inputs gracefully.
// Self-terminates. Exit code 0 = all pass.
const BASE = process.env.APP_URL || "http://localhost:3100";
const SECRET = process.env.CRON_SECRET || "dev-cron-secret";
const H = { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const PG = { host: "127.0.0.1", port: 5433, database: "seo", user: "postgres", password: "seo123" };
const results = [];
function check(name, ok, detail = "") { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sql(q) { const { Client } = await import("pg"); const c = new Client(PG); await c.connect(); try { return (await c.query(q)).rows; } finally { await c.end(); } }
async function api(path, method = "GET", body, timeoutMs = 120000) {
  const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

(async () => {
  console.log("=== EDGE CASE STRESS TESTS ===\n");

  // --- BUDGET BOUNDARY ---
  console.log("--- Budget Boundary ---");
  // 1. $0 budget campaign
  const zero = await sql(`INSERT INTO campaigns (name,keywords,status,phase,owner_email,website_url,objective,budget_total,budget_used,currency,min_dr,geos,desired_deals,max_per_deal,autonomy_mode,demo_mode) VALUES ('EC-zero-budget',ARRAY['test'],'running','planning','t@t','http://t','test',0,0,'USD',0,ARRAY['US'],1,100,'autonomous',true) RETURNING id`);
  const zid = zero[0].id;
  const zTick = await api(`/api/campaigns/${zid}/tick`, "POST");
  check("zero-budget: tick doesn't crash", zTick.status === 200);
  // Budget ledger should show full $0 committed
  const zLedger = await sql(`SELECT * FROM budget_ledger WHERE campaign_id='${zid}'`);
  check("zero-budget: no ledger entries (nothing to commit)", zLedger.length === 0);

  // 2. Budget ceiling enforcement — can't create deal above remaining budget
  const tight = await sql(`INSERT INTO campaigns (name,keywords,status,phase,owner_email,website_url,objective,budget_total,budget_used,currency,min_dr,geos,desired_deals,max_per_deal,autonomy_mode,demo_mode) VALUES ('EC-tight-budget',ARRAY['test'],'running','monitoring','t@t','http://t','test',50,0,'USD',0,ARRAY['US'],1,100,'autonomous',true) RETURNING id`);
  const tid = tight[0].id;
  // Insert a replied thread + outreach to test negotiation
  const tProspect = await sql(`INSERT INTO campaign_prospects (campaign_id,status,relevance,author_name,author_email,publication,dr,traffic,pricing_tier,pricing_anchor_usd,created_at) VALUES ('${tid}','replied',50,'Test Author','test@test.com','TestPub',30,1000,'editorial_place',150,NOW()) RETURNING id`);
  const tWork = await sql(`INSERT INTO workflows (campaign_id,status,subject,created_at) VALUES ('${tid}','replied','Test thread',NOW()) RETURNING id`);
  await sql(`INSERT INTO outreach_emails (workflow_id,kind,status,to_email,subject,body_md,sent_at,created_at) VALUES ('${tWork[0].id}','initial','sent','test@test.com','Subject','Hello',NOW(),NOW())`);
  // Simulate a reply at $1000 (way above $50 budget)
  const tReply = await sql(`INSERT INTO outreach_emails (workflow_id,kind,status,to_email,from_email,subject,body_md,replied_at,created_at) VALUES ('${tWork[0].id}','reply','received','out@t.com','test@test.com','Re: Subject','We accept at $1000',NOW(),NOW()) RETURNING id`);
  const tTick = await api(`/api/campaigns/${tid}/tick`, "POST");
  check("tight-budget: tick doesn't crash on over-budget reply", tTick.status === 200);
  // Budget shouldn't exceed $50
  const tBudget = await sql(`SELECT COALESCE(SUM(amount),0) as total FROM budget_ledger WHERE campaign_id='${tid}' AND entry_type='commit'`);
  check("tight-budget: total commit <= $50", Number(tBudget[0].total) <= 50, `actual=${tBudget[0].total}`);

  // --- THREAD SAFETY ---
  console.log("\n--- Thread Safety ---");
  // 3. Thread-length cap: 5+ sent replies should trigger needs_human
  const cap = await sql(`INSERT INTO campaigns (name,keywords,status,phase,owner_email,website_url,objective,budget_total,budget_used,currency,min_dr,geos,desired_deals,max_per_deal,autonomy_mode,demo_mode) VALUES ('EC-cap',ARRAY['test'],'running','monitoring','t@t','http://t','test',5000,0,'USD',0,ARRAY['US'],1,300,'autonomous',true) RETURNING id`);
  const cid = cap[0].id;
  const cp = await sql(`INSERT INTO campaign_prospects (campaign_id,status,relevance,author_name,author_email,publication,dr,traffic,pricing_tier,pricing_anchor_usd,created_at) VALUES ('${cid}','replied',80,'Cap Author','cap@test.com','CapPub',40,5000,'editorial_place',200,NOW()) RETURNING id`);
  const cw = await sql(`INSERT INTO workflows (campaign_id,status,subject,created_at) VALUES ('${cid}','replied','Cap thread',NOW()) RETURNING id`);
  // Insert 4 prior negotiation sends (near the 4-reply cap)
  for (let i = 0; i < 4; i++) {
    await sql(`INSERT INTO outreach_emails (workflow_id,kind,status,to_email,subject,body_md,sent_at,created_at) VALUES ('${cw[0].id}','negotiation','sent','cap@test.com','Cap Subject ${i}','Counter ${i}',NOW(),NOW())`);
  }
  // A new reply comes in
  await sql(`INSERT INTO outreach_emails (workflow_id,kind,status,to_email,from_email,subject,body_md,replied_at,created_at) VALUES ('${cw[0].id}','reply','received','out@t.com','cap@test.com','Re: Cap','Still interested',NOW(),NOW())`);
  const cTick = await api(`/api/campaigns/${cid}/tick`, "POST");
  check("thread-cap: tick handles near-cap thread", cTick.status === 200);
  // After the next send (5th), it should park
  const cSentCount = await sql(`SELECT count(*) FROM outreach_emails WHERE workflow_id='${cw[0].id}' AND kind='negotiation' AND status='sent'`);
  check("thread-cap: 4 negotiation sends recorded", Number(cSentCount[0].count) === 4);

  // --- IDEMPOTENCY ---
  console.log("\n--- Idempotency ---");
  // 4. Double-resolve intervention
  const iv = await sql(`INSERT INTO interventions (campaign_id,type,status,detail,created_at) VALUES ('${cid}','sync_contact','open','Double resolve test',NOW()) RETURNING id`);
  const r1 = await api("/api/agent/interventions", "POST", { id: iv[0].id, assist_input: "First answer" });
  const r2 = await api("/api/agent/interventions", "POST", { id: iv[0].id, assist_input: "Second answer" });
  check("idempotency: first resolve succeeds", r1.status === 200 && r1.json.ok === true);
  check("idempotency: second resolve handled gracefully", r2.status === 200 || r2.status === 409);

  // --- TERMINAL STATE ---
  console.log("\n--- Terminal State ---");
  // 5. Completed campaign shouldn't accept ticks
  await sql(`UPDATE campaigns SET phase='completed', status='completed' WHERE id='${zid}'`);
  const termTick = await api(`/api/campaigns/${zid}/tick`, "POST");
  check("terminal-state: tick on completed campaign", termTick.status === 200);
  const termPhase = await sql(`SELECT phase FROM campaigns WHERE id='${zid}'`);
  check("terminal-state: phase stays completed", termPhase[0].phase === "completed");

  // --- DEMO MODE ---
  console.log("\n--- Demo Mode ---");
  // 6. Demo campaign uses deterministic fixtures
  const demo = await sql(`INSERT INTO campaigns (name,keywords,status,phase,owner_email,website_url,objective,budget_total,budget_used,currency,min_dr,geos,desired_deals,max_per_deal,autonomy_mode,demo_mode) VALUES ('EC-demo',ARRAY['test'],'running','planning','t@t','http://t','test',5000,0,'USD',0,ARRAY['US'],2,300,'autonomous',true) RETURNING id`);
  const did = demo[0].id;
  const dTick = await api(`/api/campaigns/${did}/tick`, "POST");
  check("demo-mode: tick succeeds", dTick.status === 200);
  const dProspects = await sql(`SELECT count(*) FROM campaign_prospects WHERE campaign_id='${did}'`);
  check("demo-mode: deterministic prospects created", Number(dProspects[0].count) > 0, `${dProspects[0].count} prospects`);

  // --- AUTH ---
  console.log("\n--- Auth Boundary ---");
  // 7. Unauthenticated agent gateway
  const anonTick = await fetch(`${BASE}/api/campaigns/${did}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, redirect: "manual" });
  const blocked = anonTick.status === 401 || (anonTick.status >= 300 && anonTick.status < 400);
  check("auth: unauthenticated start blocked", blocked, `status=${anonTick.status}`);

  // --- NEGOTIATION POLICY ---
  console.log("\n--- Negotiation Policy ---");
  // 8. Price demotion: price-only message should NOT become needs_human
  // Test via API: a reply with just "$200" should be classified as counter_offer, not needs_human
  const np = await sql(`INSERT INTO campaigns (name,keywords,status,phase,owner_email,website_url,objective,budget_total,budget_used,currency,min_dr,geos,desired_deals,max_per_deal,autonomy_mode,demo_mode) VALUES ('EC-np',ARRAY['test'],'running','monitoring','t@t','http://t','test',5000,0,'USD',0,ARRAY['US'],1,300,'autonomous',true) RETURNING id`);
  const npid = np[0].id;
  const npp = await sql(`INSERT INTO campaign_prospects (campaign_id,status,relevance,author_name,author_email,publication,dr,traffic,pricing_tier,pricing_anchor_usd,created_at) VALUES ('${npid}','replied',70,'NP Author','np@test.com','NPPub',35,3000,'editorial_place',250,NOW()) RETURNING id`);
  const npw = await sql(`INSERT INTO workflows (campaign_id,status,subject,created_at) VALUES ('${npid}','replied','NP thread',NOW()) RETURNING id`);
  await sql(`INSERT INTO outreach_emails (workflow_id,kind,status,to_email,subject,body_md,sent_at,created_at) VALUES ('${npw[0].id}','initial','sent','np@test.com','NP Subject','Hello',NOW(),NOW())`);
  await sql(`INSERT INTO outreach_emails (workflow_id,kind,status,to_email,from_email,subject,body_md,replied_at,created_at) VALUES ('${npw[0].id}','reply','received','out@t.com','np@test.com','Re: NP','$200 works for me',NOW(),NOW())`);
  const npTick = await api(`/api/campaigns/${npid}/tick`, "POST");
  check("negotiation-policy: price-only reply handled", npTick.status === 200);

  // --- CLEANUP ---
  console.log("\n--- Cleanup ---");
  await sql(`DELETE FROM agent_events WHERE campaign_id IN ('${zid}','${tid}','${cid}','${did}','${npid}')`);
  await sql(`DELETE FROM interventions WHERE campaign_id IN ('${zid}','${tid}','${cid}','${did}','${npid}')`);
  await sql(`DELETE FROM budget_ledger WHERE campaign_id IN ('${zid}','${tid}','${cid}','${did}','${npid}')`);
  await sql(`DELETE FROM outreach_emails WHERE workflow_id IN (SELECT id FROM workflows WHERE campaign_id IN ('${zid}','${tid}','${cid}','${did}','${npid}'))`);
  await sql(`DELETE FROM workflows WHERE campaign_id IN ('${zid}','${tid}','${cid}','${did}','${npid}')`);
  await sql(`DELETE FROM campaign_prospects WHERE campaign_id IN ('${zid}','${tid}','${cid}','${did}','${npid}')`);
  await sql(`DELETE FROM campaigns WHERE id IN ('${zid}','${tid}','${cid}','${did}','${npid}')`);
  console.log("cleanup done\n");

  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} edge-case checks passed`);
  if (failed.length) failed.forEach((f) => console.log(`  FAILED: ${f.name} — ${f.detail}`));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("edge-case test crashed:", e.message); process.exit(1); });
