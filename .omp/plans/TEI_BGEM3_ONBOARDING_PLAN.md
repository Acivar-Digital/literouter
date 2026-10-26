# Execution Plan: Onboard TEI BGE-M3 in LiteRouter (WSL2 CUDA Primary on 192.168.50.199:8002 -> VPS CPU Fallback on 127.0.0.1:8002)

## Context
Multiple internal clients (OMP Mnemopi vector memory, Baziforecaster RAG, Chronomancer, and CortexKit AFT semantic search) perform embedding workloads against Hugging Face TEI (`BAAI/bge-m3`). Under concurrent ingestion and query recall, single-instance TEI saturates (HTTP 429 Too Many Requests, 503, or dropped connections), causing client crashes.
This plan establishes LiteRouter as the authoritative embedding gateway:
1. Implements `POST /v1/embeddings` in LiteRouter (built and tested in WSL2, then synced to VPS).
2. WSL2 Docker container `tei-bge` runs Hugging Face TEI with CUDA on GPU, serving on port `8002` (reachable across the LAN as `192.168.50.199:8002` via the established repository port-proxy recipe).
3. Configures dual-host active-passive failover in LiteRouter:
   - **Tier 1 (Primary)**: WSL2 CUDA instance (`http://192.168.50.199:8002/v1/embeddings`).
   - **Tier 2 (Fallback)**: VPS CPU instance (`http://127.0.0.1:8002/v1/embeddings`) transparently on HTTP 429, 503, connection drops, or timeouts.
4. Tunes Docker TEI containers on WSL2 (batch size 8, concurrency 8, tokens 2048, 4GB cap) and VPS (batch size 4, concurrency 4, tokens 1024, 4GB cap).
5. Handles client compatibility: ambient unauthenticated AFT traffic via default embedding directive fallback, CPU fallback token-bucket concurrency pacing (max 4), and client input chunk slicing for batches $> 8$.
6. Configures AFT semantic search and OMP Mnemopi across WSL2 and VPS to route through LiteRouter (`http://literouter.lan:7766/v1`).

---

## Approach

### Part 1: Build in LiteRouter (WSL2 Dev Golden Truth), Sync to VPS, and Test

#### Step 1.1: Directive Grammar & Schema Registration
- **`src/config/schema.ts`**:
  - Add `"tei"` to `ProviderCodeSchema` enum (`src/config/schema.ts:3`).
  - Verify completion code `"em"` is present in `CompletionCodeSchema` (`src/config/schema.ts:28`).
- **`src/directive/parser.ts`**:
  - Add `"tei"` to `ProviderCode` type union (`:1-14`) and `VALID_PROVIDERS` array (`:53-67`).
  - Verify completion code `"em"` is present in `CompletionCode` union (`:20-30`) and `VALID_COMPLETIONS` array (`:78-83`).

#### Step 1.2: Embedding Payload Transformer & Batch Chunk Slicing
- Create `src/transformers/openai_embeddings.ts`:
  - Implement `PayloadTransformerContract` from `src/engine/transformer.ts`.
  - Method `transformClientToWire(inboundBody, directive, clientHeaders)`:
    - Sets `endpointKey: "em"`.
    - Sets `method: "POST"`.
    - Normalizes `inboundBody.input`: Accepts `string`, `Array<string>`, or token IDs.
    - If `Array.isArray(inboundBody.input)` and length $> 8$, slices into chunks of $\le 8$ items to prevent TEI HTTP 422 (`batch size exceeds max`), aggregating vectors before returning.
    - Formats outgoing body: `{ input: inboundBody.input, model: inboundBody.model ?? "BAAI/bge-m3" }`.
    - Preserves client `Content-Type: application/json`.
    - Flags `isStreaming: false`.
  - Method `transformWireToClient(upstreamJson, directive)`:
    - Validates upstream JSON structure. Passes through standard OpenAI embedding object:
      `{ object: "list", data: [...], model: "BAAI/bge-m3", usage: { prompt_tokens, total_tokens } }`.
  - Method `createWireToClientStream()`:
    - Returns simple passthrough `TransformStream<Uint8Array, Uint8Array>()` (embeddings are non-streaming).
  - Export singleton `openAiEmbeddingsTransformer`.

