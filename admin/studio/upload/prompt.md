# 1. SYSTEM ROLE & CONTEXT
You are an expert TypeScript / Bun Backend Engineer operating in a disconnected environment (Google AI Studio). You cannot run tests, execute code, or run linters. You must output precise, syntactically correct TypeScript code for Bun based *only* on this document.

This is **LiteRouter**, a high-density TypeScript API Gateway running on **Bun** (Port 7766). It proxies OpenAI-compatible and Google native generative AI endpoints, manages key rotation via Valkey, handles Thinking/Reasoning payload translation, and performs failover/cooldown logic across provider chains.

---

# 2. THE PROBLEM & OBJECTIVE
Our cyclomatic complexity analysis (`bun run complexity`) and runtime trace audit revealed three major issues requiring a complete architectural rebuild of `src/index.ts` and `src/lib.ts` into an 8-file modular domain tree:

### A. High Cyclomatic Complexity (Refactoring Goal):
1. **`executeOpenAICompat`** in `src/index.ts`: Cyclomatic Complexity = **47** (🚨 HIGH)
2. **`executeGoogleNative`** in `src/index.ts`: Cyclomatic Complexity = **36** (🚨 HIGH)
3. **`translateGoogleThinking`** in `src/lib.ts`: Cyclomatic Complexity = **16** (🚨 HIGH)
4. **`mergeConsecutiveMessages`** in `src/lib.ts`: Cyclomatic Complexity = **16** (🚨 HIGH)

### B. 429 Request-Holding Stall Bug (Feature Addition #1):
Currently, when a provider like OpenRouter returns a `429 Too Many Requests` or `rate_limit`:
- The active key is correctly placed into 65s Valkey cooldown.
- **BUT if all keys for that model hit 429 or are in cooldown, the inner loop throws, causing the incoming HTTP request to enter a 65-second outer sleep loop (`await new Promise(r => setTimeout(r, 65000))`).** This holds the client's HTTP request hostage in a 65s stall before attempting round 2.

### C. Upstream Ghosting Across All Non-Google Providers (Feature Addition #2):
When an upstream provider (such as OpenRouter, NVIDIA, or Zen) "ghosts" (opens the TCP connection but sends no HTTP response bytes within a first-byte window), the client (e.g. OpenCode) experiences an upstream timeout.
- First-byte ghosting detection MUST apply across **ALL non-Google providers** (`executeOpenAICompat`).
- Configurable via `.env`:
  `LITEROUTER_NO_RESPONSE_TIMEOUT=5` (default: 5 seconds).
  `LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS=1000` (default: 1000 ms).
  Total elapsed wait per ghosted attempt = 6 seconds.
- If Key 1 receives zero response bytes within `LITEROUTER_NO_RESPONSE_TIMEOUT` seconds (5s), LiteRouter MUST immediately abort the fetch without penalizing Key 1 (no cooldown), wait 1000ms, log the ghost event, and re-send the exact same request to Key 2.

---

# 3. TARGET MULTI-FILE ARCHITECTURE TREE

Break down the current monolithic codebase into this exact 8-file directory structure:

```
src/
├── index.ts                      # Server bootstrap & Bun.serve entrypoint
├── lib.ts                        # Pure re-export barrel file for 100% test compatibility
├── config/
│   └── env.ts                    # Environment settings (timeouts & delays)
├── transformers/
│   ├── thinking.ts               # Google thinking & reasoning_effort translation
│   └── payload.ts                # Gemma payload cleaning & thought signatures
├── network/
│   └── fetcher.ts                # First-byte timeout (ghosting) & client signal aborts
└── handlers/
    ├── openai_compat.ts          # /v1/chat/completions router & 2s 429 retry loop
    └── google_native.ts          # /v1beta/models/* native REST router
```

---

# 4. SURGICAL INSTRUCTIONS PER FILE

