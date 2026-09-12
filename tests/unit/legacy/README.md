# LiteRouter Legacy Dual-Path Fallback Test Suite

Hermetic unit tests validating legacy monolithic route handlers, outbound HTTP/2 multiplex connection pools, and backward compatibility paths in LiteRouter.

```
tests/unit/legacy/
├── h2_pool.test.ts                      # Outbound HTTP/2 multiplexed session pool lifecycle
├── h2_drain.test.ts                     # In-flight stream draining & GOAWAY frame handling
├── fetcher.test.ts                      # Legacy raw fetch transport & retry logic
├── classifier.test.ts                   # Upstream error classification (429, 500, network error)
├── header_sanitizer.test.ts             # Legacy hop-by-hop & sensitive header sanitization
├── anthropic_openai_compat.test.ts      # Legacy Anthropic to OpenAI compatibility layer
├── openai_original.test.ts              # Legacy OpenAI Responses API handler
├── openai_original_h2.test.ts           # Legacy HTTP/2 OpenAI handler
├── gcp_compat.test.ts                   # Legacy GCP Vertex compatibility handler
├── google_native_dumb_forwarder.test.ts # Legacy Google native forwarder without cascades
├── google_native_fusion.test.ts         # Legacy Google native fusion cascading logic
└── google_native_v1_g1.test.ts          # Legacy Gemini v1/g1 endpoint compatibility
```

---

## 1. Scope & Purpose

LiteRouter v4.1 introduces a modern unified engine (`src/engine/dispatch.ts`), but retains a **Dual-Path Execution Architecture** to guarantee zero downtime and risk-free rollbacks.

When running under `LITEROUTER_ENGINE=legacy` (or when `x-literouter-engine: legacy` is sent via header override), request traffic routes through the legacy monolithic handlers in `src/handlers/legacy/` and transport components in `src/network/`.

The tests in this directory ensure that:
1. All legacy handlers continue to function with 100% fidelity.
2. The HTTP/2 outbound connection pool properly multiplexes streams and drains connections without data corruption.
3. Upstream error parsing, header sanitization, and failover classification match expected contracts.

---

## 2. Test Coverage

### 2.1 HTTP/2 Transport & Session Pooling
- **`h2_pool.test.ts`**: Verifies `OutboundH2Pool` session acquisition, concurrency limits, ping/keepalive intervals, stream count tracking, and per-API-key connection isolation.
- **`h2_drain.test.ts`**: Verifies handling of server `GOAWAY` frames, graceful in-flight stream completion, and session destruction once active streams hit zero.
- **`fetcher.test.ts`**: Tests fallback to standard HTTP/1.1 `fetch` when HTTP/2 negotiation fails or is disabled via configuration.

### 2.2 Legacy Monolithic Route Handlers
- **`openai_original.test.ts` & `openai_original_h2.test.ts`**: Native OpenAI `/v1/responses` handler routing, stream chunk framing, and error pass-through.
- **`anthropic_openai_compat.test.ts`**: Legacy translation from Anthropic Messages requests to OpenAI Chat completions.
- **`gcp_compat.test.ts`**: Legacy GCP Vertex AI OpenAI-compatible endpoint handler.
- **`google_native_dumb_forwarder.test.ts`**: Direct REST passthrough to Google Generative Language API without cascade fallbacks.
- **`google_native_fusion.test.ts`**: Legacy implementation of sticky tier fallback logic (`gemini-flash` -> `3.8` -> `3.7` -> `3.6` -> `3.5`).
- **`google_native_v1_g1.test.ts`**: Legacy endpoint rewrites for Gemini v1 endpoints.

### 2.3 Upstream Parsing & Sanitization
- **`classifier.test.ts`**: Tests status code and error body classification (`retry_same_target`, `advance_target`, `fail_fast`).
- **`header_sanitizer.test.ts`**: Strips hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`) and scrubs raw API keys.

---

## 3. How to Run

### Run Full Legacy Suite
```bash
bun run test:legacy
```
*Executes all 179 tests across 12 files in ~7s.*

### Run Direct Subdirectory Path
```bash
bun test tests/unit/legacy/
```

### Run a Specific Legacy Component
```bash
# HTTP/2 multiplex connection pool tests only
bun test tests/unit/legacy/h2_pool.test.ts

# Legacy Google Fusion handler only
bun test tests/unit/legacy/google_native_fusion.test.ts
```

---

## 4. Maintenance Guidelines

- **Freeze Policy**: As part of the v4.1 modernization, new features should be implemented in `src/engine/` and `src/transformers/`. Legacy handlers are in maintenance-only mode.
- **Parity Assurance**: Any modifications to legacy handlers must be validated against `tests/integration/test_v4_ab_parity.py` to ensure 100% parity between legacy and v4 engine outputs.
