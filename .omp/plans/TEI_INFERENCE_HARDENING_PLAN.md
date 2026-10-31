# Plan: Harden and Redesign LiteRouter TEI Inference (Issue #5)

## Context
Production experienced an unhandled HTTP 500 outage during an idle period when ZeroTier transport between VPS (`10.32.34.243`) and WSL2 (`10.32.34.172`) dropped. While both local TEI instances (WSL2 CUDA and VPS CPU) were completely healthy, LiteRouter crashed because:
1. `DEFAULT_EMBEDDING_DIRECTIVE` was hardcoded to `lr-tei-oa-em-no`, bypassing LiteRouter's Fusion fallback engine.
2. `config/fusion.json` only had Priority 1 (WSL2 CUDA) and lacked the 24/7 VPS CPU instance (`127.0.0.1:8002`).
3. `src/engine/dispatch.ts:837` executed `throw err;` on attempt exhaustion, making lines 841–859 (structured 502) dead code and bubbling an unhandled exception to `src/index.ts:596`.
4. `src/handlers/v4/openai_embeddings.ts` lacked a `try/catch` error boundary around `executeDispatchPipeline`.

This plan transitions TEI embeddings to a dual-tier Active-Passive Fusion architecture on the Sovereign LAN with fail-fast timeouts, sticky cache recovery, unblocked 502 error responses, defensive boundaries, and a dedicated operational runbook SKILL (`literouter-flbo.1`), executed via `workflowz` with smol model subagents (`m1` - Nemotron 3 Ultra).

---

## Workflowz Multi-Subagent Decomposition

Using `workflowz` fan-out with model `m1` (`Nemotron 3 Ultra (LR)` / smol model):

| Batch | Worker / Agent | Slice | Target Files | Responsibilities | Mode |
|:---|:---|:---|:---|:---|:---|
| **Wave 1** | Worker 1 (`m1`) | **Slice 1: Provider & Fusion Config** | `src/config/schema.ts`<br>`src/directive/parser.ts`<br>`config/providers.json`<br>`config/fusion.json` | Register `teivps` provider; configure `tei-wsl.lan:8002` (Tier 1) and `127.0.0.1:8002` (Tier 2); setup `embeddings` fusion preset with `BAAI/bge-m3` and `bge-m3`. | Parallel |
| **Wave 1** | Worker 2 (`m1`) | **Slice 2: Routing & Error Boundaries** | `src/handlers/v4/openai_embeddings.ts`<br>`src/index.ts`<br>`src/engine/dispatch.ts`<br>`src/handlers/openai_compat.ts` | Set `DEFAULT_EMBEDDING_DIRECTIVE = "lr-fse-embeddings"`; add `try/catch` error boundary in `openai_embeddings.ts`; replace `throw err;` with structured 502 in `dispatch.ts:837`; sanitize mock key seeding in `openai_compat.ts:168`. | Parallel |
| **Wave 1** | Worker 3 (`m1`) | **Slice 3: Operational SKILL** | `.opencode/skills/bgem3-dual-instance-setup/SKILL.md` | Author operational SKILL documenting network topology, Windows PortProxy, ASUS Merlin router DNS, Docker container run specs, and failover runbooks (`literouter-flbo.1`). | Parallel |
| **Wave 2** | Worker 4 (`m1`) | **Slice 4: Tests & Verification Gate** | `tests/handlers/openai_embeddings.test.ts` | Add regression test cases for ambient auth defaulting to `lr-fse-embeddings`, dual-tier fusion fallback, and 502 error returns; execute full typecheck and test runner. | Sequential (post Wave 1) |

---

## Approach

### Step 1: Register `teivps` and Configure Dual-Tier Fusion (Slice 1)
1. **`src/config/schema.ts`**:
   - Add `"teivps"` to `ProviderCodeSchema` enum (`line 18`).
2. **`src/directive/parser.ts`**:
   - Add `"teivps"` to `ProviderCode` union type (`line 15`).
   - Add `"teivps"` to `VALID_PROVIDERS` set (`line 70`).
