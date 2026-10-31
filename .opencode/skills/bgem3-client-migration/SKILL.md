---
name: bgem3-client-migration
description: Refactor downstream Python and TypeScript repositories, RAG pipelines, and vector stores to consume sovereign BGE-M3 embeddings via LiteRouter
---

# BGE-M3 Client Migration & Refactoring Guide

## 1. Overview & Architecture

This skill provides step-by-step instructions for refactoring client applications, scripts, RAG pipelines, and vector databases in downstream repositories (e.g. `baziforecaster`, Chronomancer, OpenCode, OMP) to use sovereign BGE-M3 text embeddings routed through LiteRouter.

LiteRouter provides an **Active-Passive Multi-Tier Failover** architecture:
- **Tier 1**: `10.32.34.172:8002` (WSL2 GPU over ZeroTier, ~25ms latency)
- **Tier 2**: `127.0.0.1:8002` on VPS (Sovereign 24/7 CPU loopback, ~150ms latency)
- Downstream clients **never** talk directly to TEI nodes or ZeroTier meshes. They connect to the sovereign gateway endpoint.

### Core Endpoint Invariants
| Property | Value | Notes |
|---|---|---|
| **Base URL** | `http://literouter.lan:7766/v1` | VPS fallback: `http://192.168.50.10:7766/v1`, Local: `http://localhost:7766/v1` |
| **Embeddings Endpoint** | `POST http://literouter.lan:7766/v1/embeddings` | Standard OpenAI REST wire protocol |
| **Model Name** | `"BAAI/bge-m3"` | Alias `"bge-m3"` also accepted |
| **Embedding Dimension** | `1024` | Dense float32 vectors (`data[i].embedding`) |
| **Max Sequence Length** | `8192` tokens | High-density retrieval chunking recommended: 512–1024 tokens |
| **Authentication** | **Ambient Zero-Config** | No auth header needed; if SDK mandates a key, pass `"sk-no-key-required"` |
| **Batching** | Handled transparently | Gateway auto-slices arrays into chunks of 8/4 without payload limits |

---

## 2. Codebase Audit Checklist: Finding BGE-M3 Dependencies

When entering a downstream repository, run this discovery checklist:

### Step 2.1: Locate BGE-M3 Mentions in Code
Search for imports, model names, and configurations:
```bash
# Search for model string references
grep -rn "bge-m3\|BAAI/bge-m3" . --exclude-dir={.git,node_modules,.venv,__pycache__}

# Search for in-process sentence-transformers usages
grep -rn "SentenceTransformer\|sentence_transformers" . --exclude-dir={.git,node_modules,.venv}

# Search for embedding URLs or old ZeroTier IPs
grep -rn "8002\|10.32.34.172\|tei-wsl\|literouter.*embeddings" . --exclude-dir={.git,node_modules,.venv}
```

### Step 2.2: Identify In-Process Heavyweights for Removal
If the repository is using `sentence_transformers.SentenceTransformer("BAAI/bge-m3")` directly in Python:
- It is loading a 2.2 GB PyTorch model directly into process RAM/VRAM.
- **Action**: Replace with LiteRouter HTTP client.
- **Dependency Audit**: Check `pyproject.toml`, `requirements.txt`, or `setup.py`. If `sentence-transformers`, `torch`, `torchvision`, or `transformers` are ONLY used for generating embeddings, remove them or move them to optional extras to drastically shrink container build sizes and startup times.

---

## 3. Client Refactoring Recipes

### Recipe 3.1: Python OpenAI SDK (`openai >= 1.0.0`)
Replace any custom embedding client with the standard OpenAI SDK:

```python
from openai import OpenAI

# Initialize client pointing to LiteRouter
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

#### Async Version:
```python
from openai import AsyncOpenAI

aclient = AsyncOpenAI(
    base_url="http://literouter.lan:7766/v1",
    api_key="sk-no-key-required",
)

