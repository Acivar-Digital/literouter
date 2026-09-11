# LiteRouter Positioning Document (v4.0)

> **🧭 MASTER TRUTH SOURCE — All promotional content, docs, and marketing must align with this document. Updated: v4.0**

---

## Positioning Statement (Single Sentence)

> **LiteRouter v4.0 is the world's first zero-dependency Bun/TypeScript AI API Gateway combining high-performance in-memory key rotation, declarative Directive Keys (`lr-*`), a 60-second 3-pillar Model Evaluation Gauntlet, 70% reasoning-token cost stripping, and sticky fusion fallback chains — delivering the "Audit First + Route Anywhere" engine that solves rate-limit stalls, key exhaustion, and multi-turn prompt bloat.**

---

## The Core Value Proposition: "Audit First + Route Anywhere"

Most AI infrastructure forces teams to choose between opaque, markup-heavy SaaS aggregators or heavyweight, complex self-hosted Python gateways that require dedicated databases. Furthermore, developers are forced to route requests blindly to models without knowing if they actually handle agentic tool loops, strict schemas, or surgical diffs.

LiteRouter v4.0 introduces the **"Audit First + Route Anywhere"** paradigm:

1. **Audit First (60s Evaluation Gauntlet)**:
   - Before deploying a new or open-weights model into an agentic loop, developers run `bun run eval/eval.ts <model_name>`.
   - In **under 60 seconds**, the 3-pillar harness benchmarks:
     - **Speed**: TTFT, duration, and generation throughput (tok/sec).
     - **Code & Agentic**: 5-stage audit covering wire format, Pydantic/JSON schema adherence, multi-turn tool loops, surgical diff patching, and prompt injection resilience across both Chat Completions and Responses API wire protocols.
     - **Web Frontend**: Semantic DOM structure, responsive layouts, React state transitions, code hygiene, and WCAG a11y compliance.
   - Generates an executive Markdown report card with an automated **Architectural Role Recommendation** (`Orchestrator`, `General Coder`, or `Explorer`).

2. **Route Anywhere (Directive Keys & In-Memory Dispatch)**:
   - Once validated, route traffic to any upstream provider without changing application logic or registering models in heavy databases.
   - The client API key *is* the routing configuration: `lr-<provider>-<payload>-<completion>-<nuances>` declares provider targets, wire protocol conversion, and transformation flags directly in the `Authorization: Bearer` token.
   - Zero configuration overhead, zero vendor lock-in.

---

## The v4 Competitive Matrix

