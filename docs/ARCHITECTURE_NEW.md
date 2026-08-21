# LiteRouter V4.4 Complete Master Blueprint (The Dual-Queue Airport Model)
**Enterprise Modular AI Gateway — Zero-Dependency Bun / TypeScript Architecture**

---

## 1. Directive Breakdown (The 5-Part Boarding Pass)

Every incoming API request presents a 5-part directive token in the `Authorization: Bearer sk-lr-...` header:
```
lr-<provider>-<payload>-<completion>-<model_nuance>
```
*(Examples: `sk-lr-or-ao-ch-no`, `sk-lr-gg-oa-ch-gm`, `sk-lr-nv-oa-ch-dp`)*

| Part | Segment | Options | Responsible Station | Architectural Purpose |
|---|---|---|---|---|
| **1. Airport** | `lr` | `lr` | **Station 1: Immigration Gate** | Identifies the request as targeting LiteRouter Gateway. |
| **2. Provider / Airline** | Airline | `or` (OpenRouter), `gg` (Google), `zn` (Zen), `nv` (NVIDIA), `ds` (DeepSeek), `gq` (Groq), `cb` (Cerebras), `oa` (OpenAI), `an` (Anthropic) | **Station 2: Check-In** & **Station 4: Runway** | Directs which key pool is stamped at check-in and which runway conveyor belt the request joins. |
| **3. Payload Format** | Baggage Class | `oa` (OpenAI format), `cl` (Anthropic format), `ao` (Anthropic $\rightarrow$ OpenAI Cross-Wire), `gg` (Google Native SDK), `rs` (Responses) | **Station 3: Takeoff** & **Station 6: Landing** | Controls payload schema transformation on takeoff and SSE stream translation on landing. |
| **4. Completion Route** | Flight Path | `ch` (`/v1/chat/completions`), `ms` (`/v1/messages`), `gc` (`generateContent`), `em` (`/v1/embeddings`), `md` (`/v1/models`) | **Station 4: Runway Dispatcher** | Resolves the exact upstream provider URL endpoint. |
| **5. Model Nuance** | Visa / Clearance | `no` (Standard), `gm` (Gemma), `ts` (Thought Signature), `dp` (DeepSeek Reasoning), `sb` (Structured JSON), `tc` (Tool Calling) | **Station 3: Takeoff Rules** | Enforces model-specific behavioral constraints (turn alternation, thinking budget stripping, radar TTFT duration). |

---

## 2. Fusion Presets & Travel Agency (`Station 0: agency/`)

When clients use `lr-fse-<preset>` (e.g. `lr-fse-fast`, `lr-fse-smart`, `lr-fse-code`), the request enters the **Travel Agency** before entering the airport:
- **`config/fusion.json`**: Defines prioritized tiers of concrete directive tickets (e.g. Tier 1: NVIDIA, Tier 2: DeepSeek, Tier 3: OpenRouter).
- **Sticky Fallback Engine**: Remembers which tier is currently healthy.
- **Resolution**: Resolves the fusion preset into a concrete 5-part ticket (e.g. `lr-nv-oa-ch-no`) and hands it to Station 1.

---

## 3. The 7 Stations of LiteRouter V4.4

