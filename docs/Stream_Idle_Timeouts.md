# Stream Idle Timeouts & OpenCode Reasoning Filter Investigation

## 1. Executive Summary

When running long-context agentic workflows in **OpenCode** via **LiteRouter**, executing multi-command or high-output tool calls (e.g. `read_file` + multi-pattern `grep_codebase`) caused the OpenCode TUI to freeze/stop at the end of the tool output preview (e.g., `return {'g…`), requiring manual intervention ("press continue"). In contrast, other clients like **AGY (Antigravity)** execute identically configured turns without stalling.

This document details the forensic investigation across gateway logs, OpenCode internal state, git history, and streaming logic, and records the architectural solution: **unifying stream idle timeouts to 120 seconds (2 minutes)** to match TTFT budgets and support deep reasoning models.

---

## 2. Incident Anatomy & Symptoms

### The Observed Failure in OpenCode TUI

During a multi-stage investigation turn in `baziforecaster`, OpenCode executed a composite bash command reading lines from `coordinator.py` and running multiple `grep_codebase.py` queries:

```bash
$ echo "=== coordinator _session_to_profile body ===" && uv run python tools/read_file.py src2/interfaces/telegram/chronomancer/coordinator.py --start-line 182 --end-line 228 2>&1 | head -50 && echo "=== _process_report_entry def+callers ===" && uv run python tools/grep_codebase.py "_process_report_entry" src2 TEST --max-results 10 2>&1 | head -25 && echo "=== Database usage in agents.py ===" && uv run python tools/grep_codebase.py "_Db|from src2.interfaces.telegram.db" src2/interfaces/telegram/chronomancer/agents.py --max-results 10 2>&1 | head -15

=== coordinator _session_to_profile body ===
=== File read: src2/interfaces/telegram/chronomancer/coordinator.py (lines 182-228 of 868) ===
def _session_to_profile(session: Session) -> dict:
    p = session.profile
    if not p:
        raise ValueError('Profile is missing in session.')
    return {'g…
```

**Symptom**: The TUI stopped right at `return {'g…`. OpenCode rendered no model response, no error toast was presented, and the turn remained hung until the user pressed continue or restarted the CLI.

---

## 3. Four-Point Forensic Investigation

### Area 1: LiteRouter Gateway Logs (`logs/gateway.log`)

Examining the gateway log sequence around the incident:

```log
🔵 [08-24-14:11:35:588] [req_2ls6h6z] Inbound POST /v1/chat/completions from opencode/beta/0.0.0-beta-18050/cli
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : stealth/ox-alpha | Key: OpenRouter [Key #1/10]
🟢 [08-24-14:11:42:133] [TTFT req_2ls6h6z] TTFT = 6544ms | Stream established [Upstream: HTTP/2]
🟢 [08-24-14:13:17:894] [USAGE req_2ls6h6z] OpenRouter (Key #5/10)
    Tokens: Prompt=39,815 | Completion=3,402 | Total=43,217 | Speed=33.3 tok/s
🟢 [08-24-14:13:17:894] [SERVED req_2ls6h6z] HTTP 200 in 102305ms (attempt 1/3)
────────────────────────────────────────────────────────────────────────────────
🔵 [08-24-14:13:18:520] [req_lhaa87e] Inbound POST /v1/chat/completions from opencode/beta/0.0.0-beta-18050/cli
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : stealth/ox-alpha | Key: OpenRouter [Key #1/10]
🟢 [08-24-14:13:23:409] [TTFT req_lhaa87e] TTFT = 4887ms | Stream established [Upstream: HTTP/2]
```

1. **Turn 1 (`req_2ls6h6z`)**: Prompt context was **39,815 tokens**. OpenRouter required **102.3 seconds** to generate completion and issue the composite tool call.
2. **Tool Execution (14:13:18)**: OpenCode executed the shell commands locally in ~200ms and returned the tool result.
3. **Turn 2 (`req_lhaa87e`)**: Prompt context grew to **> 42,000 tokens**. OpenRouter established upstream HTTP/2 stream in 4.88s, but downstream OpenCode **never received completion tokens**.

### Area 2: OpenCode Internal Database (`opencode.db`)

Inspecting `/home/yapilwsl/.local/share/opencode2/opencode/opencode.db`:

1. **Tool Message (`msg_032654f230018TTkoKBCr1gVpL`)**:
   - Accurately recorded tool input and stdout (including `coordinator.py` content).
