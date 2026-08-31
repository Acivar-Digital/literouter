# OpenCode 2 Outbound Reasoning Scrubber & Streaming Observability

This guide documents the architecture, lifecycle hooks, and self-healing deployment of the **OpenCode 2 Outbound Reasoning Scrubber** (`collapse-reasoning.ts`).

---

## 1. Core Architectural Intent

The reasoning management policy balances real-time developer observability with strict token parsimony:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CORE ARCHITECTURAL POLICY                       │
│                                                                        │
│ 1. INBOUND LIVE STREAMING  ──> PASS THROUGH to Terminal (Observability)│
│ 2. OUTBOUND NEXT-TURN MAP  ──> SCRUB from History (Token Savings)      │
└────────────────────────────────────────────────────────────────────────┘
```

| Direction | Stage | Behavior | Rationale |
|---|---|---|---|
| **Inbound (Downstream)** | Provider $\rightarrow$ OpenCode2 TUI | **Full Passthrough** | User sees live `<think>` / reasoning streams on terminal in real-time. |
| **Outbound (Upstream)** | OpenCode2 $\rightarrow$ Provider | **Scrub / Collapse** | Strips prior assistant reasoning blocks before dispatch to save tokens. |

---

## 2. Why Outbound Scrubbing is Required

In multi-turn agentic conversations, reasoning models (DeepSeek-R1, Qwen-Thinking, Gemini, etc.) produce long reasoning chains (e.g. 5,000–15,000 tokens per turn). 

If retained in session history:
1. OpenCode re-injects all past thinking chains into subsequent turns.
2. Prompt token volume balloons from ~40K to 300K+ tokens within 3–4 turns.
3. This exhausts provider context limits and inflates inference costs without adding actionable context to the LLM.

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

function cleanMessage(msg: unknown): unknown {
  if (!msg || typeof msg !== "object") return msg;
  const m = msg as Record<string, unknown>;
  if (m.role !== "assistant") return msg;
  if (Array.isArray(m.content)) {
    const cleanedParts = m.content.map(cleanPart).filter((p) => p !== null);
    return { ...m, content: cleanedParts };
  }
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
