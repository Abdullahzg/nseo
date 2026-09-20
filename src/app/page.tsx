"use client";

import Link from "next/link";
import { ArrowRight, Bot, Search, Mail, Shield, Zap, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SummitMark } from "@/components/brand/SummitMark";

const STATS = [
  { value: "8", label: "AI Agents", sub: "SEO SPECIALISTS" },
  { value: "16", label: "Tool endpoints", sub: "INTEGRATIONS" },
  { value: "5", label: "Pipeline stages", sub: "AUTOMATED" },
  { value: "24/7", label: "Autonomous", sub: "NO HUMAN NEEDED" },
];

const FEATURES = [
  {
    icon: Search,
    title: "Discover",
    desc: "AI agents scan the web for high-authority publications, relevant blogs, and backlink opportunities in your niche using Tavily search.",
  },
  {
    icon: BarChart3,
    title: "Qualify",
    desc: "LLM-powered scoring evaluates domain authority, content relevance, and SEO fit — filtering out low-value prospects automatically.",
  },
  {
    icon: Shield,
    title: "Resolve",
    desc: "Automated contact resolution finds editor and author emails through page scraping, AI extraction, and Hunter.io integration.",
  },
  {
    icon: Mail,
    title: "Outreach",
    desc: "Personalized backlink request emails drafted with AI-generated openers, sent via SMTP — each one tailored to the target publication.",
  },
  {
    icon: Bot,
    title: "Negotiate",
    desc: "AI handles reply classification, pricing negotiation within your budget, and deal recording — from guest post to paid placement.",
  },
  {
    icon: Zap,
    title: "Monitor",
    desc: "Real-time IMAP monitoring detects replies, classifies intent, and routes conversations — so no backlink opportunity slips through.",
  },
];

const STEPS = [
  { num: "01", title: "Create campaign", desc: "Set your SEO objective, target keywords, budget, and domain authority bar. The agents take it from there." },
  { num: "02", title: "AI runs the pipeline", desc: "8 specialized agents work autonomously: discover prospects, qualify by DA, find contacts, send outreach, negotiate backlink deals." },
  { num: "03", title: "Close backlinks", desc: "Monitor progress in real-time. Intervene when needed. Close deals and track your growing backlink profile from the dashboard." },
];