| Capability / Metric | **LiteRouter v4.0** | **LiteLLM** | **OpenRouter** | **Portkey** |
|---|---|---|---|---|
| **Runtime & Overhead** | **Bun / TypeScript**<br>• Sub-millisecond latency<br>• Native async event loop | **Python / FastAPI**<br>• 15–45ms gateway overhead<br>• High CPU/memory footprint | **Closed SaaS**<br>• Variable cloud latency<br>• Network hop penalty | **Node.js / SaaS**<br>• Moderate gateway overhead<br>• Cloud dependency |
| **State & Infrastructure** | **Zero External DBs**<br>• Pure in-memory `KeyPool`<br>• Single Bun process | **Heavyweight Infra**<br>• Requires PostgreSQL & Redis<br>• Complex Docker orchestration | **Proprietary Cloud**<br>• Zero self-host option<br>• Closed database | **Hybrid / SaaS**<br>• Requires external Redis / ClickHouse for self-host |
| **Routing Protocol** | **Declarative Directive Keys**<br>`lr-<prov>-<payload>-<compl>-<nuances>`<br>Self-describing client tokens | **Static Config Files**<br>Complex YAML/JSON gateway config, restarts or admin APIs | **Model Aliases**<br>Provider-prefixed model names (`provider/model-id`) | **Header-Based Config**<br>Multiple custom headers (`x-portkey-provider`, etc.) |
| **Key Pool & Rotation** | **In-Memory Round-Robin**<br>• 2s rate-limit recovery<br>• Grace retries (≤2000ms)<br>• Lock-free in Bun process | **Redis Key Pools**<br>• Prone to concurrency race conditions<br>• 65s client-side stalls | **Single API Key**<br>• No user-managed key pools<br>• Throttled at account level | **Virtual Key Pools**<br>• Database-managed<br>• Requires dashboard setup |
| **Model Evaluation** | **Built-in 60s Gauntlet**<br>`eval/eval.ts` with 3 pillars:<br>Speed, Code/Agentic, Web | **None**<br>External evaluation tools required (e.g. Promptfoo) | **Static Leaderboard**<br>Generic public benchmarks, no custom agent eval | **Post-Hoc Analytics**<br>Observability after deployment, no pre-flight audit |
| **Reasoning Token Strip** | **Dynamic Scrubber (Save 70%)**<br>Strips historical reasoning blocks while preserving active turn | **No**<br>Passes all thinking tokens through; balloons prompt costs | **No**<br>Charges full token rates on past thinking tokens | **No**<br>Passes raw context through without reasoning filtering |
| **Google Thought Signatures** | **Automatic Tracking**<br>Caches & reinjects thought signatures across multi-step agent tool turns | **Unhandled**<br>Crashes on turn 2+ of Gemini agent loops with signature error | **Inconsistent**<br>Dependent on upstream proxy handling | **Unhandled**<br>Requires custom client-side workaround |
| **Network & Transport** | **HTTP/2 ALPN + `h2_pool`**<br>Multiplexed inbound & outbound; single-flight connection mutex | **HTTP/1.1 Standard**<br>Connection pools subject to socket exhaustion | **HTTP/1.1 & HTTP/2**<br>Managed upstream cloud ingress | **HTTP/1.1 Standard**<br>Standard agent pooling |
| **Daily Quota Handling** | **Decoupled Conserve Engine**<br>Calculates Midnight UTC rollover (+60s safety) for free tiers | **Static Cooldown**<br>Standard 65s backoff loops on daily exhausted keys | **Hard Rejection**<br>Returns 429 once daily tier limit is reached | **Budget Alerts**<br>Hard caps, stops serving requests |
| **Pricing & Licensing** | **100% Free & Open Source**<br>MIT License; zero SaaS markup | **Open Core / Enterprise**<br>Free tier limited; paid enterprise features | **SaaS Markup**<br>Adds percentage margin on every token | **SaaS Subscription**<br>Usage-tiered enterprise pricing |

---

## The Three Universal Problems & LiteRouter Solutions

### 1. Rate Limit Stalls (429 Throttling)
- **The Problem:** A single provider API key hits a rate limit or tier cap. Traditional proxies freeze the client request in a 60–65 second sleep loop, locking up the developer's IDE or agent loop.
- **The v4.0 Solution:**
  - **2-Second Key Rotation**: `KeyPool` immediately advances to the next available healthy key within 2,000ms.
  - **Fast FIFO Pacer**: `RequestPacer` uses an internal queue (`FastFifoQueue`) to smooth request bursts to provider RPM limits without hitting upstream rate limiters.
  - **Decoupled Conserve Engine**: Daily tier limits (e.g., OpenRouter `free-models-per-day`) trigger a precise midnight UTC parking TTL, preventing daily-exhausted keys from clogging active rotation.

### 2. Multi-Turn Context Bloat (Reasoning Token Bleed)
- **The Problem:** Modern reasoning models (DeepSeek-R1, Gemini 2.5 Pro, Nemotron) emit verbose `<thinking>` blocks. When an autonomous agent carries conversation history forward, previous reasoning blocks are repeatedly re-sent in prompts, wasting 50% to 70% of the token budget.
- **The v4.0 Solution:**
  - **Dynamic Context Pruner & Scrubber**: LiteRouter inspects message history and strips reasoning content from prior turns (`delta.reasoning_content` or `<think>` tags) while keeping the current response's reasoning intact for the user.
  - **OpenCode Database Shield**: Prevents agent SQLite logs from inflating from 40KB to 300KB+ per session.