3. **`config/providers.json`**:
   - Update `tei` entry:
     - `base_url`: change from `http://10.32.34.172:8002` to `http://tei-wsl.lan:8002`.
     - `name`: `"Text Embeddings Inference (WSL CUDA)"`.
     - `request_retry.max_attempts`: set to `2`.
   - Add `teivps` provider entry:
     - `code`: `"teivps"`
     - `name`: `"Text Embeddings Inference (VPS CPU)"`
     - `env_key`: `"TEI_API_KEYS"`
     - `strategy`: `"standard"`
     - `base_url`: `"http://127.0.0.1:8002"`
     - `auth_header`: `"Bearer"`
     - `headers`: `{ "Content-Type": "application/json" }`
     - `endpoints`: `{ "em": "/v1/embeddings" }`
     - `request_retry`: `{ "enabled": true, "max_attempts": 2, "delay": { "min_ms": 150, "max_ms": 500 } }`
     - `pacer`: `{ "enabled": true, "min_delay_ms": 10, "max_delay_ms": 50, "max_queue_depth": 500, "max_queue_wait_ms": 5000, "max_concurrency": 8 }`
4. **`config/fusion.json`**:
   - Update preset `"embeddings"` to configure dual tiers for both `"BAAI/bge-m3"` and `"bge-m3"`:
     ```json
     "embeddings": {
       "strategy": "sticky_fallback",
       "timeout_ms": 30000,
       "models": {
         "BAAI/bge-m3": {
           "tiers": [
             { "priority": 1, "apikey": "lr-tei-oa-em-no", "model": "BAAI/bge-m3" },
             { "priority": 2, "apikey": "lr-teivps-oa-em-no", "model": "BAAI/bge-m3" }
           ]
         },
         "bge-m3": {
           "tiers": [
             { "priority": 1, "apikey": "lr-tei-oa-em-no", "model": "BAAI/bge-m3" },
             { "priority": 2, "apikey": "lr-teivps-oa-em-no", "model": "BAAI/bge-m3" }
           ]
         }
       }
     }
     ```

### Step 2: Gateway Ambient Routing & Error Boundary Hardening (Slice 2)
1. **`src/handlers/v4/openai_embeddings.ts`**:
   - Change `DEFAULT_EMBEDDING_DIRECTIVE`:
     ```typescript
     export const DEFAULT_EMBEDDING_DIRECTIVE = "lr-fse-embeddings";
     ```
   - In `handleOpenAiEmbeddings`:
     - Wrap chunk dispatch (`line 89`) and single-input dispatch (`line 126`) in a `try/catch` error boundary:
       ```typescript
       try {
         return await executeDispatchPipeline(dispatchReq);
       } catch (err: unknown) {
         telemetry.error("Unhandled error in executeDispatchPipeline for embeddings", err);
         return new Response(
           JSON.stringify({
             error: {
               message: err instanceof Error ? err.message : "Embeddings dispatch failed",
               type: "gateway_error",
               code: "embeddings_dispatch_error",
             },
           }),
           { status: 502, headers: { "content-type": "application/json" } }
         );
       }
       ```
2. **`src/index.ts`**:
   - Line 571: Replace hardcoded `"lr-tei-oa-em-no"` with `DEFAULT_EMBEDDING_DIRECTIVE`:
     ```typescript
     if (EMBEDDINGS_PATHS.has(path) && !rawKey) {
       rawKey = DEFAULT_EMBEDDING_DIRECTIVE;
     }
     ```
3. **`src/engine/dispatch.ts:830-860`**:
   - Replace line 837 `throw err;` with returning the structured 502 response:
     ```typescript
     telemetry.served(502, attempt, maxAttempts);
     recordTrace(telemetry, 502, {
       clientInbound: sanitizeBody(req.rawInboundBody, MAX_LEG_BYTES),
       upstreamOutbound: sanitizeBody(req.outboundPayload.body, MAX_LEG_BYTES),
     });
     return new Response(
       JSON.stringify({
         error: {
           message: `Provider ${provConfig.name ?? providerCode} retry attempts exhausted: ${err instanceof Error ? err.message : String(err)}`,
           type: "gateway_error",
           code: "retries_exhausted",
         },
       }),
       {
         status: 502,
         headers: { "content-type": "application/json" },
       }
     );
     ```
   - Remove the redundant duplicate block at lines 841–859.
4. **`src/handlers/openai_compat.ts:166-170`**:
   - In `initializeKeyPools`, seed keyless providers with a single mock token `[`sk-stub-${code}-mock-key-1`]` so pacer does not log false `Key #1/2 -> Key #2/2` rotation logs.

