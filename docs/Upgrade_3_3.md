# LiteRouter Version 3.3 Architecture: Terminal UI, Folder Structure & Diagnostics (Doctor)

## Executive Overview

Part 3 formalizes the visual telemetry presented in the terminal, proposes the ground-up repository directory structure (including the upcoming `tests/` layout for Part 4), and provides a critical architectural assessment of `scripts/doctor.ts` and using **Zod** for configuration validation and schema healing.

---

# SECTION 1: TERMINAL UI & VISUAL TELEMETRY

LiteRouter's terminal interface is designed for real-time observability during active agentic coding sessions.

## 1.1 Emoji State Taxonomy

All runtime logs are tagged with timestamped, color-coded emojis representing state transitions:

```text
🔵 [MM-DD-HH:MM:SS:mmm] INBOUND    : Incoming request received from downstream client
🔄 [MM-DD-HH:MM:SS:mmm] ROTATE     : Swapping active key index within the provider pool
🟡 [MM-DD-HH:MM:SS:mmm] AMBER      : Approaching RPM/TPM limit or transient warning
⚠️ [MM-DD-HH:MM:SS:mmm] LIMIT      : Upstream 429 rate limit detected; applying cooldown
🟠 [MM-DD-HH:MM:SS:mmm] RETRY      : Sub-2s grace retry or stream stall resend attempt
🔴 [MM-DD-HH:MM:SS:mmm] EXHAUSTED  : All keys in pool quarantined; applying ladder backoff
🟢 [MM-DD-HH:MM:SS:mmm] SERVED     : Request successfully completed and streamed
🚀 [MM-DD-HH:MM:SS:mmm] BOOT       : LiteRouter gateway initialized and listening
💥 [MM-DD-HH:MM:SS:mmm] ERROR      : Fatal error or 401 key rejection
🔗 [MM-DD-HH:MM:SS:mmm] FUSION     : Fusion Sticky Engine routing and sticky state updates
📝 [MM-DD-HH:MM:SS:mmm] TRACE      : Audit trace written to logs/traces/
```

## 1.2 Boot Banner (`🚀 [BOOT]`)

Displayed when LiteRouter starts up:

```text
================================================================================
🚀 LITEROUTER v3.1 GATEWAY [BUN RUNTIME]
================================================================================
Port           : 7766 (HTTP/1.1 & HTTP/2 Cleartext)
TLS Enabled    : false
Auth Mode      : API-Key Declarative Directive (lr-xx-xx-xx-xx / lr-fse-xxxx)
Strip Reasoning: true (Global default; overridable via 'ts' nuance)

Key Pools Loaded:
  • OpenRouter (or) : 5 active keys
  • NVIDIA NIM (nv) : 3 active keys
  • Google (gg)     : 4 active keys
  • Zen (zn)        : 2 active keys
  • Anthropic (an)  : 1 active key

Endpoints Registered:
  • /v1/chat/completions (OpenAI Chat)
  • /v1/messages         (Anthropic Claude Messages)
  • /v1/models           (Dynamic Model Discovery)
  • /v1beta/openai/*     (Google OpenAI-Compat Beta)
  • /v1beta/models/*     (Google Native RPC)
  • /reset               (Hard Flush / State Reset)
================================================================================
```

## 1.3 Live Request Lifecycle Telemetry

During active streaming and tool-calling execution:

```text
🔵 [08-17-14:32:01:105] [REQ-89f2a] Inbound POST /v1/messages from Claude-Code/1.0
    Directive : lr-or-cl-ms-no -> Target: OpenRouter | Wire: Claude | EP: /api/v1/messages
    Model     : anthropic/claude-3.7-sonnet | Key: OpenRouter [Key #1/5]

🟢 [08-17-14:32:01:420] [TTFT REQ-89f2a] TTFT = 315ms | First chunk streamed downstream

🟢 [08-17-14:32:04:890] [USAGE REQ-89f2a] OpenRouter (Key #1)
    Tokens: Prompt=1,420 | Completion=680 | Total=2,100 | Speed=198.8 tok/s

────────────────────────────────────────────────────────────────────────────────

🔵 [08-17-14:32:10:002] [REQ-89f2b] Inbound POST /v1/chat/completions from Cursor/0.45
    Directive : lr-nv-oa-ch-dp+ts -> Target: NVIDIA NIM | Wire: OpenAI | EP: /v1/chat/completions
    Model     : deepseek-ai/deepseek-r1 | Key: NVIDIA [Key #2/3] | Nuances: [dp, ts]

⚠️ [08-17-14:32:10:450] [LIMIT REQ-89f2b] NVIDIA [Key #2] returned 429 Too Many Requests
    Parsed Retry-After: 60s -> Quarantined Key #2 for 60s
🔄 [08-17-14:32:10:455] [ROTATE REQ-89f2b] Advancing to NVIDIA [Key #3/3] -> Retrying immediately

🟢 [08-17-14:32:11:120] [TTFT REQ-89f2b] TTFT = 665ms | Stream established
🟢 [08-17-14:32:15:340] [USAGE REQ-89f2b] NVIDIA (Key #3)
    Tokens: Prompt=3,210 | Reasoning=1,120 | Completion=450 | Total=4,780 | Speed=92.4 tok/s
```

