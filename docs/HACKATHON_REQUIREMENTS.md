# Hackathon Requirements — live checklist

Target: Google All Things Agentic Hackathon 2026, **Taskmaster** category.

| Requirement | Status | Evidence |
|---|---|---|
| Qualifying Gemini model (Gemini 3.5 Flash via Gemini API) | ✅ built | `src/lib/ai/gemini.ts` + `agents/seo_workforce/config.py` (`GEMINI_MODEL=gemini-3.5-flash`, override supported) |
| Google Agent Framework — ADK as principal orchestrator | ✅ built | `agents/seo_workforce/` — root Campaign Manager + 7 sub-agents on google-adk 2.7.1; Runner + DatabaseSessionService drive real ticks |
| Google Cloud infrastructure service | ✅ prepared | `deploy/deploy.sh` → Cloud Run ×2, Artifact Registry, Secret Manager, Cloud Scheduler, Cloud Build |
| Cloud deployment proof | ⏳ pending GCP project | script ready; capture URLs + console screenshot after `deploy/deploy.sh` |
| Architecture diagram | ✅ | `docs/ARCHITECTURE.md` |
| Complete autonomous workflow (no chatbot) | ✅ | campaign lifecycle: plan→discover→qualify→contacts→outreach→monitor→negotiate→deals (`fallbackOrchestrator.ts`, `orchestrator.py`) |
| Persistent asynchronous workflow | ✅ | idempotent ticks, append-only `agent_events`, Postgres-backed ADK sessions, crash-safe phase transitions |
| Human intervention flow | ✅ | durable `interventions` table + assist/resume path + meeting-request demo persona |
| Action/tool execution on real data | ✅ | search providers, Ahrefs DR, article fetch/extract, enrichment cascade, SMTP/IMAP |
| README | ✅ | problem/solution/agentic/architecture/setup/demo |
| Pre-existing work disclosure | ✅ | `docs/PREEXISTING_WORK.md` + provenance conventions |

## Submission-time TODO

- [ ] Run `deploy/deploy.sh` with a live GCP project → paste service URLs here
- [ ] Screenshot: Cloud Run services list (web + agents)
- [ ] Screenshot: Cloud Scheduler job hitting `/api/emails/process`
- [ ] Record demo video following `docs/DEMO.md`
- [ ] Verify deployed Gemini calls visible in logs (provider label "gemini")
