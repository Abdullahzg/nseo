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