1. **`src/config/env.ts`**:
   - `LITEROUTER_NO_RESPONSE_TIMEOUT`: default `5` seconds.
   - `LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS`: default `1000` ms.
   - `MIN_ROTATE_DELAY_MS`: default `2000` ms.
2. **`src/network/fetcher.ts`**:
   - Implement `fetchWithFirstByteTimeout(url, init, opts)` and `NoResponseError`.
3. **`src/transformers/thinking.ts`**:
   - Refactor `translateGoogleThinking(data)` into modular helpers `extractThinkingLevel` and `applyReasoningEffort`.
4. **`src/transformers/payload.ts`**:
   - Implement `cleanGemmaPayload`, `injectThoughtSignature`, and `extractThoughtSignature`.
5. **`src/handlers/openai_compat.ts`**:
   - Handle 429 rate limit with 2-second key rotation. If all keys for that model are exhausted/in cooldown, report 429 exhaustion immediately (so Fusion advances to next model or direct route returns 429 without 65s outer stalls).
   - On ghosting timeout (5s), log warning, keep key health (no cooldown penalty), wait 1000ms, and retry Key 2.
6. **`src/handlers/google_native.ts`**:
   - Implement `executeGoogleNative` modularized into helper sub-functions.
7. **`src/lib.ts`**:
   - Pure re-export barrel file forwarding all exported functions and classes (`mergeConsecutiveMessages`, `cleanGemmaPayload`, `cleanLatexSymbols`, `getModelLimits`, `staticValidateKeys`, `fetchWithFirstByteTimeout`, `NoResponseError`) so all existing unit tests in `tests/unit/` pass without modification.
8. **`src/index.ts`**:
   - Clean, lightweight server entry point hosting `Bun.serve` on port 7766.

---

# 5. STRICT PROJECT CONVENTIONS (STATIC)
1. **Bun Native TypeScript:** Use native Bun APIs (`Bun.serve`, `fetch`, `AbortSignal`). Do NOT introduce node-specific dependencies or legacy wrappers.
2. **Zero Behavior Shift:** Gate 1 static key validation, Valkey cooldown state, stream transformation (`createStreamTransformer`), and thought signature injection MUST remain completely intact.
3. **100% Test Compatibility:** `bun test` MUST pass with zero errors.

---

# 6. PROVIDED FILES
The full source code of `src/lib.ts` and `src/index.ts` are located at `admin/studio/upload/lib.ts` and `admin/studio/upload/index.ts`.

---

# 7. REQUIRED OUTPUT FORMAT (STATIC)

### Part 1: The Active Demonstration Checklist
You MUST explicitly answer these 4 questions before writing any code:
- **Q1 (TypeScript/Bun & Barrel File):** State: "I understand src/lib.ts must act as a re-export barrel file so existing unit tests pass, while the code is structured into an 8-file modular tree."
- **Q2 (2s 429 & .env 5s/1s Ghosting Rotation):** State: "I confirm 429 retries will wait 2s without 65s stalls, and all non-Google providers will rotate to Key 2 after 5s first-byte wait + 1s delay on ghosting without burning key health."
- **Q3 (Zero-Dicts/Strict Dot Notation):** State: "I will use clear object properties and typed parameters across all modules."
- **Q4 (No Elision):** State: "I understand I must output all 8 files completely without truncation or `// ... rest of code`."

### Part 2: The Code (Multi-File Output)
Output the complete code for all 8 files in separate raw markdown code blocks:

```typescript filepath="src/config/env.ts"
// File content here
```

```typescript filepath="src/network/fetcher.ts"
// File content here
```

```typescript filepath="src/transformers/thinking.ts"
// File content here
```

```typescript filepath="src/transformers/payload.ts"
// File content here
```

```typescript filepath="src/handlers/openai_compat.ts"
// File content here
```

```typescript filepath="src/handlers/google_native.ts"
// File content here
```

```typescript filepath="src/lib.ts"
// File content here
```

```typescript filepath="src/index.ts"
// File content here
```
