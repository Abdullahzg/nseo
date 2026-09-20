// Model routing. IDs are exactly as GET /v1/models returns them (2026-09-20) — casing differs
// between models on purpose and must not be normalised. Overridable per role via env so a
// deprecation can be handled without a code change.
//
//   orchestrator  — Nemotron 3 Super 120B, thinking ON (1500 tok). One turn per busy tick.
//   fast          — Nemotron 3 Nano 30B, thinking OFF. Relevance, openers, reply classification,
//                   follow-ups, plan preview. 26–110 completion tokens, ~0.5 s.
//   fast_alt      — Nemotron 3.5 Lightning, used when Nano returns 429 (Nano's RPM is 100).
//   negotiation   — Nemotron 3 Ultra 550B for counter-offers, hard-capped at
//                   NEGOTIATION_ULTRA_CAP calls per campaign, then Super.
export type ModelRole = "orchestrator" | "fast" | "fast_alt" | "negotiation" | "negotiation_fallback";

export const MODELS: Record<ModelRole, string> = {
  orchestrator: process.env.NEBIUS_MODEL_ORCHESTRATOR || "nvidia/nemotron-3-super-120b-a12b",
  fast: process.env.NEBIUS_MODEL_FAST || "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  fast_alt: process.env.NEBIUS_MODEL_FAST_ALT || "nvidia/Nemotron-3_5-Lightning",
  negotiation: process.env.NEBIUS_MODEL_NEGOTIATION || "nvidia/Nemotron-3-Ultra-550b-a55b",
  negotiation_fallback: process.env.NEBIUS_MODEL_ORCHESTRATOR || "nvidia/nemotron-3-super-120b-a12b",
};

export const NEGOTIATION_ULTRA_CAP = Number(process.env.NEGOTIATION_ULTRA_CAP ?? 20);

/** Official Nebius prices (USD per 1M tokens) from /v1/models?verbose=true on 2026-09-20 — for the feed's cost column. */
export const PRICE_PER_M: Record<string, { in: number; out: number }> = {
  "nvidia/nemotron-3-super-120b-a12b": { in: 0.3, out: 0.9 },
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": { in: 0.06, out: 0.24 },
  "nvidia/Nemotron-3_5-Lightning": { in: 0.06, out: 0.24 },
  "nvidia/Nemotron-3-Ultra-550b-a55b": { in: 1.0, out: 3.0 },
};

export function costUsd(model: string, tokensIn: number, tokensOut: number): number | null {
  const p = PRICE_PER_M[model];
  if (!p) return null;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}

/** Short human label for the feed ("Nemotron 3 Super"). */
export function modelLabel(model: string): string {
  if (/super/i.test(model)) return "Nemotron 3 Super";
  if (/nano/i.test(model)) return "Nemotron 3 Nano";
  if (/lightning/i.test(model)) return "Nemotron 3.5 Lightning";
  if (/ultra/i.test(model)) return "Nemotron 3 Ultra";
  return model;
}
