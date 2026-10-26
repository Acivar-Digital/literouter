# Text Embeddings Inference (TEI) & BGE-M3 Embeddings Guide

> Load this file whenever the request touches **embeddings**, **TEI (`tei`)**, **BGE-M3 (`BAAI/bge-m3`)**,
> **semantic search (CortexKit AFT)**, **OMP Mnemopi memory**, **batch chunk slicing**,
> **ambient zero-config embeddings auth**, or **embedding dual-tier failover**.
> SKILL.md is the entry point; this file is the embedding gateway deep dive.

---

## 1. Overview & Architecture

LiteRouter acts as the authoritative embedding gateway for local and remote consumers, including:
- **CortexKit AFT Semantic Search**: Codebase semantic search and trigram/vector retrieval.
- **Oh-My-Pi (OMP) Mnemopi Memory**: Agent episodic, fact, and working vector memory.
- **RAG & Context Engines**: Multi-document retrieval pipelines (e.g. Baziforecaster).

To protect upstream Hugging Face Text Embeddings Inference (TEI) engines from crash loops, HTTP 429 (Too Many Requests), 422 (batch limit exceeded), or connection drops under concurrent traffic, LiteRouter provides:
1. **Dedicated Provider (`tei`) & Completion Code (`em`)**.
2. **Transparent Batch Chunk Slicing**: Automatically slices batch inputs $> 8$ items into sequential $\le 8$-item sub-batches, aggregating vectors and token usage into a single OpenAI-compatible response.
3. **Ambient Zero-Config Auth**: Local tools (e.g. CortexKit AFT) hitting `/v1/embeddings` without an `Authorization` header automatically default to `lr-tei-oa-em-no` without client-side API key configuration.
4. **Active-Passive Dual-Tier Failover**: WSL2 CUDA primary (`http://192.168.50.199:8002` or LAN ZeroTier `10.32.34.172:8002`) falling back to VPS CPU (`http://127.0.0.1:8002`) on 429, 503, connection drops, or timeouts.

---

## 2. Provider Code, Completion Code & Endpoints

### Directive Grammar Codes
- **Provider Code**: `tei` (Text Embeddings Inference)
  - Registered in `src/directive/parser.ts:15,69` (`ProviderCode`) and `src/config/schema.ts:17` (`ProviderCodeSchema`).
- **Wire/Payload Code**: `oa` (OpenAI format)
- **Completion Code**: `em` (Embeddings)
  - Registered in `src/directive/parser.ts:26,78` (`CompletionCode`) and `src/config/schema.ts:28` (`CompletionCodeSchema`).
- **Nuance Code**: `no` (Standard / none)
- **Canonical Directive Key**: `lr-tei-oa-em-no`
- **Fusion Preset Key**: `lr-fse-embeddings` (in `config/fusion.json`)

### Inbound Endpoint Paths (`EMBEDDINGS_PATHS`)
Defined in `src/handlers/v4/router.ts:240-244` and exported to `src/index.ts`:
- `POST /v1/embeddings`
- `POST /embeddings`
- `POST /api/v1/embeddings`

Upstream TEI target endpoint: `/v1/embeddings` (mapped via `endpoints.em` in `config/providers.json`).

### Strict Endpoint Mismatch Validation (HTTP 400)
LiteRouter enforces bidirectional endpoint matching at the edge (`src/index.ts:383-402` and `src/handlers/v4/openai_embeddings.ts:42-52`):
- Sending a non-embeddings directive (e.g. `lr-tei-oa-ch-no`) to `/v1/embeddings` returns `400 Bad Request`:
  `Endpoint mismatch: Directive specifies non-embeddings API (-ch-). Use /v1/embeddings with -em-.`
- Sending an embeddings directive (`lr-tei-oa-em-no`) to a chat endpoint (e.g. `/v1/chat/completions`) returns `400 Bad Request`:
  `Endpoint mismatch: Directive specifies Embeddings API (-em-). Use /v1/embeddings.`

---

## 3. Ambient Zero-Config Auth Fallback

For local indexing agents and development tools (such as CortexKit AFT semantic search or curl probes), sending explicit Bearer tokens can create configuration friction or break standard OpenAI SDK clients.

LiteRouter implements **Ambient Zero-Config Fallback** in:
- `src/index.ts` (`resolveInferenceAuth`):
  When inbound request path matches `EMBEDDINGS_PATHS` (`/v1/embeddings`, etc.) and no `Authorization` header or query token is provided, LiteRouter injects:
  `rawKey = DEFAULT_EMBEDDING_DIRECTIVE` (`"lr-tei-oa-em-no"`).
- `src/handlers/v4/openai_embeddings.ts`:
  If `rawKey` is missing or empty, `effectiveRawKey` defaults to `"lr-tei-oa-em-no"`.

**Result**: Local agents can POST to `http://<host>:7766/v1/embeddings` with only `Content-Type: application/json` and no API key.

---

## 4. Transparent Batch Chunk Slicing

Upstream Hugging Face TEI instances enforce strict client batch limits (typically `--max-client-batch-size 8` or `4`). When clients send large batches (e.g., 16 or 64 documents during codebase re-indexing), raw TEI immediately rejects the payload with HTTP 422:
```json
{"error": "batch size exceeds max 8"}
```

