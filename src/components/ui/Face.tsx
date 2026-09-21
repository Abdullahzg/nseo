"use client";

import { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import * as bottts from "@dicebear/bottts";
import * as notionists from "@dicebear/notionists";

// Faces. Agents are robots (DiceBear "bottts", free for commercial use), seeded by their key so the
// Judge always looks like the Judge. Editors are hand-drawn people ("notionists", CC0), seeded by
// their name and publication so the same editor always looks the same across threads and cards.

const AGENT_SEED: Record<string, string> = { manager: "manager-7", discovery: "scout-3", qualification: "judge-11", contact: "finder-2", outreach: "writer-5", inbox: "inbox-9", negotiation: "negotiator-4", deals: "ledger-8", strategy: "scout-3", you: "you", editor: "editor", system: "system" };

export function Face({ kind, seed, size = 32, className = "" }: { kind: "agent" | "editor"; seed: string; size?: number; className?: string }) {
  const svg = useMemo(() => {
    if (kind === "agent") return createAvatar(bottts, { seed: AGENT_SEED[seed] ?? seed, size, backgroundColor: ["efe9df"], radius: 24 }).toString();
    return createAvatar(notionists, { seed, size, backgroundColor: ["e2e6f5"], radius: 50 }).toString();
  }, [kind, seed, size]);
  return <span className={`inline-block shrink-0 overflow-hidden ${className}`} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}
