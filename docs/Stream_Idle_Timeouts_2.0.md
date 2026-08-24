# Stream Idle Timeouts & OpenCode 2 Streaming Diagnostic Kit 2.0
## *Automated Diagnostic & Verification Kit for Agentic Streaming Failures*

---

## 1. Objective & System Framing

This document defines the **Automated Testing & Diagnostic Kit** to identify, isolate, and verify the exact root cause of streaming freezes, mid-turn stalls, and `rawFinish: "network_error"` failures when **OpenCode 2** communicates with deep-reasoning models (such as `stealth/ox-alpha`) through **LiteRouter**.

### The Core Diagnostic Paradox
- **In Python / Pydantic AI 2.0**: The model streams reliably and completes turns successfully (`HTTP 200`).
- **In OpenCode 2**: The turn halts on multi-command tool execution, leaving the TUI frozen at the tool output preview (e.g. `return {'g…`), recording `rawFinish: "network_error"` in `opencode.db`.

This kit provides a **zero-restart, live-traffic diagnostic harness** to pinpoint whether the fault lies in:
1. Upstream chunk schema anomalies (`content: null`, raw carriage returns `\r`, malformed JSON).
2. Vercel AI SDK parser rejection (`@ai-sdk/openai` Zod schema failures).
3. Client-side inactivity timer expirations (55s silence vs heartbeat cadence).
4. Tool message wire formatting incompatibilities (array content in `role: "tool"`).

---

## 2. Forensic Discovery: The 8–11 Second Crash Profile

Forensic analysis of SQLite message history (`opencode.db`) across active `stealth/ox-alpha` sessions revealed that the failure is **NOT** a 55-second timeout, but an **immediate crash in 8.8 to 11.2 seconds**:

```
[Tool Executed (Bash)] ──> 8.8s ──> [CRASH: rawFinish = "network_error", content = []]
[Tool Executed (Grep)] ──> 10.9s ──> [CRASH: rawFinish = "network_error", content = []]
[Tool Executed (Read)] ──> 11.2s ──> [CRASH: rawFinish = "network_error", content = []]
```

### The Mechanism
1. OpenCode executes a local tool (e.g., bash/grep) and sends the tool result back to `/v1/chat/completions`.
2. OpenRouter establishes an upstream HTTP/2 stream in ~4.8s.
3. OpenRouter streams reasoning chunks where `choices[0].delta` contains `{"content": null, "reasoning": "..."}`.
4. Downstream Vercel AI SDK (`@ai-sdk/openai`) validates incoming chunks against a strict Zod schema (`z.string().optional()`).
5. Seeing `content: null`, Zod throws an unhandled `TypeError`, causing OpenCode to abort the stream in **< 25ms**, record `rawFinish: "network_error"`, and freeze the TUI.

---

## 3. The 4-Stage Automated Test Harness Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│               STAGE 1: DB EXTRACTOR & REPLAY CAPTURE                   │
│  Extracts exact failing turn payload from opencode.db (tools + msgs)   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               STAGE 2: DUAL-CLIENT PARALLEL REPLAY                     │
│  ┌──────────────────────────────┐    ┌──────────────────────────────┐  │
│  │   CLIENT A: Python / Pydantic│    │  CLIENT B: Node.js Vercel SDK│  │
│  │   (Lenient, Non-Zod Parser)  │    │  (Strict Zod Schema Parser)  │  │
│  └──────────────┬───────────────┘    └──────────────┬───────────────┘  │
└─────────────────┼───────────────────────────────────┼──────────────────┘
                  │                                   │
                  ▼                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│               STAGE 3: CHUNK-BY-CHUNK DELTA COMPARATOR                 │
│  - Asserts raw byte stream validity (\r vs \n)                         │
│  - Asserts content != null in all choices[0].delta frames              │
│  - Asserts 5s heartbeat arrival during reasoning silence               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               STAGE 4: VERDICT & ACCREDITATION REPORT                  │
│  Pinpoints exact byte/chunk offset where Vercel AI SDK aborted         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Automated Test Scenarios

### Scenario 1: Replay Failed OpenCode Turn Payload
- **Input**: The exact multi-tool message history extracted from `opencode.db` (`session_id: ses_fcd71dd78ffeuRd5wpUekhfwIp`).
- **Execution**: Dispatches the payload through LiteRouter to `stealth/ox-alpha` via an automated Node.js test script using `@ai-sdk/openai`.
- **Assertion**:
  - `streamText` resolves without throwing `AI_TypeValidationError`.
  - All received chunks parse as valid JSON.
  - No choice object contains `content: null`.