```
                                [Inbound HTTP Request]
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  STATION 1: IMMIGRATION GATE (src/app.ts)                                              │
│  - 10MB Streaming Byte Counter (Kills socket immediately on chunked/oversized attacks) │
│  - Token Validator (Parses 5-part ticket)                                              │
│  - 180s Global Flight Lifecycle Budget (Linked AbortController)                        │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  STATION 2: AIRLINE CHECK-IN & KEY LOUNGE (src/checkin/) [QUEUE 1]                     │
│  - Gated by API Key Availability                                                       │
│  - Priority VIP Lane: Retried/recalled flights bypass normal passengers                │
│  - Monotonic Continuous Round-Robin: Sequentially rotates through active keys          │
│  - 120s Configurable Lounge Timeout (Returns 503 if all provider keys stay dead)       │
│  - Stamps boarding pass with valid, locked API Key                                     │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  STATION 3: TAKEOFF FLOOR (BAGGAGE & CUSTOMS) (src/takeoff/)                           │
│  - Customs Inspector: Rejects malformed JSON with 400 before touching runway slots     │
│  - Payload Converters:                                                                 │
│      * ao / cl -> oa: Translates Anthropic messages to OpenAI chat completions         │
│      * oa -> gg: Stitches thought_signature into assistant history for Google Gemini   │
│  - Model Nuance Rules:                                                                 │
│      * gm (Gemma): Enforces strict alternating user/assistant turns, NO signatures     │
│      * no (Standard): Strips client config bloat (thinking, budget_tokens)             │
│      * dp (DeepSeek): Preserves reasoning context, sets dynamic TTFT radar to 60s      │
│  - CRITICAL RULE: In-history tool calls and thought signatures are NEVER stripped!     │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  STATION 4: BOARDING GATE & RUNWAY (src/runway/) [QUEUE 2]                             │
│  - Dedicated FIFO Conveyor Belt per Airline (e.g. OpenRouter 200ms, Google 2000ms)     │
│  - NO artificial queue timeout (requests wait peacefully until their turn)             │
│  - Instant O(1) Eviction on client abort (Ctrl+C / Stop button) returning 499          │
│  - Recall Tower: Auto-pulls passengers holding keys that burned while waiting in line  │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  STATION 5: IN THE AIR / THE PILOT & RADAR (src/flight/)                               │
│  - Pre-Flight Key Sanity Check: Verifies key didn't burn in last microtask tick        │
│  - HTTP/2 Multi-Socket Connection Pool (>80 streams per TCP socket, GOAWAY drain)      │
│  - Dynamic Radar: 15s standard TTFT guard / 60s reasoning TTFT guard                   │
│  - Flight Blackbox Buffer:                                                             │
│      * Pre-Commit Crash (0 bytes sent): Silent VIP Clone & Retry on Key #2             │
│      * Post-Commit Drop (>0 bytes sent): Emits clean SSE error block (No broken JSON)  │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  STATION 6: LANDING FLOOR (CUSTOMS & STREAM BRIDGE) (src/landing/)                     │
│  - Sequential Tool-Call Index Assembler: Reassembles interleaved OpenAI tool deltas    │
│    into clean, sequential Anthropic content_block_start -> delta -> stop sequences     │
│  - Google Signature Interceptor: Strips raw thought signatures before returning to OA  │
│  - Upstream RST_STREAM: Aggressively sends RST_STREAM frame to provider on client drop │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  STATION 7: RESCUE & RECALL TOWER (src/rescue/)                                        │
│  - 429 / 5xx / Hang Handler: Quarantines failed key for 60 seconds                     │
│  - Recall Broadcast: Scans Queue 2 and redirects passengers holding bad keys           │
│  - VIP Re-enqueue: Sends failed flight to Head of Queue 1 (Max 3 total attempts)       │
│  - Fast-Canning: Returns 502/503/429 once 3 attempts are exhausted                     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Deep-Dive: Payload Handling vs Model Nuances

### A. The Google Thought Signature Protocol
1. **OpenAI-Compat to Google (`oa` $\rightarrow$ Provider: `gg`)**:
   - **Takeoff**: OpenAI clients (Cursor/OpenCode) do not send Google thought signatures. LiteRouter's takeoff bridge (`takeoff/converters/openai_to_google.ts`) injects the cached `thought_signature` into preceding assistant turns to satisfy Gemini's cryptographic tool-calling verification.
   - **Landing**: Gemini streams raw encrypted `thought_signature` blocks. LiteRouter's landing bridge (`landing/converters/google_to_openai.ts`) intercepts this, caches the signature in memory for future turns, and **strips the raw field from the outgoing response** so standard OpenAI clients don't crash on unrecognized JSON keys.
2. **Gemma Model Exception (`gm` Nuance)**:
   - Gemma models reject thought signatures and require alternating turns.
   - **Takeoff**: Bypass signature stitching; merge consecutive same-role messages.
   - **Landing**: Strip signature metadata before returning to client.
3. **Google Native SDK (`gg` $\rightarrow$ Provider: `gg`)**:
   - Clean passthrough. The official Google GenAI SDK natively manages signatures. Zero modification.

### B. Tool-Calling & Reasoning Preservation Rules
- **Top-Level Request Flags**: Scrubbed per model nuance (`no` vs `dp`/`ts`) to prevent 400 Bad Request errors on endpoints like DeepSeek or vLLM.
- **In-History Tool Calls & Arguments**: **STRICTLY PRESERVED**. Never stripped or mutated under any circumstances to prevent breaking multi-turn agent loops.

---

## 5. Control Tower, Health Probes & Administration (`src/tower/`)

1. **`/health` (HTTP Probe)**:
   - Returns real-time JSON status: Gateway uptime, HTTP/2 multi-socket pool metrics, active flights, and circuit breaker states.
2. **`/reset` (Hard Key Reset)**:
   - Flushes all 60s key quarantines across all providers and resets all key pools to healthy.
3. **`bun run scripts/doctor.ts` (CLI Diagnostics)**:
   - Actively probes upstream vendor endpoints with live keys from `.env.local` to verify credentials without gatekeeping the boot process.

---

## 6. Directory Map (<100 Lines per Micro-Module)

```
src/
├── app.ts                               # Station 1: Gatekeeper, byte counter, 180s timer
├── agency/
│   └── fusion.ts                        # Station 0: Fusion preset & sticky resolver
├── checkin/
│   ├── lounge_queue.ts                  # Station 2: Queue 1 FIFO waiting lounge
│   ├── priority_queue.ts                # Station 2: VIP fast-track lane for retries
│   └── rotator.ts                       # Station 2: Monotonic round-robin key manager
├── takeoff/
│   ├── inspector.ts                     # Station 3: Malformed JSON rejector
│   ├── parameter_scrubber.ts            # Station 3: Top-level bloat scrubber
│   ├── converters/
│   │   ├── anthropic_to_openai.ts       # Station 3: cl/ao -> oa translation
│   │   └── openai_to_google.ts          # Station 3: Signature stitching for Gemini
│   └── model_nuances/
│       ├── gemma.ts                     # Station 3: gm turn-alternation rules
│       └── deepseek.ts                  # Station 3: dp reasoning settings
├── runway/
│   ├── conveyor.ts                      # Station 4: Queue 2 strict FIFO rate pacer
│   ├── dispatcher.ts                    # Station 4: Endpoint URL resolver
│   └── recall_tower.ts                  # Station 4: Burned key evictor
├── flight/
│   ├── pilot.ts                         # Station 5: In-flight supervisor
│   ├── blackbox.ts                      # Station 5: Pre/Post commit buffer & error emitter
│   ├── radar_guard.ts                   # Station 5: Dynamic TTFT timer (15s / 60s)
│   └── http2_pool.ts                    # Station 5: Multi-socket pool (>80 streams, GOAWAY)
├── landing/
│   ├── tool_assembler.ts                # Station 6: Sequential tool delta assembler
│   ├── stream_bridge.ts                 # Station 6: OpenAI SSE -> Anthropic SSE
│   └── signature_cleaner.ts             # Station 6: Google signature response cleaner
├── rescue/
│   ├── quarantine.ts                    # Station 7: 60s key cooldown tracker
│   └── abort_sync.ts                    # Station 7: Upstream RST_STREAM on client abort
└── tower/
    ├── health.ts                        # Control Tower: /health & /reset endpoints
    └── metrics.ts                       # Control Tower: Active streams & latency stats
```

---

## 7. Operational Standards & Verification Gates

Before cutting over to V4:
1. **Zero External Dependencies**: Standard Bun HTTP + native Node `http2` / `crypto`.
2. **Micro-Module Size Cap**: Every file must remain strictly under 100 lines for modular clarity and zero LLM refactor hallucinations.
3. **Comprehensive Quality Suite**:
   - `bun run typecheck` (`tsc --noEmit`): 0 errors.
   - `bun test`: 100% unit tests passing across all 7 stations.
   - Live smoke test: Verified Claude Code tool-calling and multi-turn loops over `lr-or-ao-ch-no`.
