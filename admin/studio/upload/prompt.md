# 1. SYSTEM ROLE & CONTEXT
You are an expert TypeScript / Bun Backend Engineer operating in a disconnected environment (Google AI Studio). You cannot run tests, execute code, or run linters. You must output precise, syntactically correct TypeScript code for Bun based *only* on this document.

This is **LiteRouter**, a high-density TypeScript API Gateway running on **Bun** (Port 7766). It proxies OpenAI-compatible and Google native generative AI endpoints, manages key rotation via Valkey, handles Thinking/Reasoning payload translation, and performs failover/cooldown logic across provider chains.

---

# 2. THE PROBLEM & OBJECTIVE
Our cyclomatic complexity analysis (`bun run complexity`) and runtime trace audit revealed two major issues in `src/index.ts` and `src/lib.ts`:

### A. High Cyclomatic Complexity (Refactoring Goal):
1. **`executeOpenAICompat`** in `src/index.ts`: Cyclomatic Complexity = **47** (🚨 HIGH)
2. **`executeGoogleNative`** in `src/index.ts`: Cyclomatic Complexity = **36** (🚨 HIGH)
3. **`translateGoogleThinking`** in `src/lib.ts`: Cyclomatic Complexity = **16** (🚨 HIGH)
4. **`mergeConsecutiveMessages`** in `src/lib.ts`: Cyclomatic Complexity = **16** (🚨 HIGH)

### B. 429 Request-Holding Stall Bug (Feature Addition):
Currently, when a provider like OpenRouter returns a `429 Too Many Requests` or `rate_limit`:
- The active key is correctly placed into 65s Valkey cooldown.
- **BUT if all keys for that model hit 429 or are in cooldown, the inner loop throws, causing the incoming HTTP request to enter a 65-second outer sleep loop (`await new Promise(r => setTimeout(r, 65000))`).** This holds the client's HTTP request hostage in a 65s stall before attempting round 2.

### Definition of Done:
1. **2-Second 429 Rotation Feature**:
   - When a 429 rate limit response is received from OpenRouter or any provider, place the key in Valkey cooldown (`65s`), wait **2 seconds** (`2,000ms`), and immediately rotate to the next available key.
   - If **all keys for the provider/model are exhausted or in cooldown**, DO NOT force the client's request to wait 65 seconds in outer backoff loop. Immediately return/failover so Fusion chain can try the next fallback model without holding the client request hostage.
2. **Cyclomatic Complexity Reduction**:
   - Modularize `executeOpenAICompat` and `executeGoogleNative` into focused helper functions so no single function exceeds CC **15**.
   - Refactor `translateGoogleThinking` and `mergeConsecutiveMessages` in `src/lib.ts`.
3. **100% Test Parity**:
   - Pass all unit tests in `bun test` with zero breaking changes to headers, streaming transformers, or thought signatures.

---

# 3. DATA CONTRACTS & SCHEMAS (CRITICAL)

```typescript
export interface ModelsConfig {
  models: Record<string, ModelEntry>;
  providers: Record<string, ProviderConfig>;
  fusions?: Record<string, FusionConfig>;
}

export interface ModelEntry {
  provider: string;
  upstream_id: string;
  context_window?: number;
  max_output_tokens?: number;
}

export interface ProviderConfig {
  keys: string[];
  base_url?: string;
  model_prefix?: string;
}

export interface FusionConfig {
  models: string[];
  fallback_timeout_ms?: number;
  sticky_window_ms?: number;
}
```

---

# 4. SURGICAL INSTRUCTIONS
- **`src/lib.ts`**:
  - Refactor `translateGoogleThinking(data: any): any` into `extractThinkingLevel(data: any)` and `applyReasoningEffort(data: any, level?: string)`.
  - Refactor `mergeConsecutiveMessages(messages: any[]): any[]` into a clean helper (`concatMessageContent(prev: any, current: any)`).
- **`src/index.ts`**:
  - Replace the 65-second outer request stall on 429 rate limits with a **2-second key rotation delay**. If all keys for that model are exhausted/cooled down, fail fast so Fusion fallback advances instantly.
  - Extract `prepareProxyHeaders(req: Request, targetHost: string): Headers`.
  - Extract streaming vs non-streaming response handling for `executeOpenAICompat` into helper routines.
  - Extract `buildGoogleNativeRequest(model: string, action: string, req: Request)`.

---

# 5. STRICT PROJECT CONVENTIONS (STATIC)
1. **Bun Native TypeScript:** Use native Bun APIs (`Bun.serve`, `fetch`, `AbortSignal`). Do NOT introduce node-specific dependencies or legacy wrappers.
2. **Zero Behavior Shift:** Gate 1 static key validation, Valkey cooldown state, stream transformation (`createStreamTransformer`), and thought signature injection MUST remain completely intact.
3. **2-Second 429 Rotation Guarantee:** Ensure 429 retries wait exactly 2,000ms between key rotations and never freeze user requests in outer 65s delays.

---

# 6. PROVIDED FILES
The full source code of `src/lib.ts` and `src/index.ts` are located at `admin/studio/upload/lib.ts` and `admin/studio/upload/index.ts`.

---

# 7. REQUIRED OUTPUT FORMAT (STATIC)

### Part 1: The Active Demonstration Checklist
You MUST explicitly answer these 4 questions before writing any code:
- **Q1 (TypeScript/Bun):** State: "I understand I must use strict TypeScript definitions without breaking existing Bun native types."
- **Q2 (2s 429 Rotation & No Stall):** State: "I confirm 429 rate limits will trigger a 2-second key rotation and eliminate 65-second request stalls."
- **Q3 (Zero-Dicts/Strict Dot Notation):** State: "I will use clear object properties and typed parameters."
- **Q4 (No Elision):** State: "I understand I must output the complete file without truncation or `// ... rest of code`."

### Part 2: The Code (Full File Replacement)
Output the ENTIRE modified file for `src/lib.ts` and `src/index.ts` in raw code blocks:

```typescript filepath="src/lib.ts"
// Complete file content here
```

```typescript filepath="src/index.ts"
// Complete file content here
```
