# Geseo Evaluation Suite

HACKATHON JUDGES: Run this to verify the Strands agent system end-to-end.

```bash
# Python tests (Strands agents + business logic)
cd agents && python -m pytest seo_workforce/test_agents.py -v

# TypeScript tests (UI + API + negotiation logic)
npx vitest run

# Full e2e smoke test (requires running services)
python scripts/e2e-campaign-test.py
```

## What this covers

| Layer | Tests | What it proves |
|-------|-------|----------------|
| **Strands agents** | 37 tests | 8 agents, 9 tools, delegation chain, tool gateway, orchestrator |
| **Reply classification** | 66 cases | Every reply intent + sentiment + price extraction |
| **Negotiation engine** | 36 cases | Pricing, safety constraints, floor/ceiling, thread limits |
| **Pipeline e2e** | 64 cases | Module imports, hackathon config, safety rules, campaigns |
| **Filters** | 9 cases | Email safety, domain canonicalization, qualification |
| **E2E smoke** | 1 scenario | Strands service → tick → DB write → event recording |

**Total: 212+ test cases across Python and TypeScript.**
