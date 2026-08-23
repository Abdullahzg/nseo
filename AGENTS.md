<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:local-ops-rules -->
# Local ops rules (MANDATORY)
1. NEVER run servers, watchers, or loops in the foreground. Launch via `Start-Process ... -WindowStyle Hidden`, then MOVE ON.
2. Every shell command gets an explicit `timeout` <= 60000ms unless inherently instant.
3. Never poll with sleeps inside a command. Check a log file with ONE fast `Get-Content -Tail` when needed.
4. Missing API keys never block work: build against interfaces + demo adapters and continue (see .env.example).
5. Demo/verification scripts must self-terminate (max rounds + per-call AbortSignal), e.g. scripts/demo-arc.mjs.
6. NEVER use `-RedirectStandardOutput` or `-RedirectStandardError` with `Start-Process` on Windows — it causes OpenCode shell to hang on pipe close.
7. NEVER chain `Start-Process` + `Start-Sleep` + port-check in a single tool call — it hangs. Spawn in one call, check port in a separate call.
8. If a server is already listening on the expected port, treat it as success and CONTINUE. Do not kill/restart unless config changed.
<!-- END:local-ops-rules -->

<!-- BEGIN:completeness-checklist -->
# Completeness checklist (MANDATORY)
Whenever you believe work is complete, BEFORE reporting done:
1. Re-read `C:\Users\abgho\Documents\GitHub\seo\Fix Local Supabase Startup.md` line by line.
2. Verify each of its 15 steps is satisfied (Docker containers healthy, API reachable, DB reachable, migrations applied).
3. Verify the success condition: `npx supabase status` or equivalent shows services running.
4. Only then report complete. If anything fails, fix it and re-read the doc again.
<!-- END:completeness-checklist -->

<!-- BEGIN:agent-testing-rules -->
# Agent testing rules (MANDATORY)
Every agent in the system must be tested individually with verbose output:
1. For each of the 8 ADK agents, describe what it does, what tools it calls, what inputs/outputs it expects.
2. Run each agent through the tool gateway (POST /api/agent/tools/*) and print the full response.
3. Verify each agent's role in the campaign lifecycle: discover → qualify → contact → outreach → negotiate → deal.
4. Print agent mode (adk-gemini vs fallback-policy) and whether LLM was called or deterministic path was used.
5. Any agent that fails must be debugged and retested before the system is considered complete.
<!-- END:agent-testing-rules -->