#### Step 1.3: v4.1 Route Handler, Router Registration & Ambient Auth Fallback
- Create `src/handlers/v4/openai_embeddings.ts`:
  - Export `handleV4OpenAIEmbeddings(req: Request, rawKey: string, reqId: string): Promise<Response>`.
  - Handle Ambient/Unauthenticated Requests (for CortexKit AFT):
    - If `rawKey` is missing or empty, automatically default `rawKey` to `"lr-tei-oa-em-no"` (or `"lr-fse-embeddings"`).
  - Parse inbound JSON body.
  - Parse directive key using `parseDirectiveKey(rawKey)`.
  - Assemble `DispatchRequest` with `openAiEmbeddingsTransformer`, `path: "/v1/embeddings"`.
  - Return `executeDispatchPipeline(dispatchReq)`.
- **`src/handlers/v4/router.ts`**:
  - Define `EMBEDDINGS_PATHS: ReadonlySet<string> = new Set(["/v1/embeddings", "/embeddings", "/api/v1/embeddings"])`.
  - In `dispatchPostRoute(path, req, rawKey, reqId)`:
    - Add check: `if (EMBEDDINGS_PATHS.has(path)) return handleV4OpenAIEmbeddings(req, rawKey, reqId);`.
- **`src/index.ts`**:
  - Export `EMBEDDINGS_PATHS`.
  - In `resolveInferenceAuth`:
    - For `EMBEDDINGS_PATHS`, permit unauthenticated requests to fall back to `DEFAULT_EMBEDDING_DIRECTIVE = "lr-tei-oa-em-no"`, enabling zero-config integration for CortexKit AFT.
  - In `validateEndpointMatch(pathname, directive)`:
    - If `EMBEDDINGS_PATHS.has(pathname)` and `directive.endpoint !== "em"`, reject with HTTP 400 (`Endpoint mismatch: Directive specifies ... Use /v1/embeddings with -em-`).
    - If `!EMBEDDINGS_PATHS.has(pathname)` and `directive.endpoint === "em"`, reject with HTTP 400.

#### Step 1.4: Dual-Tier Upstream, Concurrency Pacing & Failover Configuration
- **`config/providers.json`**:
  - Add provider entry for `tei`:
    ```json
    {
      "code": "tei",
      "name": "Text Embeddings Inference",
      "base_url": "http://192.168.50.199:8002",
      "endpoints": {
        "em": "/v1/embeddings"
      },
      "headers": {
        "Content-Type": "application/json"
      },
      "pacer": {
        "min_delay_ms": 10,
        "max_concurrent": 8,
        "max_queue_wait_ms": 5000
      },
      "request_retry": {
        "max_attempts": 3,
        "delay": {
          "base_delay_ms": 150,
          "max_delay_ms": 1000,
          "factor": 2.0,
          "jitter": true
        }
      }
    }
    ```
- **`config/fusion.json`**:
  - Define fusion preset `lr-fse-embeddings`:
    - Tier 1 (Primary): WSL2 CUDA TEI via `http://192.168.50.199:8002/v1/embeddings`.
    - Tier 2 (Fallback): VPS CPU TEI (`http://127.0.0.1:8002/v1/embeddings`) with strict pacer concurrency limit of `4`.
    - Failure condition: HTTP 429 (`Too Many Requests`), HTTP 503, connection dropped, or timeout advances immediately to Tier 2.
    - Anti-Sticky Rule: Tier 2 does not set long-term sticky cache; resets to Tier 1 after 30 seconds cooldown.

#### Step 1.5: Unit Testing & Quality Gates
- Add automated unit test `tests/handlers/openai_embeddings.test.ts`:
  - Tests valid `POST /v1/embeddings` with directive `lr-tei-oa-em-no`.
  - Tests unauthenticated `POST /v1/embeddings` (AFT compatibility).
  - Tests failover behavior: Tier 1 returns 429 $\rightarrow$ request transparently succeeds via Tier 2 returning 200.
  - Tests large batch slicing: 16 items $\rightarrow$ two 8-item chunks aggregated seamlessly.
  - Tests invalid completion mismatch (`lr-tei-oa-ch-no` on `/v1/embeddings` $\rightarrow$ 400).
- Run repo quality gates:
  - `bun run typecheck` (zero errors).
  - `bun run test handlers` & `bun run test` (all pass).

#### Step 1.6: Sync to VPS & Test Gateway
- Run canonical sync script:
  - `bash scripts/sync/sync_literouter_to_vps.sh`.