---

# SECTION 2: PROPOSED GROUND-UP REPOSITORY STRUCTURE

To maintain surgical modularity, high performance, and comprehensive test coverage:

```text
literouter/
├── config/
│   ├── providers.json             # Master provider endpoints, base URLs & rate limits
│   ├── fusion.json                # Fusion Sticky Engine fallback chains & tiers
│   └── models.json                # Curated upstream model registry
│
├── src/
│   ├── index.ts                   # Main Bun server entrypoint & HTTP routing table
│   ├── lib.ts                     # Public interface exports
│   │
│   ├── config/
│   │   ├── env.ts                 # Environment variable parser (.env)
│   │   ├── keys.ts                # Key pool loader & static validator (.env.local)
│   │   └── schema.ts              # Zod schemas for config validation & healing
│   │
│   ├── directive/
│   │   ├── parser.ts              # 2-letter key parser (lr-xx-xx-xx-xx / lr-fse-xxxx)
│   │   └── validator.ts           # Strict lowercase & registry validation (401 rejection)
│   │
│   ├── handlers/
│   │   ├── openai_compat.ts       # OpenAI /v1/chat/completions handler
│   │   ├── anthropic_compat.ts    # Anthropic /v1/messages handler & wire translator
│   │   ├── google_native.ts       # Google /v1beta/models native RPC & beta handlers
│   │   └── discovery.ts           # Dynamic GET /v1/models discovery endpoint
│   │
│   ├── transformers/
│   │   ├── payload.ts             # Message sanitization, turn merging, latex normalization
│   │   ├── thinking.ts            # Reasoning stripping & Anthropic thinking_delta conversion
│   │   ├── dots.ts                # Dots XML function calling real-time streaming parser
│   │   └── nuances.ts             # Dot-prompt, Gemma constraints, and Google 3 nuances
│   │
│   ├── network/
│   │   ├── fetcher.ts             # Multi-stage timeout, ghost guard, stall auto-resend
│   │   ├── pool.ts                # Provider key pool state & active index rotation
│   │   ├── cooldown.ts            # Reason-aware quarantine & Retry-After parser
│   │   └── zdist.ts               # Sliding-window RPM/RPD rate limit tracker
│   │
│   ├── fusion/
│   │   ├── engine.ts              # Multi-tier fallback execution engine
│   │   └── sticky.ts              # 5-minute sticky position cache & recovery
│   │
│   └── ui/
│       ├── logger.ts              # Timestamped emoji console logging
│       ├── banner.ts              # Boot summary banner renderer
│       └── telemetry.ts           # TTFT, tok/s, and usage accounting sink
│
├── tests/                         # Full Testing Suite (Detailed in Part 4)
│   ├── unit/                      # Fast in-memory unit tests (Bun test)
│   │   ├── directive.test.ts      # Key parsing & 401 rejection tests
│   │   ├── transformers.test.ts   # Gemma turn merging, Dots XML, thought signatures
│   │   ├── cooldown.test.ts       # Smart cooldown, TTL calculation, sub-2s grace
│   │   └── fetcher.test.ts        # Ghost response detection, stall timeouts
│   ├── integration/               # Integration tests against mock/live gateway
│   │   ├── openai_compat.test.ts
│   │   ├── anthropic_compat.test.ts
│   │   └── discovery.test.ts
│   ├── smoke/                     # Fast smoke probes
│   └── fixtures/                  # Sample payloads, SSE mock streams, XML tool calls
│
├── scripts/
│   ├── doctor.ts                  # Diagnostic probe & configuration health checker
│   ├── start.sh                   # Gateway startup daemon (tmux/background)
│   ├── stop.sh                    # Gateway teardown script
│   ├── protect.sh                 # Sudo write-protection for .env.local (644 root)
│   └── flush.ts                   # Hard reset & state flush CLI script
│
├── docs/                          # Architecture & Master Specifications
│   ├── Upgrade_3_1.md             # Part 1: Filtering Logic & Key Specification
│   ├── Upgrade_3_2.md             # Part 2: Engine Logic, Resilience & Model Catalog
│   ├── Upgrade_3_3.md             # Part 3: Terminal UI, Folder Structure & Diagnostics
│   ├── Upgrade_3_gemini.md        # Raw Google AI Studio model quotas
│   └── ARCHITECTURE.md            # Legacy architecture reference
│
├── logs/
│   └── traces/                    # JSON request/response audit traces (0600)
│
├── .env                           # Runtime operational settings (User editable)
├── .env.local                     # Vendor API keys (Sudo protected)
├── package.json                   # Bun dependencies & scripts
└── tsconfig.json                  # TypeScript compiler settings
```

