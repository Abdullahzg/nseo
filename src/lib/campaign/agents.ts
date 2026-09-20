// The named agents of a campaign, in pipeline order. Each is one responsibility, one engine, one
// hand-off. The feed, the pipeline graphic and the "tools" panel all read from this table so the
// product never describes an agent two different ways.
//
// `key` is the `agent` column written to agent_events. Keep it stable.

export type AgentKey = "manager" | "discovery" | "qualification" | "contact" | "outreach" | "inbox" | "negotiation" | "deals";

export interface AgentSpec {
  key: AgentKey;
  name: string;           // what the user sees
  role: string;           // one line: what it is for
  engine: string;         // what does the thinking
  engineShort: string;    // fits on a card, no truncation
  tools: string[];        // what it calls
  handsTo: AgentKey | "you" | null;
  ownsMoney?: boolean;
}

export const AGENTS: AgentSpec[] = [
  { key: "manager", name: "Manager", role: "Each step, chooses the ONE next action from what code says is available.", engine: "Nemotron 3 Super · thinking on · tool call", engineShort: "Nemotron 3 Super", tools: ["Nebius Token Factory"], handsTo: null },
  { key: "discovery", name: "Scout", role: "Finds candidate publications: the ones you listed, then the web.", engine: "code + search", engineShort: "code + Tavily / your list", tools: ["Tavily search (real mode)", "your seed list", "demo fixtures"], handsTo: "qualification" },
  { key: "qualification", name: "Judge", role: "Reads each page: topical fit, editorial quality, and whether this publisher could ever feature you. DR floor is a code rule.", engine: "Nemotron 3 Super · thinking on · json_schema", engineShort: "Nemotron 3 Super", tools: ["page fetch + Readability", "Ahrefs DR (optional)", "Nebius Token Factory"], handsTo: "contact" },
  { key: "contact", name: "Finder", role: "Finds a human editor's address at each qualified publication.", engine: "code (enrichment cascade)", engineShort: "code · lookups", tools: ["address you provided", "page scrape", "Hunter / verification (optional)"], handsTo: "outreach" },
  { key: "outreach", name: "Writer", role: "Writes the first email about their actual article; code queues it and Gmail sends it.", engine: "Nemotron 3 Nano · thinking off · json_schema", engineShort: "Nemotron 3 Nano", tools: ["Nebius Token Factory", "Gmail SMTP (real mode)"], handsTo: "inbox" },
  { key: "inbox", name: "Inbox", role: "Reads replies and threads them to the right conversation.", engine: "code", engineShort: "code · IMAP", tools: ["Gmail IMAP (real mode)", "simulated editors (demo)"], handsTo: "negotiation" },
  { key: "negotiation", name: "Negotiator", role: "Classifies each reply, answers within your ceiling, and parks anything a human must decide.", engine: "Nano classifies · Ultra writes counters · code owns the numbers", engineShort: "Nano + Ultra · code owns money", tools: ["Nebius Token Factory", "Gmail SMTP (real mode)"], handsTo: "deals", ownsMoney: true },
  { key: "deals", name: "Ledger", role: "Records agreed placements and commits the budget atomically. Never a model.", engine: "code (Postgres)", engineShort: "code · Postgres", tools: ["commit_budget()"], handsTo: "you", ownsMoney: true },
];

export const AGENT_BY_KEY: Record<string, AgentSpec> = Object.fromEntries(AGENTS.map((a) => [a.key, a]));

/** Feed labels: the agent's product name, plus the non-agent actors. */
export const AGENT_LABEL: Record<string, string> = {
  ...Object.fromEntries(AGENTS.map((a) => [a.key, a.name])),
  strategy: "Scout", system: "System", you: "You", editor: "Editor (you)",
};

/** What a campaign is doing right now — written by the agents as they work, shown in the header. */
export interface Activity { agent: AgentKey; doing: string; target?: string | null; n?: number; of?: number; model?: string | null; at: string; done?: boolean }