export default function HomePage() {
  return (
    <div className="noise-overlay relative min-h-screen overflow-hidden">
      {/* Header */}
      <header className="fixed z-50 top-0 left-0 right-0">
        <nav className="mx-auto max-w-[1400px] px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <Link href="/" className="flex items-center gap-2.5">
              <SummitMark className="size-8" />
              <span className="font-display tracking-tight text-2xl">Geseo</span>
            </Link>
            <div className="hidden md:flex items-center gap-12">
              <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors relative group">
                Features
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-foreground transition-all duration-300 group-hover:w-full" />
              </a>
              <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors relative group">
                How it works
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-foreground transition-all duration-300 group-hover:w-full" />
              </a>
              <Link href="/campaigns" className="text-sm text-muted-foreground hover:text-foreground transition-colors relative group">
                Campaigns
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-foreground transition-all duration-300 group-hover:w-full" />
              </Link>
            </div>
            <div className="hidden md:flex items-center gap-4">
              <Link href="/campaigns" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Sign in
              </Link>
            <Link href="/campaigns/autonomous">
              <Button size="sm" className="rounded-xl px-6">
                Get started <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </Link>
            </div>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative flex flex-col justify-center overflow-hidden pt-32 pb-16 md:pt-44 md:pb-20">
        <div className="relative z-10 max-w-[1152px] mx-auto px-6 text-center">
          <span className="fade-up font-mono text-xs tracking-[0.15em] text-muted-foreground uppercase">
            AI-powered SEO backlink platform
          </span>
          <h1 className="font-display mx-auto mt-7 mb-8 max-w-[16ch] text-[clamp(2.75rem,8vw,5rem)] font-semibold leading-[0.96] tracking-[-0.03em]">
            <span className="inline-block overflow-hidden align-bottom">
              <span className="rise-in inline-block" style={{ animationDelay: "0ms" }}>Backlinks</span>
            </span>{" "}
            <span className="inline-block overflow-hidden align-bottom">
              <span className="rise-in inline-block" style={{ animationDelay: "70ms" }}>,</span>
            </span>{" "}
            <span className="inline-block overflow-hidden align-bottom">
              <span className="rise-in inline-block" style={{ animationDelay: "140ms" }}>automated</span>
            </span>
          </h1>
          <p className="fade-up mx-auto max-w-[46ch] text-[19px] font-medium leading-[1.4] tracking-[-0.02em] text-muted-foreground" style={{ animationDelay: "120ms" }}>
            8 AI agents run your entire SEO backlink pipeline. From prospect discovery to deal closure — guest posts, niche edits, and paid placements, fully autonomous.
          </p>
          <div className="fade-up mt-10 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: "200ms" }}>
            <Link href="/campaigns/autonomous">
              <Button size="lg" className="rounded-xl px-6 h-11">
                Create campaign <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/campaigns">
              <Button variant="outline" size="lg" className="rounded-xl px-6 h-11">
                View campaigns
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Stats marquee */}
      <div className="fade-up relative z-10 border-y border-border py-6 md:py-8 overflow-hidden" style={{ animationDelay: "320ms" }}>
        <div className="flex gap-16 marquee whitespace-nowrap">
          {[...STATS, ...STATS].map((s, i) => (
            <div key={i} className="flex items-baseline gap-4">
              <span className="text-4xl lg:text-5xl font-display font-semibold tracking-[-0.02em]">{s.value}</span>
              <span className="text-sm text-muted-foreground">
                {s.label}
                <span className="block font-mono text-xs mt-1 tracking-[0.12em]">{s.sub}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Features */}
      <section id="features" className="relative py-20 md:py-28">
        <div className="max-w-[1152px] mx-auto px-6">
          <div className="text-center mb-16">
            <span className="font-mono text-xs tracking-[0.15em] text-muted-foreground uppercase">Capabilities</span>
            <h2 className="font-display mt-4 text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
              Every stage of backlink acquisition, automated
            </h2>
            <p className="mt-4 text-muted-foreground text-lg max-w-[50ch] mx-auto">
              From finding high-DA prospects to closing guest post deals, each step is handled by a specialized AI agent.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="fade-up group p-6 rounded-2xl border border-border bg-card hover:bg-muted/50 transition-colors"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-4">
                  <f.icon className="h-5 w-5 text-foreground" />
                </div>
                <h3 className="font-display text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="relative py-20 md:py-28 bg-foreground text-background overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
          <div
            style={{
              backgroundImage: "repeating-linear-gradient(-45deg, transparent, transparent 40px, currentColor 40px, currentColor 41px)",
              width: "100%",
              height: "100%",
            }}
          />
        </div>
        <div className="relative z-10 max-w-[1152px] mx-auto px-6">
          <div className="text-center mb-16">
            <span className="font-mono text-xs tracking-[0.15em] uppercase opacity-50">Process</span>
            <h2 className="font-display mt-4 text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
              How it works
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <div key={s.num} className="fade-up" style={{ animationDelay: `${i * 100}ms` }}>
                <span className="font-mono text-sm opacity-40">{s.num}</span>
                <h3 className="font-display text-xl font-semibold mt-2 mb-3">{s.title}</h3>
                <p className="text-sm opacity-60 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-20 md:py-28">
        <div className="max-w-[1152px] mx-auto px-6 text-center">
          <h2 className="font-display text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.025em] mb-6">
            Start building backlinks
          </h2>
          <p className="text-muted-foreground text-lg max-w-[50ch] mx-auto mb-10">
            No credit card required. Toggle demo mode to see the full SEO pipeline in action with simulated publishers.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/campaigns/autonomous">
              <Button size="lg" className="rounded-xl px-8 h-12 text-base">
                Create campaign <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-[1152px] mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SummitMark className="size-5" />
            <span className="text-sm text-muted-foreground">Geseo</span>
          </div>
          <span className="text-xs text-muted-foreground">AI SEO Backlink Platform</span>
        </div>
      </footer>
    </div>
  );
}
