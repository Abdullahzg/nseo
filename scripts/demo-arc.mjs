// Demo arc driver: ticks the campaign until deals are agreed / HITL fires / max rounds.
// Usage: node scripts/demo-arc.mjs <campaign_id> [maxRounds=20]
// Every HTTP call carries an abort timeout; the script always terminates.
const cid = process.argv[2];
const MAX = Number(process.argv[3] ?? 20);
if (!cid) { console.error("usage: node scripts/demo-arc.mjs <campaign_id>"); process.exit(1); }

const BASE = process.env.APP_URL || "http://localhost:3100";
const SECRET = process.env.CRON_SECRET || "dev-cron-secret";
const H = { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, body, timeoutMs = 120000) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST", headers: H,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function state() {
  const res = await fetch(`${BASE}/api/agent/campaigns/${cid}`, { headers: H, signal: AbortSignal.timeout(20000) });
  return res.json();
}

let deals = 0;
for (let i = 1; i <= MAX; i++) {
  try {
    const t = await call(`/api/campaigns/${cid}/tick`, null, 240000);
    const r = t.details?.replies ?? {};
    const s = await state();
    deals = s.deals.length;
    console.log(
      `[${String(i).padStart(2)}] phase=${s.campaign.phase} negotiated=${r.negotiated ?? 0} hitl=${r.needs_human ?? 0}` +
      ` err=${r.errors?.length ?? 0} deals=${deals} budget=${s.campaign.budget_used}`
    );
    for (const d of s.deals) console.log(`     deal: ${d.domain_host} @ ${d.agreed_price} (${d.status})`);
    for (const iv of (s.interventions ?? []).filter((x) => x.status === "open"))
      console.log(`     HITL: [${iv.type}] ${iv.ask}`);
    if (s.campaign.phase === "completed" || s.campaign.emergency_stopped) { console.log("→ campaign terminal"); break; }
  } catch (e) {
    console.log(`[${i}] tick failed: ${e.message}`);
  }
  await sleep(8000);
}
console.log(`done: ${deals} deal(s)`);