---

# SECTION 3: DOCTOR TOOLING & CRITICAL ASSESSMENT OF ZOD FOR HEALING

## 3.1 What is the Doctor Script (`scripts/doctor.ts`)?

`scripts/doctor.ts` is an **independent, non-blocking diagnostic tool**. It allows the developer to probe configuration health, file permissions, key pool validity, and upstream network reachability on demand:

```bash
bun run scripts/doctor.ts
```

- **FYI Only**: It reports findings to the developer and exits. It **never gates boot**, never blocks startup, and never modifies `.env.local`.

---

## 3.2 Critical Assessment: Should We Use Zod for "Self-Healing"?

### What Zod Does Best:
1. **Schema Validation on Boot**: Validating `providers.json`, `fusion.json`, and `.env` schemas. If a user accidentally omits a required field (e.g. missing `base_url` or typing `"rpm": "twenty"` instead of `20`), Zod catches it instantly with precise error locations rather than crashing deep inside an async stream.
2. **Type Inference**: Generates TypeScript types automatically from schemas (`export type ProviderConfig = z.infer<typeof ProviderSchema>`), ensuring compile-time safety.
3. **Data Transformation & Sanitization (Healing)**:
   - Auto-coercing environment variables (`z.coerce.number().default(5000)`).
   - Trimming whitespace and enforcing lowercase on keys (`z.string().trim().toLowerCase()`).
   - Supplying resilient fallbacks for missing operational knobs without crashing.

---

### Critical Evaluation Matrix: Where Zod is Appropriate vs Anti-Pattern

| Domain | Using Zod for Self-Healing? | Verdict | Architectural Justification |
|---|---|---|---|
| **Configuration Files (`.env`, `providers.json`)** | ✅ **YES (Recommended)** | **Strong Benefit** | Auto-heals missing optional settings with sensible defaults; normalizes numbers, booleans, and trims whitespace. Catches syntax bugs before boot. |
| **Inbound API Keys (`lr-xx-xx-xx-xx`)** | ⚠️ **Validation Only (Strict)** | **Reject Bad Keys** | As established in Part 1: **Zero Fallback**. Zod should validate the exact schema. If invalid, reject with 401. Do NOT "heal" or guess a bad key. |
| **Vendor API Keys (`.env.local`)** | ⚠️ **Validation / Sanitization Only** | **Diagnostic Only** | Detects placeholder strings (`"changeme"`, `"todo"`) and discards them. Never overwrites or modifies `.env.local`. |
| **Upstream Network Failures / 429s** | ❌ **NO (Out of Scope for Zod)** | **Engine Responsibility** | Network retries, key rotations, and cooldowns belong to LiteRouter's runtime engine (`pool.ts`, `cooldown.ts`), not data schema validators. |

---

---

# SECTION 4: DUAL PROTOCOL: HTTP/1.1 & HTTP/2 (ALPN)

LiteRouter supports concurrent **HTTP/1.1** and **HTTP/2 (`h2`)** on port 7766 using Bun's native `uWebSockets` engine with TLS ALPN negotiation.

## 4.1 Certificate Storage (`certs/` Directory)

Certificates are generated and stored inside the project `certs/` directory:

```text
certs/
├── localhost.pem           # Trusted TLS Certificate (mode 0600)
└── localhost-key.pem       # Private Key (mode 0600)
```

- **Generation Tooling**: Uses `mkcert` (`scripts/setup_certs.sh`) to install a local root CA into the system trust store. This prevents self-signed SSL errors in Node, Bun, Python, Cursor, and OpenCode.
- **Dynamic Protocol Detection**:
  - If `certs/localhost.pem` and `certs/localhost-key.pem` exist (or `LITEROUTER_TLS_ENABLED=true`), LiteRouter automatically activates TLS on port 7766 and negotiates `h2` / `http/1.1` via ALPN.
  - If certificates are absent, LiteRouter falls back to cleartext HTTP/1.1 without crashing.

## 4.2 HTTP/2 Stream Multiplexing & Cancellation
- **Zero Head-of-Line Blocking**: Multiple parallel requests from IDE agents (e.g. background indexing + active chat) share a single multiplexed TCP connection.
- **`RST_STREAM` Abort Propagation**: When a client cancels an HTTP/2 stream, Bun fires `req.signal.onabort`, which immediately aborts the active upstream provider `fetch()` call.

