# 1. SYSTEM ROLE & CONTEXT
You are an expert TypeScript / Bun Backend Engineer operating in a disconnected environment (Google AI Studio). You cannot run tests, execute code, or run linters. You must output precise, syntactically correct TypeScript code for Bun based *only* on this document.

This is **LiteRouter**, a high-density TypeScript API Gateway running on **Bun** (Port 7766). It proxies OpenAI-compatible and Google native generative AI endpoints, manages key rotation via Valkey, handles Thinking/Reasoning payload translation, and performs failover/cooldown logic across provider chains.

---

# 2. THE PROBLEM & OBJECTIVE
Our cyclomatic complexity analysis (`bun run complexity`) revealed several high-complexity monolithic functions that reduce maintainability and increase bug risk during gateway execution:

1. **`executeOpenAICompat`** in `src/index.ts`: Cyclomatic Complexity = **47** (🚨 HIGH)
   - *Root cause*: Single monolithic function handling authentication, headers, fusion group resolution, key rotation loop, header transformation, streaming, and error handling.
2. **`executeGoogleNative`** in `src/index.ts`: Cyclomatic Complexity = **36** (🚨 HIGH)
   - *Root cause*: Single monolithic function handling Google native endpoint URL construction, key validation, streaming contents body transformation, and retry loops.
3. **`translateGoogleThinking`** in `src/lib.ts`: Cyclomatic Complexity = **16** (🚨 HIGH)
   - *Root cause*: Multiple nested conditionals inspecting legacy & native thinking properties (`google.thinking_config`, `thinkingConfig`, `reasoning_effort`, `thinking`).
4. **`mergeConsecutiveMessages`** in `src/lib.ts`: Cyclomatic Complexity = **16** (🚨 HIGH)
   - *Root cause*: Complex nested branch matrix for string vs array content concatenation.

### Definition of Done:
- Refactor `executeOpenAICompat` and `executeGoogleNative` in `src/index.ts` into smaller, pure/focused helper functions (e.g. `prepareOpenAIHeaders`, `handleOpenAIStreamingResponse`, `buildGoogleNativeUrl`, etc.) so that no function exceeds Cyclomatic Complexity **15**.
- Refactor `translateGoogleThinking` and `mergeConsecutiveMessages` in `src/lib.ts` into clean, linear branch helper routines.
- Maintain **100% feature parity**, zero breaking changes, exact response headers, and pass all 13 unit tests in `bun test`.

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
  - Refactor `translateGoogleThinking(data: any): any` into `extractThinkingLevel(data: any)` and `applyReasoningEffort(data: any, level?: string)` to eliminate deep nesting.
  - Refactor `mergeConsecutiveMessages(messages: any[]): any[]` into a clean message content merger helper (`concatMessageContent(prev: any, current: any)`).
- **`src/index.ts`**:
  - Extract header preparation into `prepareProxyHeaders(req: Request, targetHost: string): Headers`.
  - Extract streaming vs non-streaming response processing for `executeOpenAICompat` into helper functions.
  - Extract URL and payload builder for `executeGoogleNative` into `buildGoogleNativeRequest(model: string, action: string, req: Request)`.

---

# 5. STRICT PROJECT CONVENTIONS (STATIC)
1. **Bun Native TypeScript:** Use native Bun APIs (`Bun.serve`, `fetch`, `AbortSignal`). Do NOT introduce node-specific dependencies or legacy wrappers.
2. **Zero Behavior Shift:** Gate 1 static key validation, Valkey cooldown (65s floor for Google, 1wk for 401/403), stream transformation (`createStreamTransformer`), and thought signature injection MUST remain completely identical.
3. **Fail Fast & Surface Errors:** Do not swallow exceptions or hide HTTP status codes.

---

# 6. PROVIDED FILES
The full source code of `src/lib.ts` (Lines 1-267) and `src/index.ts` have been copied to `admin/studio/upload/lib.ts` and `admin/studio/upload/index.ts`.

---

# 7. REQUIRED OUTPUT FORMAT (STATIC)

### Part 1: The Active Demonstration Checklist
You MUST explicitly answer these 4 questions before writing any code:
- **Q1 (TypeScript/Bun):** State: "I understand I must use strict TypeScript definitions without breaking existing Bun native types."
- **Q2 (No Behavior Change):** State: "I confirm all status codes, header forwarding, streaming behavior, and Valkey cooldown logic remain unchanged."
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