- Restart LiteRouter on VPS:
  - `ssh vps466a "cd /home/vps466a/services/literouter && bash scripts/gateway/restart.sh"`.
- Run verification probe against live VPS gateway:
  - `curl -s -X POST http://192.168.50.10:7766/v1/embeddings -H "Authorization: Bearer lr-tei-oa-em-no" -H "Content-Type: application/json" -d '{"input": "test health probe", "model": "BAAI/bge-m3"}'`.
  - Assert HTTP 200 with 1024-dimensional embedding vector.

---

### Part 2: Network Exposure & Docker Container Configurations

#### Step 2.1: Expose WSL2 Port 8002 on 192.168.50.199:8002
- Following the repository network standard in `asus_vpn/88_user-guide.md` (Section Q7):
  ```powershell
  $wslIp = (wsl -d Ubuntu-24.04 -- hostname -I).Split()[0]
  netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8002 connectaddress=$wslIp connectport=8002
  ```
- Test reachability from VPS:
  `ssh vps466a "curl -s http://192.168.50.199:8002/info"`
  (Confirms 200 OK from WSL2 container).

#### Step 2.2: Reconfigure WSL2 Docker Container (`tei-bge`)
- Stop and remove existing container:
  `docker stop tei-bge && docker rm tei-bge`
- Run container with CUDA, batch size 8, concurrency 8, tokens 2048, and 4GB memory cap:
  ```bash
  docker run -d \
    --name tei-bge \
    --restart always \
    --gpus all \
    -p 0.0.0.0:8002:80 \
    --memory 4g \
    --memory-swap 4g \
    -v /home/yapilwsl/.cache/huggingface:/data \
    ghcr.io/huggingface/text-embeddings-inference:latest \
    --model-id BAAI/bge-m3 \
    --max-client-batch-size 8 \
    --max-concurrent-requests 8 \
    --max-batch-tokens 2048
  ```
- Verify: `curl -s http://127.0.0.1:8002/info` (confirm `max_client_batch_size: 8`, `max_batch_tokens: 2048`, `float16`).

#### Step 2.3: Reconfigure VPS Docker Container (`tei-bge-m3`)
- SSH to VPS and reconfigure container with CPU, batch size 4, concurrency 4, tokens 1024, and 4GB memory cap (bound strictly to localhost `127.0.0.1:8002`):
  ```bash
  ssh vps466a "docker stop tei-bge-m3 && docker rm tei-bge-m3 && docker run -d \
    --name tei-bge-m3 \
    --restart always \
    -p 127.0.0.1:8002:80 \
    --memory 4g \
    --memory-swap 4g \
    -v /root/.cache/huggingface:/data \
    ghcr.io/huggingface/text-embeddings-inference:latest \
    --model-id BAAI/bge-m3 \
    --max-client-batch-size 4 \
    --max-concurrent-requests 4 \
    --max-batch-tokens 1024"
  ```
- Verify: `ssh vps466a "curl -s http://127.0.0.1:8002/info"` (confirm `max_client_batch_size: 4`, `max_batch_tokens: 1024`, `float32`).

---

### Part 3: Configure AFT in OMP and OpenCode across WSL2 and VPS

#### Step 3.1: Configure WSL2 Client Configurations
1. **AFT Config (`~/.config/cortexkit/aft.jsonc`)**:
   - Update `semantic` section to point to LiteRouter:
     ```jsonc
     "semantic": {
       "backend": "openai_compatible",
       "base_url": "http://192.168.50.10:7766/v1",
       "model": "BAAI/bge-m3",
       "timeout_ms": 30000,
       "max_batch_size": 8,
       "max_input_tokens": 1024
     }
     ```
2. **OMP Mnemopi Config (`~/.omp/agent/config.yml`)**:
   - Update embedding settings:
     ```yaml
     mnemopi:
       embeddingModel: BAAI/bge-m3
       embeddingApiUrl: http://192.168.50.10:7766/v1
       embeddingApiKey: lr-tei-oa-em-no
     ```

#### Step 3.2: Configure VPS Client Configurations
1. **AFT Config (`/home/vps466a/.config/cortexkit/aft.jsonc`)**:
   - Update `semantic` section to point to local LiteRouter gateway:
     ```jsonc
     "semantic": {
       "backend": "openai_compatible",
       "base_url": "http://127.0.0.1:7766/v1",
       "model": "BAAI/bge-m3",
       "timeout_ms": 30000,
       "max_batch_size": 4,
       "max_input_tokens": 1024
     }
     ```