2. **Follow-up Turn (`msg_03266e13e0015t2ZavDvZJzuJt`)**:
   ```json
   {
     "time": { "created": 1787552003412 },
     "agent": "build",
     "model": { "id": "stealth/ox-alpha", "providerID": "lr-or" },
     "finish": "stop",
     "rawFinish": "network_error",
     "content": []
   }
   ```
   - OpenCode registered `rawFinish: "network_error"`.
   - Because `content` was an empty array (`[]`), the TUI had nothing to render after the tool execution box.
   - OpenCode's UI collapsed the previous tool's stdout to the first few lines ending in `return {'g…` and halted.

### Area 3: Git Commit History Analysis

| Commit | Component | Mechanism |
|---|---|---|
| `720f6f6` / `b80047f` | `src/transformers/thinking.ts` | Added `createOpenCodeReasoningFilterStreamTransformer()` to strip `delta.reasoning` & `delta.reasoning_content` in flight to mitigate OpenCode SQLite context bloat (issue #44581). |
| `56ac916` | `src/network/fetcher.ts` | Introduced `STREAM_IDLE_TIMEOUT_MS = 30000` (30s) and `readWithChunkTimeout` to catch silent socket drops. |
| `c2ef051` | `src/config/env.ts` | Unified initial connection TTFT timeout to 120s (`LITEROUTER_TTFT_TIMEOUT_MS = 120000`). |
| `f068f9f` | `src/network/fetcher.ts` | Formatted midstream error frames (`formatMidstreamErrorFrame`) on stream stall. |

### Area 4: Streaming Pipeline & Transformation Logic

The failure occurred due to two distinct failure modes in the reasoning filter:

#### Failure Mode A: The `delta.content: null` Schema Violation (Instant 21ms Abort)
Upstream providers (such as OpenRouter with `stealth/ox-alpha`) send reasoning deltas in the format:
```json
{"choices":[{"index":0,"delta":{"content":null,"reasoning":"Thinking step..."},"finish_reason":null}]}
```
When LiteRouter stripped `reasoning`, it left `{"delta": {"content": null}}`. Because `delta.content !== undefined` was `true`, LiteRouter considered this "meaningful content" and emitted `data: {"choices":[{"delta":{"content":null}}]}` downstream.
- **The crash**: OpenCode's underlying Vercel AI SDK strictly expects `content` to be `string | undefined`. Receiving `null` triggered an instant Zod validation error inside the AI SDK, causing OpenCode to abort the stream in **21 milliseconds** with `rawFinish: "network_error"`.

#### Failure Mode B: Stream Idle Timeout & Orphaned Newlines
When chunks contained only `reasoning` without `content`, LiteRouter suppressed the event line but emitted trailing `\n` characters for each double-newline, sending hundreds of orphaned newlines downstream. Simultaneously, on turns where the model reasoned for >30s on 42k context, the 30s stream idle timeout severed the connection.

#### Failure Mode C: Client-Side 55s Activity Inactivity & Discarded SSE Comments
When `stealth/ox-alpha` processes large prompts (35k–40k tokens) on OpenRouter, OpenRouter emits SSE comment frames (`: OPENROUTER PROCESSING\n\n` and `: keep-alive\n\n`) for ~45–55 seconds while thinking before generating the first text token.
- **The parser disconnect**: In standard SSE specifications and OpenCode's Vercel AI SDK (`eventsource-parser`), comment lines starting with `:` are **discarded/ignored** and do not dispatch data events to the stream listener.
- **The timeout**: Because LiteRouter's reasoning filter stripped intermediate reasoning chunks and the AI SDK discarded comment lines, downstream OpenCode received **0 valid SSE data events** for 56 seconds.
- **The abort**: OpenCode's client-side stream inactivity timer (set to ~55s) fired, threw an `AbortError: The operation was aborted`, marked `rawFinish: "network_error"`, and aborted the connection at **56.3s**.

---

## 4. Comparison: AGY vs OpenCode

| Characteristic | OpenCode (`opencode/cli`) | AGY (Antigravity IDE / SDK) |
|---|---|---|
| **Client Detection** | `isOpenCodeClient` = `true` | `isOpenCodeClient` = `false` |
| **Reasoning Stream Filter** | Enabled (strips all thinking deltas) | Bypassed (passes raw thinking deltas) |
| **Downstream Token Flow** | Receives clean string deltas + empty delta heartbeats | Receives continuous thinking tokens every ~50ms |
| **Idle Timeout Risk** | Eliminated (empty delta heartbeats reset client timer) | Zero (constant stream of tokens keeps socket active) |
| **UI Experience** | Renders tool outputs and assistant responses cleanly | Renders live thinking progress in real time |

---

## 5. Solutions & Configuration

### A. Strict Delta Sanitization & Clean Event Framing
- In `src/transformers/thinking.ts`, `sanitizeDelta` now deletes `content` if it is `null` or `undefined`.
- `hasMeaningfulDeltaFields` now strictly requires `typeof delta.content === "string" && delta.content.length > 0` (or non-empty `tool_calls`/`role`/`refusal`).
- Chunks containing only reasoning are completely dropped without emitting orphaned `\n` characters, preventing AI SDK parser corruption.

### B. Upstream Raw Control Character Sanitization (`\r` / `0x0D` Escaping)
- Implemented `sanitizeRawControlChars` in `src/transformers/thinking.ts` to escape unescaped carriage returns (`0x0D`) emitted inside string literals by upstream providers (`">\r<br> "`).
- Prevents engine-level `JSON Parse error: Unterminated string` in downstream parsers before schema validation is reached.

### C. Active Empty Delta Heartbeats for SSE Comments
- In `src/transformers/thinking.ts`, whenever an upstream keepalive comment (`: keep-alive` or `: OPENROUTER PROCESSING`) is received, LiteRouter forwards the comment AND emits a standard OpenAI empty delta frame:
  ```sse
  data: {"choices":[{"index":0,"delta":{}}]}
  ```
- **Zero text impact**: `delta: {}` contains no content or tool calls, so it produces no UI visual artifacts.
- **Resets client stream timer**: `eventsource-parser` in `@ai-sdk/openai` dispatches the event, resetting OpenCode's 55s inactivity timer every 10–15s throughout extended 60s+ thinking turns.

### D. Unified Stream Idle Timeout (120s / 2 Minutes)
`LITEROUTER_STREAM_IDLE_TIMEOUT_MS` is unified to **120000 ms (2 minutes)** across all configuration files and runtime defaults:
- `src/network/fetcher.ts`: `STREAM_IDLE_TIMEOUT_MS = 120000`
- `src/config/schema.ts`: `LITEROUTER_STREAM_IDLE_TIMEOUT_MS.default(120000)`
- `src/config/env.ts`: `DEFAULT_ENV_RECORD.LITEROUTER_STREAM_IDLE_TIMEOUT_MS = "120000"`

This aligns the inter-chunk stall threshold with `LITEROUTER_TTFT_TIMEOUT_MS` (120s), ensuring that deep reasoning models running on large context (40k–128k tokens) have sufficient time to complete their thinking phase without being severed.

### E. Thinking Support Nuance (`ts` vs `sb`)

LiteRouter provides explicit directive nuances to control reasoning streaming:

- **`lr-<prov>-oa-ch-no` (Default / Auto-Filter)**:
  Filters reasoning deltas for OpenCode (preventing SQLite context explosion) while allowing non-OpenCode clients full visibility.
- **`lr-<prov>-oa-ch-ts` (Thinking Support)**:
  Forces LiteRouter to preserve all thinking deltas even for OpenCode clients, providing real-time streaming feedback in the TUI during extended reasoning.
- **`lr-<prov>-oa-ch-sb` (Strip Budget / Global Strip)**:
  Forces reasoning stripping across all clients.

---

## 6. Verification & Configuration Matrix

| Parameter | Environment Variable | Default Value | Purpose |
|---|---|---|---|
| **TTFT Timeout** | `LITEROUTER_TTFT_TIMEOUT_MS` | `120000` (120s) | Max wait for upstream first byte / stream establishment |
| **Stream Idle Timeout** | `LITEROUTER_STREAM_IDLE_TIMEOUT_MS` | `120000` (120s) | Max allowed silence between SSE chunks during generation |
| **Max HTTP Timeout** | `LITEROUTER_HTTP_TIMEOUT_MS` | `300000` (300s) | Overall request deadline |
| **Keep-Alive Interval** | `KEEPALIVE_INTERVAL_MS` | `15000` (15s) | Periodic SSE ping comments (`: keep-alive`) |

---

## 7. Diagnostic Playbook: Other Plausible Root Causes & Failure Modes

When diagnosing similar agent stalls or hangs during tool execution and streaming in OpenCode, use this reference matrix to systematically identify the failure mode:

### Quick Diagnostic Matrix

| Observed Symptom | Time to Failure | Primary Root Cause | Inspection Target |
|---|---|---|---|
| **Instant Abort / Empty Content** | **< 100ms** (e.g. 21ms) | Schema Validation Error (e.g. `delta.content: null`) | `opencode.db` (`session_message` duration) |
| **Mid-Generation Sever** | **Exactly 30s / 120s** | Stream Idle Timeout during reasoning silence | `gateway.log` (`StreamStallError`) |
| **Hangs Mid-Sentence / Tool Call** | **2–5 minutes** | Max Output Token Exhaustion (`finish_reason: "length"`) | `opencode.db` (`rawFinish`) |
| **Stuck on "Running Tool" Spinner** | **Indefinitely** | Bash Subshell Unclosed Quote / stdin block | `ps aux \| grep bash` & `shell/*.out` |
| **Halts with No Error, Awaiting Prompt** | **Immediate** | OpenCode Permission / Auto-Approve Gate | TUI viewport / `opencode.json` config |
| **Connection Dropped Silently** | **60s–120s** | Edge HTTP/2 Proxy TCP Reset (Cloudflare) | `gateway.log` (`Network transport failure`) |

---

### Deep Dive: Five Additional Failure Vectors

#### Vector 1: Max Output Token Exhaustion (`finish_reason: "length"`)
- **Mechanism**: Models have hard generation limits (typically 4,096 or 8,192 output tokens). When an agent generates 3,500+ tokens of internal chain-of-thought reasoning before emitting a large tool call with extensive arguments (e.g. `bd update ... --design "...long text..."`), the model runs out of output tokens in the middle of writing the tool call arguments JSON.
- **Symptom**: Upstream emits `finish_reason: "length"` with an incomplete JSON string (e.g. `{"command": "bd update ... --design \"AUDIT`).
- **OpenCode Behavior**: The JSON parser fails to deserialize the tool arguments, leaving the turn partially executed or aborted.
- **Verification**: Query `opencode.db`:
  ```bash
  uv run python -c 'import sqlite3, json; conn=sqlite3.connect("/home/yapilwsl/.local/share/opencode2/opencode/opencode.db"); print([json.loads(r[0]).get("rawFinish") for r in conn.cursor().execute("SELECT data FROM session_message ORDER BY time_created DESC LIMIT 3").fetchall()])'
  ```

#### Vector 2: OpenCode Shell Subprocess Quoting & Escape Deadlocks
- **Mechanism**: When composite bash commands contain multi-line strings, unescaped double quotes, or embedded `$()` expansions, the underlying Node child process (`child_process.spawn`) spawned by OpenCode can get trapped in a secondary bash prompt (`> ` secondary prompt) waiting for an unclosed quote or EOF.
- **Symptom**: OpenCode's TUI displays the spinner for the tool execution indefinitely.
- **Verification**: Check if a child bash process is actively alive and blocked on stdin:
  ```bash
  ps aux | grep -E "bash|opencode" | grep -v grep
  cat /home/yapilwsl/.local/share/opencode2/opencode/shell/*/*.out | tail -20
  ```

#### Vector 3: OpenCode Internal Security / Approval Gate
- **Mechanism**: OpenCode has internal pattern-matching security heuristics. Commands that write to system paths, execute destructive git commands, or run non-allowlisted binaries may trigger an interactive confirmation prompt.
- **Symptom**: If the TUI output is scrolled down, the confirmation prompt is off-screen, and the interface appears hung until Enter or a keypress is sent.
- **Mitigation**: Ensure OpenCode is launched with the `--auto` flag or that necessary tool permissions are declared in `.opencode/opencode.json`.

#### Vector 4: Edge Proxy HTTP/2 Session Resets
- **Mechanism**: OpenRouter and OpenAI operate behind Cloudflare / Envoy edge load balancers. If a client stream exhibits TCP receive buffer starvation or silent half-closes, Cloudflare terminates the H2 stream without emitting a clean `GOAWAY` frame.
- **Mitigation in LiteRouter**: LiteRouter incorporates fallback to HTTP/1.1 keep-alive (`protocol: "HTTP/1.1"`) upon H2 negotiation dropouts, and emits periodic `: keep-alive\n\n` comments every 15 seconds to prevent edge firewall idle disconnects.

#### Vector 5: SQLite Database Contention (`SQLITE_BUSY`)
- **Mechanism**: OpenCode writes message history, project directory snapshots (`git write-tree`), and telemetry into `opencode.db` on every turn. Under rapid subagent executions or concurrent session reads, SQLite can lock if WAL mode is disabled.
- **Verification**:
  ```bash
  sqlite3 /home/yapilwsl/.local/share/opencode2/opencode/opencode.db "PRAGMA journal_mode;"
  # Expected output: wal
  ```