### Step 3: Author Operational SKILL `bgem3-dual-instance-setup` (Slice 3 / `literouter-flbo.1`)
1. Create `.opencode/skills/bgem3-dual-instance-setup/SKILL.md`:
   - Document the Sovereign LAN active-passive failover topology.
   - Exact Windows PortProxy command:
     `netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8002 connectaddress=127.0.0.1 connectport=8002`
   - Exact Windows Firewall inbound rule:
     `New-NetFirewallRule -DisplayName "TEI-WSL-8002" -Direction Inbound -LocalPort 8002 -Protocol TCP -Action Allow`
   - ASUS RT-BE92U Merlin `/jffs/configs/hosts.add` DNS mappings:
     `192.168.50.199 tei-wsl.lan` and `192.168.50.10 tei-vps.lan`.
   - Docker container specs:
     - WSL2 CUDA: `ghcr.io/huggingface/text-embeddings-inference:turing-1.6` with `--gpus all --net=host -m 4g`.
     - VPS CPU: `ghcr.io/huggingface/text-embeddings-inference:cpu-1.6` with `-p 127.0.0.1:8002:80 -m 4g --restart always`.
   - Healthcheck probes and failover test runbook.

### Step 4: Regression Tests & Verification (Slice 4)
1. **`tests/handlers/openai_embeddings.test.ts`**:
   - Add test: `handleV4OpenAIEmbeddings defaults to lr-fse-embeddings on empty rawKey`.
   - Add test: `handleAppRequest routes unauthenticated POST /v1/embeddings to lr-fse-embeddings`.
   - Add test: `executeDispatchPipeline returns structured 502 on network retry exhaustion without throwing unhandled exception`.
2. Run Typecheck: `bun run typecheck` (exit 0).
3. Run Unit Tests: `bun run test` (all 1550+ tests pass).
4. Run Targeted Handlers Test: `bun run test handlers`.

---

## Critical Files & Anchors

1. `src/config/schema.ts:18` — Add `"teivps"` to `ProviderCodeSchema`.
2. `src/directive/parser.ts:15, 70` — Add `"teivps"` to `ProviderCode` type and `VALID_PROVIDERS` set.
3. `config/providers.json:198-228` — Update `tei` `base_url` to `http://tei-wsl.lan:8002`, add `teivps` at `http://127.0.0.1:8002`.
4. `config/fusion.json:146-160` — Configure preset `"embeddings"` with Priority 1 (`lr-tei-oa-em-no`) and Priority 2 (`lr-teivps-oa-em-no`).
5. `src/handlers/v4/openai_embeddings.ts:12, 89, 126` — Set `DEFAULT_EMBEDDING_DIRECTIVE = "lr-fse-embeddings"` and wrap dispatch in defensive `try/catch`.
6. `src/index.ts:571` — Use `DEFAULT_EMBEDDING_DIRECTIVE` for ambient embeddings requests.
7. `src/engine/dispatch.ts:837` — Return structured 502 response on retry exhaustion instead of `throw err;`.
8. `.opencode/skills/bgem3-dual-instance-setup/SKILL.md` — New operational runbook for dual-instance setup.

---

## Verification Plan

### Automated Verification
```bash
# 1. Static Typecheck (must pass with 0 errors)
bun run typecheck

# 2. Targeted Embeddings & Handlers Unit Tests
bun test tests/handlers/openai_embeddings.test.ts
bun run test handlers

# 3. Full Accelerated Unit Test Suite (1550+ tests, all 7 domains)
bun run test

# 4. AST Anti-Slop & Quality Inspection
node node_modules/clean_ts/dist/cli.js validate src/handlers/v4/openai_embeddings.ts
node node_modules/clean_ts/dist/cli.js validate src/engine/dispatch.ts
```

### End-to-End Functional Verification (Throwaway Smoke Probe)
Run an isolated script verifying:
1. `POST /v1/embeddings` without Authorization header successfully parses and returns `200 OK` with vector embedding.
2. Simulating Tier 1 unreachable (dummy port) immediately falls back to Tier 2 and returns `200 OK` within <1 second.
3. Simulating both tiers unreachable returns clean `502 Bad Gateway` (`gateway_error: retries_exhausted`) without triggering an unhandled 500 error in gateway logs.

---

## Assumptions & Contingencies
- **PortProxy / DNS Setup**: Assumes Windows PortProxy on `192.168.50.199:8002` forwards to WSL2 `127.0.0.1:8002`. Contingency: If `tei-wsl.lan` DNS is not yet flushed on the router during local dev, LiteRouter's Tier 2 fallback immediately catches the request on local `127.0.0.1:8002` with 0 downtime.
- **Downstream Callers**: Zero changes required across client repos (`baziforecast`, etc.). They continue targeting `POST http://literouter.lan:7766/v1/embeddings` with ambient auth.
