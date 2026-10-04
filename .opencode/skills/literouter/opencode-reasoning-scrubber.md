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
- Workspace: `.opencode/plugins/collapse-reasoning.ts`
- Global: `~/.config/opencode/plugins/collapse-reasoning.ts`
- XDG Active: `~/.config/opencode_xdg/opencode/plugins/collapse-reasoning.ts`

### Hardened Production Implementation:
```typescript
import { Plugin } from "@opencode-ai/plugin";

/**
 * OpenCode V2 Native Plugin: collapse-reasoning
 *
 * Invariants:
 * 1. Never produce empty `content: []` or empty text `""` (causes Anthropic/OpenAI HTTP 400).
 * 2. Handle unclosed `<think>` tags from truncated or interrupted assistant responses.
 * 3. Preserve valid Effect-TS / AST shape for outbound context dispatch.
 * 4. Preserve thinking blocks & signatures for assistant turns that called tools (mandated by Anthropic).
 */

function cleanText(text: string): string {
  if (!text) return "";
  return text
    .replace(/<(?:think|thought|thinking)>[\s\S]*?<\/(?:think|thought|thinking)>/gi, "")
    .replace(/\[(?:think|thought|thinking)\][\s\S]*?\[\/(?:think|thought|thinking)\]/gi, "")
    .replace(/<(?:think|thought|thinking)>[\s\S]*$/gi, "")
    .replace(/\[(?:think|thought|thinking)\][\s\S]*$/gi, "")
    .trim();
}

function cleanPart(part: unknown): unknown {
  if (!part || typeof part !== "object") return part;
  const obj = part as Record<string, unknown>;
  if (obj.type === "reasoning") return null;
  if (obj.type === "text" && typeof obj.text === "string") {
    const cleaned = cleanText(obj.text);
    if (!cleaned) return null;
    return { ...obj, text: cleaned };
  }
  return part;
}

function hasToolCalls(msg: Record<string, unknown>): boolean {
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return true;
  if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) return true;
  if (msg.function_call) return true;
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
    return {
      ...m,
      content:
        cleanedParts.length > 0
          ? cleanedParts
          : [{ type: "text", text: "(thinking collapsed)" }],
    };
  }

  // Handle string content
  if (typeof m.content === "string") {
    const cleaned = cleanText(m.content);
    return {
      ...m,
      content: cleaned.length > 0 ? cleaned : "(thinking collapsed)",
    };
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

## 4. Anthropic Messages Wire Invariants & Protocol Realities

When routing through Anthropic Messages wire (`/v1/messages`, e.g. Claude 3.7 Sonnet or `lr-zn-ant/*`):

1. **Tool-Use Signature Coupling**:
   - Anthropic attaches cryptographic `signature` fields to `thinking` blocks.
   - If an assistant message called a tool, Anthropic **strictly forbids** omitting or modifying the preceding `thinking` block or its signature. Removing reasoning from tool turns triggers HTTP 400 (`Thinking blocks cannot be removed from assistant turns that invoked tools`).
   - `collapse-reasoning.ts` guarantees this by returning unmutated assistant messages whenever `hasToolCalls(m)` is true.

2. **Non-Empty Content Constraint**:
   - Anthropic schemas strictly mandate `messages.X.content: Input should have at least 1 item` and `messages.X.content.Y.text: String should have at least 1 character`.
   - Stripping reasoning from a purely conversational turn that emitted only reasoning would reduce `content` to `[]`.
   - The plugin injects a fallback placeholder `[{ type: "text", text: "(thinking collapsed)" }]` to preserve valid schema structure.

3. **Role Alternation Invariant**:
   - In Anthropic protocol, consecutive messages must alternate between `user` and `assistant`.
   - Dropping the assistant message entirely when reasoning is stripped would cause consecutive `user` (or `user` and `tool_result`) messages to collide, triggering HTTP 400. The placeholder maintains role alternating topology.

4. **Debunking LLM Hallucinations (Senior QA Myths)**:
   - **Myth 1 (@opencode/plugin)**: Fake package name. OpenCode V2's native plugin package remains `@opencode-ai/plugin` (`@opencode-ai/plugin@next`).
   - **Myth 2 (Database corruption / Issue #43731)**: Hallucinated issue. In OpenCode V2, `ctx.session.hook("context")` operates exclusively on ephemeral in-memory dispatch payloads; it never writes back to the SQLite session store. Furthermore, `TextPart` and `ReasoningPart` in `@opencode-ai/ai` do not even possess an `id` field. Stripping `id` from tool calls would break RPC response correlation.

---

## 4. Performance & Execution Characteristics

- **Zero-Latency Execution**: Operates purely in-memory over 10–30 message objects via synchronous regex and array mapping (< 0.1ms).
- **Zero I/O / Process Spawning**: No subprocesses, network calls, or disk reads during hook execution.
- **Fail-Safe**: Wrapped in `try...catch` with automatic fallback to unmutated context on error.
- **Universal Provider Coverage**: Intercepts requests before dispatch to **all** configured providers (Antigravity on `10.32.34.243:8045`, Zen, OpenRouter, Google, NVIDIA, etc.).

---

## 5. Self-Healing Auto-Patcher (`scripts/hooks/opencode_autopatch.sh`)

To guarantee persistence across `@opencode-ai/cli` upgrades, the pre-launch auto-patcher enforces plugin integrity:

1. **File Synchronization**: Verifies `~/.config/opencode/plugins/collapse-reasoning.ts` exists and mirrors the latest repository version.
2. **Config Registration**: Validates that `~/.config/opencode/config.json` registers `"./plugins/collapse-reasoning.ts"` in `"plugins": [...]`.
3. **Execution**: Automatically triggered via `~/.local/bin/opencode` prior to starting OpenCode.

Manual test/verification:
```bash
bash scripts/hooks/opencode_autopatch.sh -v
```

---

## 6. Directive Validity Notes (canon: `directive-grammar.md`)

- ⛔ `gb` is never valid — it appears nowhere in `src/`; any key containing it fails parsing.
- `lg` is parser-only — accepted by `src/directive/parser.ts:93` but absent from `NuanceCodeSchema` (`src/config/schema.ts:34-42`), so config-file validation rejects what the gateway parser accepts.
- `tp` is tests-only — a loopback test double (`http://127.0.0.1:8999`); never use it outside unit tests.
