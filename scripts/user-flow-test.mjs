// User-flow verification per the hackathon success definition (??78).
// Drives a fresh campaign end-to-end through public APIs + verifies DB state.
// Self-terminates: max rounds, per-call AbortSignal. Exit code 0 = all checks pass.
const BASE = process.env.APP_URL || "http://localhost:3100";
const SECRET = process.env.CRON_SECRET || "dev-cron-secret";
const H = { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const PG = { host: "127.0.0.1", port: 5433, database: "seo", user: "postgres", password: "seo123" };

const results = [];
function check(name, ok, detail = "") { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` ??? ${detail}` : ""}`); }
let hitlDone = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, method = "GET", body, timeoutMs = 120000) {
  const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text.slice(0, 200); }
  return { status: res.status, json };
}

async function sql(q) {
  const { Client } = await import("pg");
  const c = new Client(PG); await c.connect();
  try { const r = await c.query(q); return r.rows; } finally { await c.end(); }
}

(async () => {
  // 0. Auth boundary: gateway must not let anonymous callers through. A 401 from the route
  // OR the middleware's login-redirect both count as "blocked" (no data returned).
  const anon = await fetch(`${BASE}/api/agent/tools/discover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000), redirect: "manual" });
  const blocked = anon.status === 401 || (anon.status >= 300 && anon.status < 400);
  const anonBody = anon.status === 200 ? await anon.text() : "";
  const looksBlocked = blocked || (anon.status === 200 && /sign in|login/i.test(anonBody));
  check("auth: agent gateway rejects anonymous callers", looksBlocked, `status=${anon.status}`);
  const MAX_ROUNDS = Number(process.env.FLOW_MAX_ROUNDS ?? 34);

  // 1. Create campaign (demo mode) directly + start via API
  const rows = await sql(`INSERT INTO campaigns (name, keywords, status, phase, owner_email, website_url, objective,
      budget_total, budget_used, currency, min_dr, geos, desired_deals, max_per_deal, autonomy_mode, demo_mode)
    VALUES ('FlowTest ${Date.now()}', ARRAY['AI photo editor','photo restoration'], 'running', 'draft',
      'flowtest@local', 'https://imagine.example', 'Acquire 2 placements', 800, 0, 'USD', 50, ARRAY['US'], 2, 300, 'autonomous', true)
    RETURNING id`);
  const cid = rows[0].id;
  const startRes = await call(`/api/campaigns/${cid}/start`, "POST", null, 30000);
  check("campaign starts (draft???planning)", startRes.json.phase === "planning", JSON.stringify(startRes.json));

  // 2. Drive ticks until completed or cap
  let deals = [], interventions = [], byStatus = {}, budgetUsed = 0, phase = "";
  for (let i = 1; i <= MAX_ROUNDS; i++) {
    await call(`/api/campaigns/${cid}/tick`, "POST", null, 240000).catch(() => null);
    await sleep(6000);
    const s = await call(`/api/agent/campaigns/${cid}`, "GET", null, 20000);
    if (s.status !== 200) continue;
    phase = s.json.campaign.phase;
    deals = s.json.deals ?? [];
    interventions = s.json.open_interventions ?? [];
    byStatus = s.json.prospects_by_status ?? {};
    budgetUsed = Number(s.json.campaign.budget_used ?? 0);
    console.log(`  round ${i}: phase=${phase} prospects=${JSON.stringify(byStatus)} deals=${deals.length} open_iv=${interventions.length}`);
    const hasSyncIv = interventions.some((x) => x.type === "sync_contact");
    if (hasSyncIv && !hitlDone) {
      hitlDone = true;
      const iv = interventions.find((x) => x.type === "sync_contact");
      const r = await call("/api/agent/interventions", "POST", { id: iv.id, assist_input: "Thursday 3-5pm ET works." }, 120000);
      check("HITL: meeting-request intervention resumable", r.status === 200 && r.json.ok === true, `action=${r.json.outcome?.action}`);
    }
    if (phase === "completed") break;
  }

  check("discovery ran (prospects found)", (byStatus.discovered ?? 0) + Object.entries(byStatus).reduce((s, [, v]) => s + v, 0) > 0);
  const everQualified = (byStatus.qualified ?? 0) + (byStatus.ready ?? 0) + (byStatus.outreached ?? 0) + (byStatus.replied ?? 0) + (byStatus.negotiating ?? 0);
  check("qualification produced qualified prospects", everQualified > 0, `funnel=${JSON.stringify(byStatus)}`);
  check("contacts resolved (ready prospects)", (byStatus.ready ?? 0) + (byStatus.outreached ?? 0) + (byStatus.replied ?? 0) + (byStatus.negotiating ?? 0) > 0);
  check("outreach executed (simulated sends)", (byStatus.outreached ?? 0) + (byStatus.replied ?? 0) + (byStatus.negotiating ?? 0) > 0);

  // 3. Deals + budget ledger integrity
  check("at least one deal agreed", deals.length >= 1, `${deals.length} deal(s)`);
  if (deals.length) {
    const d = deals[0];
    check("deal terms structured (price/status)", d.agreed_price != null && !!d.status);
    const ledger = await sql(`SELECT entry_type, amount FROM budget_ledger WHERE campaign_id='${cid}' ORDER BY created_at`);
    const commits = ledger.filter((l) => l.entry_type === "commit");
    check("budget ledger records commit(s)", commits.length >= 1 && Math.abs(commits.reduce((s, l) => s + Number(l.amount), 0)) <= Number(d.agreed_price ?? 0) + 0.01);
  }

  // 4. Observability: events timeline exists with structured fields
  const ev = await sql(`SELECT agent, action, detail FROM agent_events WHERE campaign_id='${cid}' ORDER BY id DESC LIMIT 50`);
  check("agent_events timeline populated", ev.length >= 5, `${ev.length} events`);
  const agents = new Set(ev.map((e) => e.agent));
  check("multiple distinct agents recorded", agents.size >= 3, [...agents].join(","));

  // 5. Campaign completion semantics
  check("campaign reached a terminal state", ["completed"].includes(phase), `phase=${phase}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("flow test crashed:", e.message); process.exit(1); });
