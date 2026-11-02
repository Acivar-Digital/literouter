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
2. **Transparent Batch Chunk Slicing**: Automatically slices batch inputs $> 4$ items into sequential $\le 4$-item sub-batches, aggregating vectors and token usage into a single OpenAI-compatible response.
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

Upstream Hugging Face TEI instances enforce strict client batch limits (cluster-wide standardized to `--max-client-batch-size 4` and `--max-concurrent-requests 4`). When clients send large batches (e.g., 8, 16, or 64 documents during codebase re-indexing), raw TEI immediately rejects the payload with HTTP 422:
```json
{"error": "batch size exceeds max 4"}
```

### Gateway Slicing & Merging (`src/transformers/openai_embeddings.ts`)
LiteRouter solves this transparently inside `src/handlers/v4/openai_embeddings.ts`:

1. **Detection**:
   Checks `isMultiInputBatch(body.input)` and `body.input.length > DEFAULT_EMBEDDING_BATCH_SIZE` (`DEFAULT_EMBEDDING_BATCH_SIZE = 4`).
2. **Sequential Chunking (`sliceEmbeddingInput`)**:
   Splits the array into chunks of $\le 4$ items.
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
- **Tier 1 (Primary — WSL2 CUDA via Reverse SSH Tunnel)**:
  - Runs in WSL2 Docker container `tei-bge` with NVIDIA GPU acceleration (`--gpus all`) on port `8002`.
  - Forwarded to VPS port `8002` via persistent supervised SSH reverse tunnel (`tei-reverse-tunnel.service` on WSL2).
  - VPS `sshd_config.d/60-tei-reverse-tunnel.conf` sets `GatewayPorts clientspecified` and `StreamLocalBindUnlink yes` to expose `0.0.0.0:8002` to LAN/ZeroTier.
  - Registered in `config/providers.json` as provider `tei` pointing to `http://127.0.0.1:8002`.
  - Container run arguments: `--model-id BAAI/bge-m3 --max-client-batch-size 4 --max-concurrent-requests 4 --max-batch-tokens 2048`.
  - Specs: batch size 4, concurrency 4, max tokens 2048, 4GB RAM cap, `float16` precision (~80-100ms latency).
- **Tier 2 (Fallback — VPS Local CPU Container)**:
  - Runs on VPS Docker container `tei-fallback` (`ghcr.io/huggingface/text-embeddings-inference:cpu-1.8`) on dedicated port `8003`.
  - Bound to `http://127.0.0.1:8003` and LAN/ZeroTier.
  - Registered in `config/providers.json` as provider `teivps` pointing to `http://127.0.0.1:8003`.
  - Container run arguments: `--model-id BAAI/bge-m3 --max-client-batch-size 4 --max-concurrent-requests 4 --max-batch-tokens 1024`.
  - Specs: batch size 4, concurrency 4, max tokens 1024, 4GB RAM cap, `float32` precision (~150-180ms latency).

### Heterogeneous Failover Rationale (Tier 2 CPU 4 Limit & Lowest Common Denominator)
In an active-passive dual-tier architecture with heterogeneous hardware:
- **Tier 2 CPU Constraints**: The fallback VPS CPU instance (`tei-fallback` / `tei-bge-m3`) operates under constrained CPU core resources without GPU acceleration. To prevent high thread contention, queue latency spikes, and out-of-memory (OOM) aborts, Tier 2 is strictly configured with `--max-client-batch-size 4` and `--max-concurrent-requests 4`.
- **Lowest Common Denominator Slicing**: If Tier 1 were configured for batch size 8 while Tier 2 is capped at 4, any batch slicing threshold of 8 at the gateway would produce 8-item chunks. Under failover (when Tier 1 fails on 429, 503, or connection drop), LiteRouter would forward these 8-item chunks to Tier 2, which would immediately reject them with HTTP 422 (`batch size exceeds max 4`), causing catastrophic failover collapse during outages.
- **Unified Cluster Standardization**: Slicing at the Lowest Common Denominator of 4 across both tiers guarantees deterministic, zero-error failover under peak load across heterogeneous hardware.

