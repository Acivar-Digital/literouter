# OpenCode 2 Outbound Reasoning Scrubber & Streaming Observability

This guide documents the architecture, lifecycle hooks, and self-healing deployment of the **OpenCode 2 Outbound Reasoning Scrubber** (`collapse-reasoning.ts`).

---

## 1. Core Architectural Intent

The reasoning management policy balances real-time developer observability with strict token parsimony and upstream tool-call stability:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CORE ARCHITECTURAL POLICY                       │
│                                                                        │
│ 1. INBOUND LIVE STREAMING  ──> PASS THROUGH to Terminal (Observability)│
│ 2. OUTBOUND CONVERSATIONAL ──> SCRUB from History (Token Savings)      │
│ 3. OUTBOUND TOOL CALLS     ──> PRESERVE Reasoning (Provider Stability) │
└────────────────────────────────────────────────────────────────────────┘
```

| Direction | Turn Type | Behavior | Rationale |
|---|---|---|---|
| **Inbound (Downstream)** | Any Turn | **Full Passthrough** | User sees live `<think>` / reasoning streams on terminal in real-time. |
| **Outbound (Upstream)** | Conversational Turn | **Scrub / Collapse** | Strips prior assistant reasoning blocks before dispatch to save tokens. |
| **Outbound (Upstream)** | Tool Call Turn | **Preserve Reasoning** | Upstream models (Minimax, DeepSeek, Qwen) require reasoning context to validate tool arguments. |

---

## 2. Why Selective Tool Reasoning Retention is Required

In multi-turn agentic conversations:
1. **Conversational Turns**: Internal thinking monologue is irrelevant for future turns and accounts for 80%+ of prompt bloat (5,000–15,000 tokens per turn). Scrubbing them keeps the context lean.
2. **Tool Calling Turns**: When an assistant generates a `tool-call`, upstream providers (especially strict Chinese LLMs like Minimax-M3, DeepSeek, Ling, Qwen) validate the generated function call against its immediate preceding reasoning chain. Stripping reasoning from a tool-call turn can cause upstream HTTP 500 errors (`"Provider returned error"`).

---

## 3. V2 Plugin Implementation (`collapse-reasoning.ts`)

OpenCode 2 natively supports request context mutation via the `session.hook("context")` lifecycle API.

### File Location:
- Workspace: `.opencode2/plugins/collapse-reasoning.ts`
- Global: `~/.config/opencode2/plugins/collapse-reasoning.ts`

### Implementation Logic:
```typescript
import { Plugin } from "@opencode-ai/plugin";

function cleanText(text: string): string {
  if (!text) return "";
  return text
    .replace(/<(?:think|thought|thinking)>[\s\S]*?<\/(?:think|thought|thinking)>/gi, "")
    .replace(/\[(?:think|thought|thinking)\][\s\S]*?\[\/(?:think|thought|thinking)\]/gi, "")
    .trim();
}

function cleanPart(part: unknown): unknown {
  if (!part || typeof part !== "object") return part;
  const obj = part as Record<string, unknown>;
  if (obj.type === "reasoning") return null;
  if (obj.type === "text" && typeof obj.text === "string") {
    return { ...obj, text: cleanText(obj.text) };
  }
  return part;
}

function hasToolCalls(msg: Record<string, unknown>): boolean {
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    return true;
  }
  if (Array.isArray(msg.content)) {
    return msg.content.some(
      (p: unknown) =>
        p !== null &&
        typeof p === "object" &&
        ((p as Record<string, unknown>).type === "tool-call" ||
          (p as Record<string, unknown>).type === "tool_call" ||
          (p as Record<string, unknown>).type === "tool-result" ||
          (p as Record<string, unknown>).type === "tool_result")
    );
  }
  if (typeof msg.content === "string") {
    return (
      msg.content.includes("<tool_call>") ||
      msg.content.includes("<invoke") ||
      msg.content.includes("<function=")
    );
  }
  return false;
}

function cleanMessage(msg: unknown): unknown {
  if (!msg || typeof msg !== "object") return msg;
  const m = msg as Record<string, unknown>;

  // Only sanitize prior assistant turns
  if (m.role !== "assistant") return msg;

  // Selective Retention: Preserve reasoning for assistant turns that made tool calls
  if (hasToolCalls(m)) return msg;

  // Handle array content (Effect-TS AI schema)
  if (Array.isArray(m.content)) {
    const cleanedParts = m.content.map(cleanPart).filter((p) => p !== null);
    return { ...m, content: cleanedParts };
  }

  // Handle string content
  if (typeof m.content === "string") {
    return { ...m, content: cleanText(m.content) };
  }

  return msg;
}

export default Plugin.define({
  id: "collapse-reasoning",
  setup: async (ctx) => {
    await ctx.session.hook("context", async (event) => {
      try {
        if (Array.isArray(event.messages)) {
          event.messages = event.messages.map(cleanMessage) as typeof event.messages;
        }
      } catch (err) {
        console.error("[Plugin:collapse-reasoning] Context hook error:", err);
      }
    });
  },
});
```

---

## 4. Performance & Execution Characteristics

- **Zero-Latency Execution**: Operates purely in-memory over 10–30 message objects via synchronous regex and array mapping (< 0.1ms).
- **Zero I/O / Process Spawning**: No subprocesses, network calls, or disk reads during hook execution.
- **Fail-Safe**: Wrapped in `try...catch` with automatic fallback to unmutated context on error.
- **Universal Provider Coverage**: Intercepts requests before dispatch to **all** configured providers (Antigravity on `10.32.34.243:8045`, Zen, OpenRouter, Google, NVIDIA, etc.).

---

## 5. Self-Healing Auto-Patcher (`scripts/opencode2_autopatch.sh`)

To guarantee persistence across `@opencode-ai/cli` upgrades, the pre-launch auto-patcher enforces plugin integrity:

1. **File Synchronization**: Verifies `~/.config/opencode2/plugins/collapse-reasoning.ts` exists and mirrors the latest repository version.
2. **Config Registration**: Validates that `~/.config/opencode2/config.json` registers `"./plugins/collapse-reasoning.ts"` in `"plugins": [...]`.
3. **Execution**: Automatically triggered via `~/.local/bin/opencode2` prior to starting OpenCode.

Manual test/verification:
```bash
bash scripts/opencode2_autopatch.sh -v
```