### Scenario 2: Extended Reasoning Silence & Heartbeat Delivery
- **Input**: Deep reasoning prompt generating 60+ seconds of chain-of-thought tokens.
- **Execution**: Listens to the downstream SSE stream on `localhost:7766`.
- **Assertion**:
  - Maximum silence interval between any two SSE `data:` frames is `<= 5000ms`.
  - Empty delta frames (`data: {"choices":[{"index":0,"delta":{}}]}`) are received without disrupting text generation.
  - Client stream does not abort at the 55-second mark.

### Scenario 3: Tool Call Argument Serialization
- **Input**: Multi-command prompt instructing the model to output a composite tool call (`grep_codebase` + `read_file`).
- **Execution**: Verifies that `choices[0].delta.tool_calls` chunks stream sequentially with valid `index`, `id`, `name`, and `arguments` deltas.
- **Assertion**:
  - Accumulated tool arguments form 100% valid JSON.
  - Finish reason resolves to `"tool_calls"`.

### Scenario 4: Raw Control Character Sanitization (`\r` / `0x0D`)
- **Input**: Model output containing raw carriage returns or Windows-style CRLF sequences inside code blocks.
- **Execution**: Inspects raw byte stream before JSON parsing.
- **Assertion**:
  - Zero unescaped `0x0D` characters inside JSON string literals.
  - Zero `JSON Parse error: Unterminated string` exceptions.

---

## 5. Zero-Restart Diagnostic Tooling (CLI Commands)

Run these diagnostics against the **currently running LiteRouter instance** without restarting the service:

### 1. Live SQLite Turn & Error Audit
Inspect the most recent OpenCode 2 turns and verify their finish status:
```bash
uv run python -c '
import sqlite3, json
conn = sqlite3.connect("/home/yapilwsl/.local/share/opencode2/opencode/opencode.db")
rows = conn.cursor().execute("SELECT id, time_created, data FROM session_message ORDER BY time_created DESC LIMIT 10").fetchall()
for r in rows:
    data = json.loads(r[2])
    print(f"[{r[1]}] ID: {r[0]} | Finish: {data.get(\"finish\")} | Raw: {data.get(\"rawFinish\")} | Role: {data.get(\"role\")} | ContentLen: {len(data.get(\"content\") or [])}")
'
```

### 2. Live SSE Stream Probe with Delta Inspection
Probe LiteRouter directly to observe raw SSE chunks and verify `delta.content !== null`:
```bash
curl -sk -N https://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer lr-or-oa-ch-no" \
  -H "Content-Type: application/json" \
  -H "User-Agent: @opencode-ai/cli/2.0.0-beta.1" \
  -d '{
    "model": "stealth/ox-alpha",
    "stream": true,
    "messages": [{"role": "user", "content": "Write a 5-step python script with deep thinking."}]
  }' | while IFS= read -r line; do
    if [[ "$line" =~ ^data:.* ]]; then
      echo "[SSE] $line" | grep --color=auto "content\":null" || echo "[VALID] ${line:0:80}"
    fi
  done
```

### 3. Automated Vercel AI SDK Node Harness
Run the automated TypeScript stream validator to simulate OpenCode's exact engine:
```bash
bun test tests/unit/opencode_reasoning_filter.test.ts
```

---

## 6. Pass/Fail Acceptance Criteria

| Metric / Check | Passing Condition | Failing Condition (Bug Detected) |
|---|---|---|
| **Zod Delta Validation** | Zero `content: null` chunks emitted downstream | Any chunk contains `"content": null` |
| **Max Inter-Chunk Silence** | `< 5.0 seconds` (Heartbeat fires on silence) | `> 50.0 seconds` without a `data:` frame |
| **OpenCode Message Status** | `rawFinish: "stop"` or `"tool-calls"` | `rawFinish: "network_error"` with `content: []` |
| **Tool Execution Flow** | Multi-command turns proceed automatically | UI freezes at `return {'g…` awaiting manual continue |
| **HTTP Response Status** | `HTTP 200` served in gateway log | `StreamStallError` or aborted TCP connection |

---

## 7. Action Plan for Root-Cause Identification

1. **Execute Live SSE Stream Probe**: Confirm whether `content: null` or raw `\r` escapes from LiteRouter.
2. **Execute OpenCode Replay**: Replay the exact failing turn from `ses_fcd71dd78ffeuRd5wpUekhfwIp` through LiteRouter.
3. **Capture Downstream Parse Errors**: If OpenCode aborts, capture the exact exception from the Node.js runtime to confirm if any unexpected property is breaking Zod validation.