### Gateway Slicing & Merging (`src/transformers/openai_embeddings.ts`)
LiteRouter solves this transparently inside `src/handlers/v4/openai_embeddings.ts`:

1. **Detection**:
   Checks `isMultiInputBatch(body.input)` and `body.input.length > DEFAULT_EMBEDDING_BATCH_SIZE` (`DEFAULT_EMBEDDING_BATCH_SIZE = 8`).
2. **Sequential Chunking (`sliceEmbeddingInput`)**:
   Splits the array into chunks of $\le 8$ items.
3. **Sub-dispatch Execution**:
   Each chunk is executed through `executeDispatchPipeline` with isolated sub-request IDs (`${reqId}_chunk${chunkIdx}`).
4. **Result Aggregation (`mergeEmbeddingResponses`)**:
   - Assembles the individual embedding vector lists into a single continuous `data` array.
   - Re-indexes each item (`index: 0, 1, 2, ... N-1`) sequentially to match the caller's original input ordering.
   - Sums `prompt_tokens` and `total_tokens` across all chunks.
   - Returns a single HTTP 200 OpenAI `list` response to the client.

If any chunk returns an HTTP $\ge 400$ error, execution aborts early and returns that status response to the client.

---

## 5. Active-Passive Dual-Tier Failover

To guarantee high availability when indexing massive codebases or running concurrent memory queries across machines:

### Tier Architecture
- **Tier 1 (Primary — WSL2 CUDA)**:
  - Runs in WSL2 Docker container `tei-bge` with NVIDIA GPU acceleration (`--gpus all`).
  - Served on port `8002` (LAN reachability via port-proxy at `http://192.168.50.199:8002` or ZeroTier `http://10.32.34.172:8002`).
  - Container specs: batch size 8, concurrency 8, max tokens 2048, 4GB RAM cap, `float16` precision.
- **Tier 2 (Fallback — VPS CPU)**:
  - Runs on VPS Docker container `tei-bge-m3` on CPU.
  - Bound to `http://127.0.0.1:8002`.
  - Container specs: batch size 4, concurrency 4, max tokens 1024, 4GB RAM cap, `float32` precision.

### Failover Trigger & Concurrency Pacing
Configured in `config/providers.json` and `config/fusion.json` (`lr-fse-embeddings`):
- **Triggers**: HTTP 429 (rate/queue limit), HTTP 503, connection drops (socket hangup/ECONNREFUSED), or request timeout.
- **Conveyor Pacer (`pacer`)**:
  - `min_delay_ms: 10`, `max_delay_ms: 50`.
  - Concurrency capped (`max_concurrency: 8` for primary CUDA, throttled to `4` for fallback CPU).
- **Anti-Sticky Cooldown**:
  - Failures advance immediately to Tier 2.
  - Sticky affinity resets back to Tier 1 after cooldown, preventing persistent pinning to CPU when the GPU container is online.

---

## 6. Client Configuration Examples

### A. CortexKit AFT Semantic Search (`~/.config/cortexkit/aft.jsonc`)
Configure AFT to route semantic embedding queries through LiteRouter. Thanks to ambient zero-config auth, no `api_key` is required:

```jsonc
{
  "semantic": {
    "backend": "openai_compatible",
    "base_url": "http://10.32.34.172:7766/v1",
    "model": "BAAI/bge-m3",
    "timeout_ms": 30000,
    "max_batch_size": 8,
    "max_input_tokens": 1024
  }
}
```
*(Replace `10.32.34.172` with the host from `config/location.json` or `localhost` if running on the same host).*

### B. Oh-My-Pi (OMP) Mnemopi Memory (`~/.omp/agent/config.yml`)
Configure OMP vector memory to use LiteRouter with the canonical directive key:

```yaml
mnemopi:
  embeddingModel: BAAI/bge-m3
  embeddingApiUrl: http://10.32.34.172:7766/v1
  embeddingApiKey: lr-tei-oa-em-no
```

---

## 7. cURL Probes & Verification

### Ambient Zero-Config Request (no auth header)
```bash
curl -s -X POST http://localhost:7766/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "input": ["First document chunk", "Second document chunk"],
    "model": "BAAI/bge-m3"
  }' | jq '.object, (.data | length)'
```
*Expected output*:
```json
"list"
2
```

### Explicit Directive Request
```bash
curl -s -X POST http://localhost:7766/v1/embeddings \
  -H "Authorization: Bearer lr-tei-oa-em-no" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Semantic retrieval test query",
    "model": "BAAI/bge-m3"
  }' | jq '.data[0].embedding | length'
```
*Expected output*: `1024` (vector dimensions for `BAAI/bge-m3`).

### Large Batch Slicing Probe (16 items > batch size 8)
```bash
curl -s -X POST http://localhost:7766/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      "item 1", "item 2", "item 3", "item 4",
      "item 5", "item 6", "item 7", "item 8",
      "item 9", "item 10", "item 11", "item 12",
      "item 13", "item 14", "item 15", "item 16"
    ],
    "model": "BAAI/bge-m3"
  }' | jq '(.data | length), .data[15].index'
```
*Expected output*:
```json
16
15
```
*(Confirms transparent slicing into two 8-item chunks and continuous re-indexing up to index 15).*