async def aget_embedding(text: str) -> list[float]:
    response = await aclient.embeddings.create(
        model="BAAI/bge-m3",
        input=text,
    )
    return response.data[0].embedding
```

---

### Recipe 3.2: Python Zero-SDK Lightweight HTTP (`httpx` or `requests`)
If the repository avoids external AI SDKs, use native `httpx`:

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
        data = resp.json()["data"]
        return [entry["embedding"] for entry in data]
```

---

### Recipe 3.3: LangChain / LlamaIndex Vector Store Integration

#### LangChain:
```python
from langchain_openai import OpenAIEmbeddings

embeddings = OpenAIEmbeddings(
    openai_api_base="http://literouter.lan:7766/v1",
    openai_api_key="sk-no-key-required",
    model="BAAI/bge-m3",
    check_embedding_ctx_length=False,
)

# Connect with Chroma / PGVector / FAISS
# db = Chroma.from_documents(docs, embeddings)
```

#### LlamaIndex:
```python
from llama_index.embeddings.openai import OpenAIEmbedding

embed_model = OpenAIEmbedding(
    api_base="http://literouter.lan:7766/v1",
    api_key="sk-no-key-required",
    model_name="BAAI/bge-m3",
)
```

---

### Recipe 3.4: TypeScript / JavaScript (Node.js & Bun)

#### Using `openai` npm package:
```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "http://literouter.lan:7766/v1",
  apiKey: "sk-no-key-required",
});

export async function embedText(text: string): Promise<number[]> {
  const resp = await openai.embeddings.create({
    model: "BAAI/bge-m3",
    input: text,
  });
  return resp.data[0].embedding;
}
```

#### Using Native `fetch` (Zero Dependencies):
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
    throw new Error(`Embedding failed with HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return json.data.map((item: { embedding: number[] }) => item.embedding);
}
```

---

### Recipe 3.5: CortexKit AFT & OpenCode Codebase Indexing Configuration

To configure semantic search in `.opencode/aft.jsonc` or workspace config:
```jsonc
{
  "semantic": {
    "base_url": "http://literouter.lan:7766/v1",
    "model": "BAAI/bge-m3",
    "timeout_ms": 30000,
    "max_batch_size": 8,
    "max_input_tokens": 1024
  }
}
```

---

## 4. Verification & Validation Protocol

After refactoring any script or service:

### 4.1 Quick Curl Verification
Test connectivity to the gateway from the repo's host/container:
```bash
curl -s -X POST http://literouter.lan:7766/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "BAAI/bge-m3", "input": "testing bge-m3 refactor"}' | grep -o '"embedding":\[[^]]*\]' | head -c 50
```

### 4.2 Script Unit Test Assertion
Ensure downstream tests verify:
1. HTTP 200 response with `object: "list"`.
2. Vector dimension is exactly `1024` elements:
   ```python
   embedding = get_embedding("test")
   assert len(embedding) == 1024
   assert all(isinstance(x, float) for x in embedding)
   ```
3. Latency is within bounds: < 50ms on Tier 1 (GPU) or < 300ms on Tier 2 (VPS CPU).

---

## 5. Troubleshooting & Fallbacks

| Symptom | Cause | Solution |
|---|---|---|
| `Connection refused` to `literouter.lan:7766` | Router DNS `hosts.add` missing or LiteRouter daemon down | 1. Use direct IP: `http://192.168.50.10:7766/v1` (VPS).<br>2. Run `doctor.ts` on LiteRouter. |
| `HTTP 401 Unauthorized` | Old LiteRouter version requiring key | Ambient zero-config is supported in commit `92f4910`+. Or pass header `Authorization: Bearer sk-no-key-required`. |
| `HTTP 502 Bad Gateway` | Both TEI tiers down | Check TEI container status: `docker ps | grep tei`. |
| Vector dimension mismatch | Downstream DB configured for 384/768 dims | Update vector store schema column to `vector(1024)` (e.g. PGVector) or 1024 dimensions. |