### 3. Fragile Multi-Turn Agent Tool Calling
- **The Problem:** Advanced agent workflows (OpenCode, Claude Code, Cursor) break when models fail to maintain state across multi-turn tool calling. For example, Google Gemini returns `"Invalid tool call signature"` if the `thought_signature` from turn 1 is missing on turn 2.
- **The v4.0 Solution:**
  - **Thought Signature Injector**: `src/transformers/thinking.ts` transparently records and reinjects Google thought signatures across multi-step tool calls.
  - **Cross-Wire Translation**: Supports Anthropic-to-OpenAI cross-wires (`lr-*-ao-ch-*`) for seamless tool translation.
  - **Audit First**: Run `bun run eval/code.ts` to test schema adherence and multi-step loops before shipping.

---

## Target Audience Personas

### Persona 1: The Autonomous Agent Developer (OpenCode, Claude Code, Cursor)
- **Pain:** "My coding agent freezes for 65 seconds when a key hits 429. Gemini tool calls fail midway through multi-step edits. Thinking tokens eat my token budget."
- **Hook:** "LiteRouter rotates keys in 2 seconds, fixes Gemini tool-call signatures automatically, and cuts prompt token usage by up to 70%."

### Persona 2: The Enterprise AI Tech Lead
- **Pain:** "We need a self-hosted gateway without maintaining another PostgreSQL and Redis cluster. We also need to audit model capabilities before approving them for internal agents."
- **Hook:** "Deploy LiteRouter in 30 seconds with Bun. Zero databases. Run `eval/eval.ts` to audit models across speed, code, and web in 60 seconds with verifiable report cards."

### Persona 3: The Cost-Conscious AI Engineer
- **Pain:** "SaaS gateways charge markups on top of upstream token costs. Python proxies like LiteLLM consume too much memory and add 30ms latency to every generation."
- **Hook:** "LiteRouter adds sub-millisecond overhead, runs on bare-metal Bun, multiplexes over HTTP/2, and eliminates reasoning token repetition."

---

## Core Technical Facts

| Attribute | Value |
|---|---|
| **Repository** | `https://github.com/Acivar-Digital/literouter` |
| **Runtime** | Bun 1.2+ (TypeScript) |
| **Architecture** | Zero-dependency in-memory architecture (`KeyPool`, `CooldownManager`, `RequestPacer`) |
| **Inbound Protocol** | HTTP/2 + HTTP/1.1 ALPN over native TLS (Port 7766) |
| **Outbound Protocol** | Persistent `Http2SessionPool` with single-flight mutex locks |
| **Key Grammar** | `lr-<provider>-<payload>-<completion>-<nuance>` or `lr-fse-<preset>` |
| **Evaluation Suite** | 3-Pillar Model Evaluation Gauntlet (`eval/eval.ts`: Speed, Code/Agentic, Web) |
| **Providers Supported** | OpenRouter, NVIDIA NIM, Google AI Studio, Google Cloud Vertex AI, Zen, Anthropic, custom endpoints |
| **License** | MIT |

### The "Golden Start" (One-Liner)
```bash
git clone https://github.com/Acivar-Digital/literouter.git && cd literouter && bun install && cp .env.example .env && bash scripts/start.sh
```
→ **A production-ready, zero-dependency AI gateway running in under 30 seconds.**

---

## Content & Messaging Guidelines

### What to Emphasize (Ground Truth)
1. **Audit First + Route Anywhere**: Model auditing with `eval/eval.ts` gives teams objective data before deploying keys or models.
2. **Zero External Databases**: No Redis, Valkey, Postgres, or SQLite required. State lives in Bun's optimized in-memory data structures.
3. **Sub-Millisecond Overhead**: Pure Bun/TypeScript event loop with HTTP/2 ALPN multiplexing.
4. **Directive Key Flexibility**: Routing and transformation configured right from the client's Bearer token.
5. **70% Token Cost Reduction**: Stripping stale historical reasoning blocks prevents exponential context growth.
6. **2-Second 429 Recovery**: Key rotation avoids lengthy client-side stalls.

### What NOT to Claim
1. ❌ DO NOT claim LiteRouter requires Redis or Valkey (v4.0 is completely in-memory).
2. ❌ DO NOT claim LiteRouter is a model provider (it is an intelligent gateway and proxy).
3. ❌ DO NOT make vague claims without referencing concrete features (Directive Keys, `eval/eval.ts`, `KeyPool`, `h2_pool`).
