# Claude Code + LiteRouter Configuration Guide (v3.1 / v3.2)

How Claude Code is configured to route through LiteRouter on this machine.

---

## 1. What Claude Code Needs

Claude Code is an Anthropic-native client. It speaks the **Anthropic Messages API** (`/v1/messages`) and expects:
- `ANTHROPIC_BASE_URL` → pointing at LiteRouter
- `ANTHROPIC_API_KEY` → a LiteRouter **directive key** (not a real Anthropic key)

LiteRouter's `/v1/messages` endpoint is a full Anthropic Messages compatibility layer. It accepts native Anthropic payloads, translates them as needed, rotates real upstream keys from `.env.local`, and returns native Anthropic responses.

---

## 2. Current State on This Machine

| Setting | Value | Source |
|---|---|---|
| Claude Code version | `2.1.233` | `~/.local/bin/claude` |
| `ANTHROPIC_BASE_URL` | `https://localhost:7766` | `~/.claude/settings.json` |
| `ANTHROPIC_API_KEY` | `lr-or-cl-ms-no` | `~/.claude/settings.json` |
| Anthropic direct keys | **Commented out** in `.env.local` | `# ANTHROPIC_API_KEYS=...` |
| Repo hook | `.claude/settings.json` → `SessionStart` → `bd prime --hook-json` | present |
| MCP servers | 5 configured (workspace-docs, BGEM3, BaziRAG, workspace-sandbox, workspace-codebase) | `~/.claude/backups/.claude.json` |

**Verdict: Claude Code IS routing through LiteRouter.** All env vars are in `~/.claude/settings.json` — Claude Code reads them automatically on startup. No shell config needed.

### 2a. Full `~/.claude/settings.json`

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://localhost:7766",
    "ANTHROPIC_API_KEY": "lr-or-cl-ms-no",
    "ANTHROPIC_MODEL": "dots-studio/dots-3-note-preview:free",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "dots-studio/dots-3-note-preview:free",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "dots-studio/dots-3-note-preview:free",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "dots-studio/dots-3-note-preview:free",
    "CLAUDE_CODE_SUBAGENT_MODEL": "dots-studio/dots-3-note-preview:free",
    "CLAUDE_CODE_EFFORT_LEVEL": "max",
    "CLAUDE_CODE_ALWAYS_ENABLE_EFFORT": "1",
    "NODE_TLS_REJECT_UNAUTHORIZED": "0"
  }
}
```

### 2b. Model & Effort Settings

Claude Code supports these env vars (all set in `~/.claude/settings.json`):

| Variable | Value | Purpose |
|---|---|---|
| `ANTHROPIC_MODEL` | `dots-studio/dots-3-note-preview:free` | Default model for sessions. Takes precedence over `/model` and `--model`. |
| `CLAUDE_CODE_EFFORT_LEVEL` | `max` | Effort level. Values: `low`, `medium`, `high`, `xhigh`, `max`. `max` is the highest. |
| `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT` | `1` | **Required when routing through a gateway.** Claude Code won't send effort params for model IDs it doesn't recognize (like `dots-studio/...`). This forces effort params through anyway. |

> **Why `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1` is needed:** When Claude Code talks to LiteRouter, the model ID `dots-studio/dots-3-note-preview:free` isn't a real Anthropic model — Claude Code doesn't recognize it as effort-capable and would normally omit effort params. This env var tells it to send them anyway.

### 2c. Effort Levels (lowest → highest)

| Level | What it means |
|---|---|
| `low` | Minimal reasoning, fastest |
| `medium` | Default — balanced |
| `high` | Deeper reasoning |
| `xhigh` | Very deep reasoning |
| `max` | **Maximum reasoning effort** — longest thinking, most thorough |

OpenRouter's `dots-studio/dots-3-note-preview:free` supports `reasoning.effort` with values `max`, `xhigh`, `high`, `medium`, `low`, `minimal`, `none`. So `max` is fully supported by the upstream model.

---

## 3. How to Start Claude Code

### Quick Start

```bash
claude
```

That's it. Claude Code is installed at `~/.local/bin/claude` (v2.1.233). All env vars are in `~/.claude/settings.json` — Claude Code reads them automatically on startup. No shell config needed.

### Per-Session Overrides

| Flag | Example |
|---|---|
| `--model` | `claude --model dots-studio/dots-3-note-preview:free` |
| `--effort` | `claude --effort max` (values: `low`, `medium`, `high`, `xhigh`, `max`) |

These override the settings.json env vars for that session only.

### Verify It's Working

Before starting a session, confirm the gateway is healthy and the directive works:

```bash
# 1. Gateway health
curl -sk https://localhost:7766/health