2. **OMP Mnemopi Config (`/home/vps466a/.omp/agent/config.yml`)**:
   - Update embedding settings:
     ```yaml
     mnemopi:
       embeddingModel: BAAI/bge-m3
       embeddingApiUrl: http://127.0.0.1:7766/v1
       embeddingApiKey: lr-tei-oa-em-no
     ```

---

## Critical Files & Anchors
- `src/handlers/v4/router.ts`: `dispatchPostRoute` (`:240-258`) — adds `EMBEDDINGS_PATHS` match.
- `src/handlers/v4/openai_embeddings.ts`: new handler connecting request to `openAiEmbeddingsTransformer` and `executeDispatchPipeline` with ambient auth fallback.
- `src/transformers/openai_embeddings.ts`: new transformer formatting `{ input, model }`, handling batch slicing for $> 8$ items, and returning OpenAI-compatible JSON embedding object.
- `src/config/schema.ts`: `ProviderCodeSchema` (`:3`) & `CompletionCodeSchema` (`:28`) — registers `tei` and `em`.
- `config/providers.json` & `config/fusion.json`: configuration of primary (WSL2 CUDA via `192.168.50.199:8002`) and fallback (VPS CPU via `127.0.0.1:8002`) targets, concurrency pacers, and retry policies.

---

## Verification

1. **WSL2 TEI Direct Reachability via 192.168.50.199:8002**:
   - `ssh vps466a "curl -s http://192.168.50.199:8002/info"`
   - Assert returns `model_dtype: float16`, `max_client_batch_size: 8` (WSL2 CUDA container).
2. **LiteRouter Route & Gateway Test**:
   - `bun run typecheck`: Exit code 0.
   - `bun run test handlers`: All tests pass.
   - Live probe against VPS:
     ```bash
     curl -s -X POST http://192.168.50.10:7766/v1/embeddings \
       -H "Authorization: Bearer lr-tei-oa-em-no" \
       -H "Content-Type: application/json" \
       -d '{"input": ["hello world", "testing bge-m3"], "model": "BAAI/bge-m3"}' | jq '.data | length'
     ```
     Expected output: `2`.
3. **Ambient Unauthenticated Probe (AFT Simulation)**:
     ```bash
     curl -s -X POST http://192.168.50.10:7766/v1/embeddings \
       -H "Content-Type: application/json" \
       -d '{"input": "unauthenticated aft probe", "model": "BAAI/bge-m3"}' | jq '.object'
     ```
     Expected output: `"list"`.
4. **Dual-Host Failover Proof**:
   - Temporarily stop WSL2 container: `docker stop tei-bge`.
   - Send embedding request to LiteRouter on VPS:
     `curl -s -X POST http://192.168.50.10:7766/v1/embeddings -H "Authorization: Bearer lr-tei-oa-em-no" -H "Content-Type: application/json" -d '{"input": "fallback test"}'`.
   - Assert HTTP 200 returned from VPS local TEI.
   - Restart WSL2 container: `docker start tei-bge`.
5. **Docker Sizing & Memory Limits Proof**:
   - `docker stats tei-bge --no-stream` on WSL2: limit is `4GiB`, actual usage $< 1.6\text{ GiB}$.
   - `ssh vps466a "docker stats tei-bge-m3 --no-stream"`: limit is `4GiB`, actual usage $< 2.5\text{ GiB}$.
6. **Client Ingestion & Semantic Search Proof**:
   - In WSL2 and VPS, test AFT semantic indexing/query:
     `python3 -c "import urllib.request, json; req = urllib.request.Request('http://192.168.50.10:7766/v1/embeddings', data=json.dumps({'input': 'bazi vector test', 'model': 'BAAI/bge-m3'}).encode(), headers={'Authorization': 'Bearer lr-tei-oa-em-no', 'Content-Type': 'application/json'}); print(len(json.loads(urllib.request.urlopen(req).read())['data'][0]['embedding']))"`
     Expected output: `1024`.

---

## Assumptions & Contingencies
- **Primary Endpoint**: WSL2 CUDA container is reached across the LAN at `http://192.168.50.199:8002`.
- **Failover Trigger**: If the laptop is asleep, offsite, or under heavy load ($429$/$503$/timeout), LiteRouter automatically reroutes $100\%$ of embedding traffic to the local VPS CPU container (`http://127.0.0.1:8002`).
