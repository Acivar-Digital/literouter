# 🪦 JSON Cleaner Pass (OpenRouter-style)

**Status**: 🪦 **Canned**

## Context

OpenRouter exposes `openrouter/cleaner` — a small model you pipe raw model output
through to repair malformed content, most commonly broken/unparseable JSON
(trailing commas, comments, unescaped quotes, missing brackets). A user asked
whether LiteRouter should replicate this: do we need it, can we, should we?

Investigation of the codebase (`src/index.ts`, `src/lib.ts`):

- The gateway already normalizes on the **request** path:
  `cleanGemmaPayload` (lib.ts:85) strips unsupported keys before forwarding to
  providers; `translateGoogleThinking` (lib.ts:114) translates thinking config
  into the accepted `reasoning_effort` form.
- It already sanitizes on the **text** path:
  `cleanLatexSymbols` (lib.ts:141) fixes LaTeX in streamed text;
  `transformNonStreaming` (lib.ts:186) collapses reasoning into a clean message shape.
- It does **not** perform any JSON-repair/cleaner pass on model responses.

**Can we?** Trivially — a pure helper in `lib.ts` plus a flag, matching the
existing pattern.

**Do we need to?** No. The gateway is a transparent router. `response_format`
passes through to upstreams (Gemini, Gemma, NVIDIA/Nemotron, OpenRouter models),
which enforce JSON themselves. The OpenRouter cleaner exists because they
aggregate hundreds of unruly upstreams; that burden is not ours at this layer.

## Decision — Canned

We will **not** add a JSON-cleaner / JSON-repair pass to responses. Reasons:

1. **Fail-loud principle (AGENTS.md):** a silent repair pass masks upstream
   provider bugs from the caller. Better to surface the malformed output so the
   client and the upstream both learn about it.
2. **Latency / cost tax:** a cleaner pass (whether a model call or a regex
   repair) adds work on every response. For a thin router this is an unjustified
   per-request tax.
3. **Transparency:** the gateway's job is to forward `response_format` and let
   the upstream enforce it. Injecting a repair step breaks the transparent
   contract.

The optional middle-ground (a client-opt-in `x-literouter-clean-json` flag that
runs a JSON-repair helper only when requested) is **also canned** — keep the
gateway transparent. If a client needs JSON repair, they should request it from
their upstream or post-process locally.

## Rejected Options

- Default-on cleaner pass — rejected (fail-loud + latency).
- Optional client-opt-in `x-literouter-clean-json` flag — rejected (keep
  transparent; clients own their JSON contract).
- Routing problematic responses through `openrouter/cleaner` as a sub-call —
  rejected (adds an external dependency and a second round-trip).
