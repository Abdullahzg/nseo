"use client";

import { useMemo } from "react";
import type { CampaignPlan } from "@/lib/campaign/plan";
import { PLAN_DEFAULTS } from "@/lib/campaign/plan";
import { Face } from "@/components/ui/Face";
import { Stagger, Item, item } from "@/components/ui/motion";
import { money } from "@/lib/ui/format";

// "Here's what will happen": the campaign's journey before it starts, computed by code from the
// form and the plan — no model involved, so it is always true to the settings. It re-renders as the
// plan is edited, so a change to a number shows its consequence at once.

interface Stop { when: string; agent: string; title: string; body: string; you?: boolean }

export function Journey({ plan, demo, goal, budget, maxPerDeal, seedCount, searchWeb }: { plan: CampaignPlan; demo: boolean; goal: number; budget: number; maxPerDeal: number; seedCount: number; searchWeb: boolean }) {
  const p = { ...PLAN_DEFAULTS, ...plan };
  const queries = plan.queries?.length ?? 0;
  const stops = useMemo<Stop[]>(() => {
    const out: Stop[] = [];
    const ceiling = Math.min(maxPerDeal, p.human_approval_above);
    const searchLine = demo
      ? `runs ${Math.min(3, queries || 3)} of your search angles through Tavily and brings back every real page it finds`
      : [seedCount ? `starts with the ${seedCount} publication${seedCount === 1 ? "" : "s"} you listed` : null, searchWeb ? `searches the web along ${queries || "the"} angle${queries === 1 ? "" : "s"} until about ${p.pool_target} candidates are on the list` : null].filter(Boolean).join(", then ");
    out.push({ when: demo ? "First minute" : "Day 1", agent: "discovery", title: "The Scout goes looking", body: `${searchLine[0].toUpperCase()}${searchLine.slice(1)}.` });
    out.push({ when: demo ? "Minutes 1–3" : "Day 1", agent: "qualification", title: "The Judge reads every page", body: `Nemotron 3 Super reads each candidate and decides whether it is a real publication that could feature you, with its reasons. ${p.min_dr > 0 ? `Anything under DR ${p.min_dr} is out by rule.` : "No authority floor."} Expect about half to be rejected.` });
    out.push({ when: demo ? "Minutes 3–4" : "Day 1", agent: "contact", title: "The Finder finds the editors", body: demo ? "A named editor is found on each site that publishes one; where a site does not, a stand-in editor is used so the rest of the demo can run." : "A human editor's address at each publication that passed, from your list first, then the page itself." });
    out.push({ when: demo ? "Minute 4" : "Day 1–2", agent: "outreach", title: "The Writer writes the first emails", body: `One email per publication, about the article they actually published, in a ${p.tone} tone. ${demo ? "Nothing is sent." : p.approve_emails ? "Each one waits for your approval before it goes." : "Sent from your Gmail inside your sending hours."}`, you: !demo && p.approve_emails });
    if (!demo) out.push({ when: `Day ${1 + p.followup_after_days}`, agent: "outreach", title: "One polite nudge", body: `Anyone who has not replied after ${p.followup_after_days} day${p.followup_after_days === 1 ? "" : "s"} gets one follow-up. Never a second.` });
    out.push({ when: demo ? "Minutes 5–8" : "Days 2–7", agent: "inbox", title: "Replies come in", body: demo ? "Editors reply — the model plays each one with a stance of its own: keen, expensive, sceptical, wants a call, not interested." : "The Inbox reads your Gmail and threads every reply to the right conversation." });
    out.push({ when: demo ? "Minutes 5–8" : "Days 2–7", agent: "negotiation", title: "The Negotiator talks money", body: `A quote at or under ${money(p.auto_accept_below)} is accepted at their number. Up to ${money(ceiling)} it counters and closes on its own. Above ${money(ceiling)} it stops and asks you.${p.if_asked_for_call === "email_only" ? " A request for a call is answered by email." : p.if_asked_for_call === "share_calendar" ? " A request for a call gets your calendar." : " A request for a call is brought to you."}${p.if_asked_about_traffic === "use_facts" && p.facts ? " Questions about your business are answered from your facts." : " Questions about your business are brought to you."}` });
    out.push({ when: demo ? "When it happens" : "When it happens", agent: "manager", title: "Needs you", body: `${demo ? "Even in the demo, " : ""}anything outside the rules — a price above ${money(ceiling)}, a call, a claim it cannot make — becomes a card on Needs you and the campaign waits on that thread only. Everything else keeps moving.`, you: true });
    out.push({ when: demo ? "Minute 10" : "Day 7–14", agent: "deals", title: "The Ledger closes the books", body: `Every agreed placement is recorded and its money committed by code, never the model. It stops at ${goal} deal${goal === 1 ? "" : "s"} or when ${money(budget)} is spent, whichever comes first, then winds down every open thread politely.` });
    out.push({ when: "After", agent: "manager", title: "The story and your to-dos", body: "Super writes the campaign's story from the ledger; the Next steps tab lists the real-life to-dos that fall out of it — content to send, invoices to pay, calls to book — each with a date." });
    return out;
  }, [demo, goal, budget, maxPerDeal, seedCount, searchWeb, queries, p.pool_target, p.min_dr, p.tone, p.approve_emails, p.followup_after_days, p.auto_accept_below, p.human_approval_above, p.if_asked_for_call, p.if_asked_about_traffic, p.facts]);

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
        <div className="label">Here's what will happen</div>
        <span className="text-xs text-ink-3">Computed from the plan above; edit a number and this changes.</span>
      </div>
      <Stagger className="relative" step={0.06}>
        <div className="absolute left-[19px] top-4 bottom-4 w-px bg-rule" aria-hidden />
        {stops.map((s, i) => (
          <Item key={i} variants={item} className="relative flex gap-3 py-2.5">
            <Face kind="agent" seed={s.agent} size={40} className={`rounded-lg shrink-0 ring-4 ring-paper ${s.you ? "outline outline-2 outline-[#76b900]" : ""}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="mono text-[11px] text-ink-3 uppercase tracking-wide">{s.when}</span>
                <span className="text-sm font-semibold">{s.title}</span>
                {s.you && <span className="chip !text-[10px] !py-0 bg-[#76b900]/15 text-ink">you</span>}
              </div>
              <p className="text-sm text-ink-2 leading-snug mt-0.5">{s.body}</p>
            </div>
          </Item>
        ))}
      </Stagger>
    </div>
  );
}