# 2. Test the directive with a direct API call
curl -sk -X POST https://localhost:7766/v1/messages \
  -H "x-api-key: lr-or-cl-ms-no" \
  -H "Content-Type: application/json" \
  -d '{"model":"dots-studio/dots-3-note-preview:free","max_tokens":20,"messages":[{"role":"user","content":"say hi"}]}'

# 3. Unfreeze keys if all are 429
curl -sk -X POST https://localhost:7766/reset
```

---

## 4. Directive Key Reference

Claude Code uses the Anthropic Messages wire format, so the directive must use payload `cl` (Claude wire) and completion `ms` (Messages endpoint).

| Directive | Provider | Wire | Endpoint | Use Case |
|---|---|---|---|---|
| `lr-or-cl-ms-no` | OpenRouter (`or`) | Claude (`cl`) | Messages (`ms`) | **Default** — routes Claude Code through OpenRouter's catalog |
| `lr-or-cl-ms-dp` | OpenRouter (`or`) | Claude (`cl`) | Messages (`ms`) | Dots models with native Anthropic passthrough + dot prompt XML tool calling |
| `lr-or-cl-ms-ts` | OpenRouter (`or`) | Claude (`cl`) | Messages (`ms`) | Thought signatures preserved — thinking box renders in Claude Code UI |
| `lr-or-cl-ms-no+dp` | OpenRouter (`or`) | Claude (`cl`) | Messages (`ms`) | Native + Dots nuance combined |

### ⚠️ Critical: Never use `lr-or-cl-ch-no`

Using payload `cl` (Claude wire) with completion `ch` (Chat Completions) triggers an **incomplete cross-wire translation** in `src/handlers/anthropic_compat.ts` (`translateAnthropicToOpenAI`). This drops all `tool_use` and `tool_result` blocks, causing Claude Code to hang indefinitely.

**Rule: `cl` (Claude wire) → MUST use `ms` (Messages endpoint). `ch` (Chat Completions) → MUST use `oa` (OpenAI wire).**

---

## 5. How the Routing Works

```
Claude Code
  │  POST /v1/messages  (native Anthropic payload)
  │  x-api-key: lr-or-cl-ms-no
  ▼
LiteRouter :7766
  │  1. Extracts directive → provider=or, payload=cl, completion=ms
  │  2. Rotates a live OPENROUTER_API_KEYS key from .env.local
  │  3. Forwards to https://openrouter.ai/api/v1/messages
  │     (native Anthropic payload, x-api-key: <rotated key>)
  ▼
OpenRouter → upstream model (e.g. dots-studio/dots-3-note-preview:free)
```

Key implementation detail (`src/handlers/anthropic_compat.ts:489`): when `completion === "ms"`, LiteRouter forwards the Anthropic payload **directly** with zero lossy format conversion. Tool schemas (`{ name, description, input_schema }`) are preserved natively.

---

## 6. Model Discovery

When Claude Code boots, it queries `GET /v1/models` to discover available models. With `lr-or-cl-ms-no`, LiteRouter returns the full OpenRouter catalog in OpenAI format. Claude Code will pick from models like:

- `anthropic/claude-3.7-sonnet`
- `claude-3-7-sonnet-20250219`
- `dots-studio/dots-3-note-preview:free`
- `deepseek/deepseek-r1`
- plus all Gemini, Mistral, Qwen, etc.

Claude Code typically defaults to a `claude-*` model. To force a specific model, set it in `~/.claude.json` or via the `--model` CLI flag.

---

## 7. Anthropic Direct (Optional)

If you have real Anthropic API keys, you can use the Anthropic direct provider instead of OpenRouter:

```env
# In .env.local (uncomment):
ANTHROPIC_API_KEYS=sk-ant-key1,sk-ant-key2
```

Then use directive `lr-an-cl-ms-no` (provider=`an`, Anthropic direct). This bypasses OpenRouter and talks to `https://api.anthropic.com` directly with rotated keys.

