# Fixing Streaming Latency & Interception (Two-Leg Architecture)

## 1. Executive Summary

LiteRouter previously implemented redundant reasoning suppression on **both** communication legs:
- **Leg 1 (Outbound Request: OpenCode $\to$ LiteRouter $\to$ Provider)**: LiteRouter scrubs previous conversation history of accumulated reasoning and thought blocks before sending to the upstream provider.
- **Leg 2 (Inbound Streaming Response: Provider $\to$ LiteRouter $\to$ OpenCode TUI)**: LiteRouter was *also* intercepting every incoming Server-Sent Events (SSE) chunk, buffering lines, executing `JSON.parse` $\to$ deleting reasoning keys $\to$ executing `JSON.stringify`, dropping reasoning chunks, and injecting 5-second synthetic heartbeats.

Because Leg 1 **already** strips reasoning history before sending requests upstream, filtering Leg 2 at runtime created severe terminal latency, blank screens during model thinking, line-buffering stalls, and clunky streaming into the user's TUI.

This plan introduces an environment configuration flag (`LITEROUTER_STREAM_FILTER_REASONING=false`) that disables Leg 2 stream interception by default, allowing raw provider SSE chunks to stream directly to the terminal with zero delay, while keeping Leg 1 request scrubbing active.

---

## 2. The Problem & What Went Wrong

### 2.1 The Two Legs of LiteRouter

```
[OpenCode Client] ──(Leg 1: Request History)──> [LiteRouter: SCRUB] ───> [Upstream Provider]
                                                                                │
[OpenCode TUI]    <──(Leg 2: Direct Fast Stream)<───────────────────────────────┘
```

1. **Leg 1 (Outbound Request Payload)**:
   - Client sends conversation history (`messages: [...]`).
   - Handled by `src/transformers/payload.ts` $\to$ `scrubReasoningFromMessages()`.
   - Strips reasoning parts, thinking metadata, and tool bloat so the upstream provider receives a lean prompt.
   - **Status**: Essential and working correctly.

2. **Leg 2 (Inbound Streaming Response)**:
   - Provider emits SSE streaming chunks back to the client.
   - Handled by `src/transformers/opencode_adapter.ts` $\to$ `createOpenCodeReasoningFilterStreamTransformer()`.
   - **What went wrong**:
     - LiteRouter intercepted every network chunk in JavaScript.
     - Sliced text on newlines (`\n`) and buffered partial TCP frames.
     - Ran `JSON.parse()` on every single token chunk.
     - Stripped reasoning keys and marked pure reasoning chunks as `shouldEmit = false` (dropped).
     - Because chunks were dropped, it injected 5-second synthetic empty frames:
       ```json
       data: {"id":"chatcmpl-heartbeat","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":null}]}
       ```
     - **Result in Terminal**: The user's TUI appeared completely frozen for 30–120+ seconds while models were reasoning, followed by bursts of text, creating a laggy and broken experience.

---

## 3. What We Are Going to Do

1. **Add Configuration Flag (`LITEROUTER_STREAM_FILTER_REASONING`)**:
   - Add `LITEROUTER_STREAM_FILTER_REASONING: BooleanCoerceSchema.default(false)` to `src/config/schema.ts` and `src/config/env.ts`.
   - Add `LITEROUTER_STREAM_FILTER_REASONING=false` to `.env`.
   - By default (`false`), LiteRouter will **not** intercept or filter Leg 2 streaming response chunks.

2. **Update Decision Logic in `src/handlers/openai_compat.ts`**:
   - In `determineShouldFilterReasoning(directive, clientOptions)`:
     - Check `env.LITEROUTER_STREAM_FILTER_REASONING`.
     - If `false`, immediately return `false` (bypassing the stream transformer).
     - If `true` or explicitly forced via nuance `sb` (strip budget), the existing filtering logic remains available without deleting any code.

3. **Preserve Leg 1 Scrubbing**:
   - Keep `scrubReasoningFromMessages` in `src/transformers/payload.ts` completely intact.
   - Every request sent from OpenCode to upstream will continue to have past reasoning stripped from its history, preventing context bloat.

---

## 4. Expected Outcome

1. **Zero-Delay Live Streaming**: Provider SSE chunks flow straight through LiteRouter to the terminal as fast as the upstream model generates them.
2. **Instant Visual Feedback in TUI**: Thinking tokens and content tokens stream immediately into the terminal without 5-second silence gaps or empty heartbeats.
3. **No Context Bloat**: Conversation history sent upstream in subsequent turns remains clean because Leg 1 scrubbing continues to filter reasoning from the `messages` payload.
4. **Non-Destructive & Configurable**: The filtering code in `src/transformers/opencode_adapter.ts` remains intact and can be re-enabled at any time via `.env` (`LITEROUTER_STREAM_FILTER_REASONING=true`) or directive nuance (`sb`).

---

## 5. Exact Code Changes Needed

### 5.1 Update `src/config/schema.ts`

Add `LITEROUTER_STREAM_FILTER_REASONING` to `EnvConfigSchema`:

```typescript
// src/config/schema.ts
export const EnvConfigSchema = z.object({
  // ... existing fields ...
  LITEROUTER_STRIP_REASONING: BooleanCoerceSchema.default(false),
  LITEROUTER_STREAM_FILTER_REASONING: BooleanCoerceSchema.default(false), // <-- NEW FLAG
  LITEROUTER_ENABLE_SCRUBBING: BooleanCoerceSchema.default(false),
  // ... remaining fields ...
});
```

---

### 5.2 Update `src/config/env.ts`

Add the default value in `DEFAULT_ENV`:

```typescript
// src/config/env.ts
const DEFAULT_ENV: Record<string, string> = {
  // ... existing fields ...
  LITEROUTER_STRIP_REASONING: "false",
  LITEROUTER_STREAM_FILTER_REASONING: "false", // <-- NEW FLAG
  LITEROUTER_ENABLE_SCRUBBING: "false",
  // ... remaining fields ...
};
```

---

### 5.3 Update `src/handlers/openai_compat.ts`

Update `determineShouldFilterReasoning` to respect the environment flag:

```typescript
// src/handlers/openai_compat.ts
function determineShouldFilterReasoning(
  directive: DirectDirective,
  clientOptions?: RequestClientOptions
): boolean {
  const env = getEnv();

  // If nuance explicitly specifies ts (thinking support), disable filtering
  if (directive.nuances.includes("ts")) {
    return false;
  }

  // If nuance explicitly specifies sb (strip budget), force filtering
  if (directive.nuances.includes("sb")) {
    return true;
  }

  // Check global environment toggle for Leg 2 stream filtering
  if (!env.LITEROUTER_STREAM_FILTER_REASONING) {
    return false;
  }

  if (clientOptions?.filterReasoning !== undefined) {
    return clientOptions.filterReasoning;
  }

  return false;
}
```

---

### 5.4 Update `.env`

Add the operational toggle:

```ini
# .env
# Stream Response Filtering (Leg 2)
# Set to false to disable in-flight reasoning stream filtering for fast, raw TUI streaming
LITEROUTER_STREAM_FILTER_REASONING=false
```