### Failover Trigger & Concurrency Pacing
Configured in `config/fusion.json` (`embeddings` preset):
- **Triggers**: HTTP 429 (rate/queue limit), HTTP 503, connection drops (socket hangup/ECONNREFUSED), or request timeout.
- **Fallback Chain**: Priority 1 `lr-tei-oa-em-no` -> Priority 2 `lr-teivps-oa-em-no`.
- **Conveyor Pacer (`pacer`)**:
  - `min_delay_ms: 10`, `max_delay_ms: 50`.
  - Concurrency capped (`max_concurrency: 4` across tiers to match container capacity).
- **Anti-Sticky Cooldown**:
  - Failures advance immediately to Tier 2.
  - Sticky affinity resets back to Tier 1 after cooldown, preventing persistent pinning to CPU when the GPU container is online.

---

## 6. Client Configuration & Downstream LLM Migration Guide

### 6.1 Downstream LLM Directive & Copy-Paste Migration Prompt

When instructing agents or LLMs operating in downstream repositories (`baziforecaster`, Chronomancer, CortexKit AFT, OMP, OpenCode, or RAG pipelines) to configure or refactor their embedding clients, provide this exact directive:

```markdown
Migrate our embeddings and semantic retrieval to LiteRouter's sovereign aggregated BGE-M3 TEI gateway.

### 1. Core Endpoints & Invariants
- Base URL: `http://literouter.lan:7766/v1` (Fallback: `http://192.168.50.10:7766/v1` or `http://localhost:7766/v1`)
- Embeddings Endpoint: `POST /v1/embeddings` (OpenAI REST wire protocol)
- Model: `BAAI/bge-m3` (alias `bge-m3`)
- Vector Dimension: `1024` (dense float32 vectors)
- Max Context Length: `8192` tokens (recommended chunk size: 512–1024)
- Authentication: Ambient Zero-Config. No auth header required. If the SDK demands an API key, use `sk-no-key-required` or directive `lr-fse-embeddings`.
- Batch Handling: The gateway transparently slices batches > 4 items into sub-batches and reassembles them. You do not need complex client-side chunking.

### 2. Prohibitions & Removals
- DO NOT connect directly to port `8002`, `8003`, raw ZeroTier IPs (`10.32.34.172:8002`), or `tei-wsl.lan` (DNS does not resolve).
- DO NOT load in-process `sentence_transformers` or PyTorch BGE-M3 models in application code. Replace with HTTP calls to LiteRouter.
- Purge any unused `sentence-transformers`, `torch`, or `transformers` dependencies if they were only used for embeddings generation.

### 3. Verification Task
Verify connectivity by running a test query against `http://literouter.lan:7766/v1/embeddings`, asserting HTTP 200, object type `"list"`, and exactly `1024` dimensions in `data[0].embedding`.
```

### 6.2 Client Configuration Matrix

#### A. CortexKit AFT Semantic Search (`~/.config/cortexkit/aft.jsonc` or `.opencode/aft.jsonc`)
Configure AFT to route semantic embedding queries through LiteRouter. Thanks to ambient zero-config auth, no `api_key` is required:

```jsonc
{
  "semantic": {
    "backend": "openai_compatible",
    "base_url": "http://literouter.lan:7766/v1",
    "model": "BAAI/bge-m3",
    "timeout_ms": 30000,
    "max_batch_size": 4,
    "max_input_tokens": 1024
  }
}
```

#### B. Oh-My-Pi (OMP) Mnemopi Memory (`~/.omp/agent/config.yml`)
Configure OMP vector memory to use LiteRouter with the aggregated fusion directive key:

```yaml
mnemopi:
  embeddingModel: BAAI/bge-m3
  embeddingApiUrl: http://literouter.lan:7766/v1
  embeddingApiKey: lr-fse-embeddings # or sk-no-key-required