**Currently NOT configured** — the Anthropic keys are commented out in `.env.local`.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Claude Code hits `api.anthropic.com` directly | `ANTHROPIC_BASE_URL` missing from `~/.claude/settings.json` | Add it to the `env` block in `~/.claude/settings.json` |
| `401 Invalid API key` | Wrong directive format | Must be `lr-*-cl-ms-*` for Claude Code |
| `400 No endpoints found for <model>` | Model not in OpenRouter catalog | Check model ID spelling, or use a different directive |
| Claude Code hangs mid-request | Used `lr-*-cl-ch-*` (wrong endpoint) | Switch to `lr-*-cl-ms-*` |
| Claude Code hangs / connection refused | `ANTHROPIC_BASE_URL` uses `http://` but gateway is HTTPS-only | Change to `https://localhost:7766` in `~/.claude/settings.json` |
| All keys 429 | OpenRouter rate limit pool exhausted | `curl -sk -X POST https://localhost:7766/reset` |
| Thinking box not rendering | Missing `ts` nuance | Use `lr-or-cl-ms-ts` |
| No thinking tokens at all | `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT` not set | Claude Code won't send effort params for unrecognized model IDs. Set `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1` in `~/.claude/settings.json`. |
| Effort level stuck at "medium" | `CLAUDE_CODE_EFFORT_LEVEL` not set, or `--effort` not passed | Set `CLAUDE_CODE_EFFORT_LEVEL=max` in `~/.claude/settings.json`, or run `claude --effort max` |
| Claude Code ignores `ANTHROPIC_MODEL` | Env var missing from `~/.claude/settings.json` | Add `ANTHROPIC_MODEL` to the `env` block in `~/.claude/settings.json` |
| Claude Code can't find `claude` command | `~/.local/bin` not in PATH | Add to `~/.bashrc`: `export PATH="$HOME/.local/bin:$PATH"` |
| `Decompression error: ZlibError` | Bun native fetch zlib parser issue on chunked gzip SSE | LiteRouter enforces `Accept-Encoding: identity` upstream and sanitizes downstream headers (`sanitizeDownstreamHeaders`). Ensure gateway is updated to latest. |

---

## 9. Bun Zlib Decompression & Transport Layer Immunity

Claude Code's binary is compiled via `bun compile`. Bun's native `fetch()` automatically attaches `Accept-Encoding: gzip, deflate, br`. When upstream edge proxies return empty chunked gzip flushes in SSE streams, Bun's internal zlib engine throws `Decompression error: ZlibError` to stderr.

LiteRouter eliminates this natively:
1. **Upstream Request Control:** Injects `Accept-Encoding: identity` on outbound fetches to OpenRouter/Anthropic/NVIDIA/Google, guaranteeing uncompressed SSE streams.
2. **Downstream Response Sanitizer:** `sanitizeDownstreamHeaders()` strips compression (`content-encoding`, `transfer-encoding`) and hop-by-hop headers before returning responses to Claude Code over localhost.

---

## 10. Multilingual Guardrails & Chinese-Native Models (Dots / Qwen / DeepSeek)

Chinese-native foundation models (such as Dots, Qwen, or DeepSeek) have pre-training weights and tokenizers optimized for Chinese text. In Claude Code, this can cause internal Chain-of-Thought (CoT) reasoning, tool call arguments, or explanations to leak Chinese tokens.

To resolve this deterministically without breaking domain-specific Chinese metaphysics requirements in projects like `baziforecaster`:

### Layered Architecture:
1. **Global Client Baseline (`~/.claude/CLAUDE.md`)**:
   - Pins all internal thoughts, tool calling arguments, comments, commit messages, and explanations to **English**.
   - Strictly restricts Chinese characters to domain entity values (e.g. BaZi Stems/Branches/Ten Gods, localization fixtures, or test cases).
2. **Project Domain Policy (`baziforecaster/AGENTS.md`)**:
   - Explicitly whitelists Heavenly Stems, Earthly Branches, Ten Gods, Hexagrams/Trigrams, and Solar Terms for calculations and data ASTs.
   - Maintains English for all logs, docstrings, commit messages, and explanations.
3. **Verification Harness (`tests/unit/language_guardrail.test.ts`)**:
   - Programmatically asserts zero Chinese character leakage on generic coding logic while ensuring 100% preservation of Chinese metaphysics data models.
