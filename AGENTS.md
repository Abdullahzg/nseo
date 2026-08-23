<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:local-ops-rules -->
# Local ops rules (MANDATORY)
1. NEVER run servers, watchers, or loops in the foreground. Launch via `Start-Process ... -RedirectStandardOutput <log> -WindowStyle Hidden`, then MOVE ON.
2. Every shell command gets an explicit `timeout` <= 60000ms unless inherently instant.
3. Never poll with sleeps inside a command. Check a log file with ONE fast `Get-Content -Tail` when needed.
4. Missing API keys never block work: build against interfaces + demo adapters and continue (see .env.example).
5. Demo/verification scripts must self-terminate (max rounds + per-call AbortSignal), e.g. scripts/demo-arc.mjs.
<!-- END:local-ops-rules -->