```

#### C. Downstream Environment Variables (`.env` / `.env.local`)
```env
EMBEDDING_BASE_URL=http://literouter.lan:7766/v1
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_API_KEY=sk-no-key-required
EMBEDDING_DIMENSIONS=1024
```

#### D. Python OpenAI SDK (`openai >= 1.0.0`)
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://literouter.lan:7766/v1",
    api_key="sk-no-key-required",  # Ambient zero-config auth
)

def get_embedding(text: str) -> list[float]:
    response = client.embeddings.create(
        model="BAAI/bge-m3",
        input=text,
    )
    return response.data[0].embedding

def get_embeddings_batch(texts: list[str]) -> list[list[float]]:
    response = client.embeddings.create(
        model="BAAI/bge-m3",
        input=texts,
    )
    return [item.embedding for item in response.data]
```

#### E. Python Lightweight HTTP (`httpx` — Zero AI SDK dependency)
```python
import httpx

LITEROUTER_EMBEDDINGS_URL = "http://literouter.lan:7766/v1/embeddings"

def embed_texts(texts: list[str] | str) -> list[list[float]]:
    payload = {
        "model": "BAAI/bge-m3",
        "input": texts,
    }
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(LITEROUTER_EMBEDDINGS_URL, json=payload)
        resp.raise_for_status()
        return [item["embedding"] for item in resp.json()["data"]]
```

#### F. LangChain & LlamaIndex Vector Store Integration
```python
# LangChain
from langchain_openai import OpenAIEmbeddings

embeddings = OpenAIEmbeddings(
    openai_api_base="http://literouter.lan:7766/v1",
    openai_api_key="sk-no-key-required",
    model="BAAI/bge-m3",
    check_embedding_ctx_length=False,
)

# LlamaIndex
from llama_index.embeddings.openai import OpenAIEmbedding

embed_model = OpenAIEmbedding(
    api_base="http://literouter.lan:7766/v1",
    api_key="sk-no-key-required",
    model_name="BAAI/bge-m3",
)
```

#### G. TypeScript / Bun / Node.js (Native `fetch`)
```typescript
export async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch("http://literouter.lan:7766/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "BAAI/bge-m3",
      input: inputs,
    }),
  });
  if (!res.ok) {
    throw new Error(`Embedding failed [${res.status}]: ${await res.text()}`);
  }
  const json = await res.json();
  return json.data.map((item: { embedding: number[] }) => item.embedding);
}
```

### 6.3 Downstream Codebase Audit & Purge Checklist

When entering a downstream repository, run this discovery checklist:

1. **Locate BGE-M3 & TEI Mentions**:
   ```bash
   # Search for model string references
   grep -rn "bge-m3\|BAAI/bge-m3" . --exclude-dir={.git,node_modules,.venv,__pycache__}

   # Search for in-process sentence-transformers usages
   grep -rn "SentenceTransformer\|sentence_transformers" . --exclude-dir={.git,node_modules,.venv}

   # Search for old direct TEI IPs or unresolvable hostnames
   grep -rn "8002\|8003\|10.32.34.172\|tei-wsl\|192.168.50.199" . --exclude-dir={.git,node_modules,.venv}
   ```

2. **Purge In-Process Heavyweight Models**:
   If code uses `sentence_transformers.SentenceTransformer("BAAI/bge-m3")`, it is loading a 2.2 GB PyTorch model directly into process memory. Replace with LiteRouter HTTP client and remove `sentence-transformers`, `torch`, and `transformers` from `pyproject.toml` / `requirements.txt` if not needed elsewhere.

3. **Remove Dead Hostnames & Port 8002/8003**:
   Purge all direct references to `tei-wsl.lan`, `10.32.34.172:8002`, or `http://127.0.0.1:8002`. Replace with gateway base URL `http://literouter.lan:7766/v1`.

4. **Validate Vector Database Column Dimensions**:
   Ensure vector store tables (e.g. PGVector, Chroma, FAISS, SQLite-VSS) are configured for **1024 dimensions** (`vector(1024)`). If migrated from 384-d or 768-d models, the vector column must be recreated or migrated.

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

### Large Batch Slicing Probe (16 items > batch size 4)
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
*(Confirms transparent slicing into four 4-item chunks and continuous re-indexing up to index 15).*
