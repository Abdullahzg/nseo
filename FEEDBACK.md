# Feedback on Nebius Token Factory and NVIDIA Nemotron

Written from building Geseo (Sept 2026). Everything below was observed with real calls; where I
measured something the numbers are in `docs/RESEARCH.md`.

## What worked well
- **`GET /v1/models?verbose=true` is excellent** — official prices, per-model RPM/TPM, region and
  `supported_features` in one call. It should be the first thing the docs mention; I found it by
  accident. It let me build a health check that fails loudly if a routed model disappears.
- **Nemotron 3 Nano with `chat_template_kwargs: {enable_thinking: false}`** is the best
  price/latency I have used for structured judgments: ~70 tokens, ~0.5 s, `json_schema` honoured.
  This single knob made a per-decision model architecture affordable on hackathon credits.
- **Tool calling and tool round-trips work on all four Nemotron 3 models** through the
  OpenAI-compatible endpoint, contrary to the May report in `nebius/api#211`. Please close or
  update that issue; it nearly steered me away from Nemotron.
- Super's `reasoning_content` is short, relevant, and makes a great user-facing "why" — I show it in
  the product's activity feed.

## Rough edges (with repro)
1. **Reasoning field name differs by model.** Nano returns `message.reasoning`; Super/Ultra/Lightning
   return `message.reasoning_content` (Super returns both). One name, please, or document it.
2. **Nano JSON mode occasionally degenerates into a runaway** (~1 in 12 calls in my runs): the same
   prompt that normally returns 70 tokens hits `max_tokens` with `finish_reason: "length"`, output
   drifting (`"spam_risk":  "low"` with double spaces before it dies). I retry once on 3.5
   Lightning. A server-side repetition guard in JSON mode would remove the workaround.
3. **`supported_features` does not list `json_mode`/`structured_outputs` for any Nemotron**, yet
   `response_format: json_schema` works on all four. Either the metadata or the docs are behind.
4. **With thinking on, a modest `max_tokens` truncates the thinking and the answer is lost.**
   Lightning under `response_format` even leaks the partial trace into `content`. A
   `max_reasoning_tokens` / `reasoning_effort` parameter (some OpenRouter providers expose one)
   would make budgets predictable. Ultra's thinking on a short negotiation prompt ranged 500–2,000+
   tokens run to run.
5. **Regional host confusion.** `api.tokenfactory.nebius.com` and
   `api.tokenfactory.us-central1.nebius.com` both accept the same key but list different models
   (24 vs 17). The docs mention only the global host.
6. **Rate-limit floor on Nano is 100 RPM** while Lightning (same price) is 600. Worth calling out in
   the model card; it decides which "fast" model a batch workload should route to.
7. The docs' function-calling page lists a single Llama model as the example; a Nemotron example
   plus a note on `enable_thinking` would save every hackathon team an afternoon.

## Small asks
- A `usage.completion_tokens_details.reasoning_tokens` field is present on some models and null on
  Nano — consistency here would let apps bill reasoning separately.
- Publish the promo-credit expiry date; teams need to know whether credits survive a
  judging window six weeks after the deadline.
