# Fusion Dumb Forwarder Specification (Port 7768)

## Overview
The Fusion sidecar is a standalone FastAPI application running on port 7768. It provides a single virtual model `local/google` which transparently falls back through a priority chain of physical models on the LiteRouter (7766) gateway.

The goal is a "dumb forwarder" that mirrors the gateway's routes, providing resilience without modifying the core gateway logic.

## Fallback Chain
The `local/google` virtual model rotates through the following priority list:
1. `google/gemma-4-31b-it` (Primary / Thinking)
2. `google/gemini-3.1-flash-lite` (Secondary / Fast)
3. `google/gemma-4-26b-a4b-it` (Tertiary / Stable)

## Routing Logic

### 1. Native Google Route (`/v1beta`)
This route supports native Google AI SDK payloads (including `thinkingConfig`).

- **Endpoint**: `POST /v1beta/models/local/google:generateContent`
- **Forwarding**: Maps to `POST /v1beta/models/{backend_model}:generateContent` on port 7766.
- **Payload**: Forwarded verbatim — no sanitization. 7766 handles all model-specific logic.
- **Error Handling**:
  - **Success (200)**: Return response to client.
  - **Retryable (429, 500, 502, 503, 504, Timeout)**: Open circuit breaker for `{backend_model}` (TTL 65s), log the failure, and attempt the next model in the chain.
  - **Fatal (400, 401, 403)**: Return the error immediately to the client. Do NOT advance the chain; these errors are client-side or auth-related and would just "burn" other keys.

### 2. OpenAI Compatible Route (`/v1`)
- **Endpoint**: `POST /v1/chat/completions` with `model="local/google"`
- **Forwarding**: Maps to `POST /v1/chat/completions` on port 7766 with `model={backend_model}`.
- **Error Handling**: Same as the native route (Retryable → Next; Fatal → Halt).

## Circuit Breaker
To prevent the "All Models Freeze" feedback loop, the sidecar maintains a per-model circuit breaker.

- **Scope**: Global to the sidecar, scoped per `backend_model`.
- **Trigger**: Any retryable error (429/5xx/Timeout).
- **Recovery**: TTL of 65 seconds, mirroring the LiteRouter gateway's rate-limit cooldown.
- **Behavior**: If a model's circuit is open, the sidecar skips it immediately and moves to the next available model in the chain.

## Implementation Checklist
- [x] **Correct Native Pathing**: Fusion strips `models/` prefix before model lookup.
- [x] **Dumb Forwarder**: Payload forwarded verbatim — no sanitization in fusion.py.
- [x] **End-to-End Verified**: `curl` confirms 200 response via 7768→7766→Google upstream.
