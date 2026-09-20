# Hackathon Requirements — live checklist

Target: **AWS Agents for Humans Hackathon 2026** (Devpost), **Professional Agents** track.

## Submission Requirements

| Requirement | Status | Evidence |
|---|---|---|
| Strands Agents SDK as core agent framework | ✅ built | `agents/seo_workforce/` — 8 Strands Agent objects, 9 @tool functions, agents-as-tools delegation |
| Amazon Bedrock model provider | ✅ built | `agents/seo_workforce/config.py` (`MODEL_PROVIDER=bedrock`, `STRANDS_MODEL_ID=anthropic.claude-sonnet-4-20250514-v1:0`) |
| Text description | ✅ | README.md problem/solution/agentic description |
| PUBLIC URL to code repo | ✅ | GitHub repo |
| All source code + setup instructions | ✅ | README.md Setup section |
| MIT or Apache license | ✅ | `LICENSE` (MIT) |
| README | ✅ | Full README with architecture, setup, demo |
| Architecture diagram | ✅ | `docs/ARCHITECTURE.md` |
| Demo video (max 5 min) | ⏳ TODO | Record per `docs/DEMO.md` |
| AWS Builder ID | ⏳ TODO | Submit via Devpost |
| Live demo link (optional, bonus) | ⏳ TODO | Deploy or use local demo |

## What to Build

Build a new AI agent with Strands Agents SDK that does real work for people.

### Track: Professional Agents

An agent that makes someone dramatically better at the work they already do — professionals, makers, creators, small-business owners. Target the repetitive, judgment-heavy tasks that eat their day.

**Our pitch**: Summit automates the brutally manual work of SEO editorial outreach: searching dozens of queries, judging site quality, finding authors, hunting emails, writing outreach, sending, classifying replies, negotiating prices, and tracking deals. What takes an SEO professional days of fragmented work per deal happens autonomously with one click.

## Judging Criteria Alignment

| Criterion | Our Strength |
|---|---|
| **Technological Implementation** | 8 genuine Strands Agents, 9 @tool functions, agents-as-tools delegation, FileSessionManager, Bedrock model provider, HACKATHON_MODE with visible failure |
| **Design** | Full observability UI with live timeline, budget tracking, prospect explorer, intervention queue |
| **Potential Impact** | SEO outreach is a real, repetitive, judgment-heavy daily task for professionals |
| **Creativity & Originality** | Multi-agent autonomous workforce with policy-bounded negotiation and HITL interventions |
| **Presentation** | Demo mode runs entire real pipeline end-to-end with simulated publisher personas |

## Strands Features Used

- `@tool(context=True)` — tools receive invocation_state for campaign_id
- `Agent` — 8 specialist agents with system_prompt and tools
- `agent.as_tool()` — agents-as-tools delegation pattern
- `FileSessionManager` — campaign-scoped session persistence
- `BedrockModel` — Amazon Bedrock model provider

## Agent Topology

```
campaign_manager (root)
├── strategy_agent.as_tool()
├── discovery_agent.as_tool()
├── qualification_agent.as_tool()
├── contact_agent.as_tool()
├── outreach_agent.as_tool()
├── negotiation_agent.as_tool()
├── intervention_agent.as_tool()
├── get_campaign_state (@tool)
├── plan_discovery (@tool)
├── run_discovery_batch (@tool)
├── run_qualification_batch (@tool)
├── run_contact_resolution (@tool)
├── queue_outreach_batch (@tool)
├── run_negotiation_tick (@tool)
├── list_open_interventions (@tool)
└── complete_campaign (@tool)
```

## Pre-existing Work Disclosure

See `docs/PREEXISTING_WORK.md` for full disclosure.

- **Pre-existing**: Next.js app, discovery pipeline, enrichment cascade, email engine, negotiation engine, database schema, UI
- **Built for hackathon**: Campaign lifecycle, Strands agent service, tool gateway, observability UI, demo mode, tests, deployment assets

## Submission-time TODO

- [ ] Record demo video following `docs/DEMO.md`
- [ ] Deploy to Vercel or run locally for live demo link
- [ ] Submit on Devpost with all required fields
- [ ] Optionally publish build story on builder.aws.com for bonus points
