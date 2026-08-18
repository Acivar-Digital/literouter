---
name: literouter-playbook
description: LiteRouter API Gateway operational guide for Bun/TypeScript proxy on port 7766. Use when the user asks about LiteRouter, gateway ops, directive keys, provider/model config, routing, fusion presets, Claude Code integration, OpenCode2 integration, Antigravity proxy, setup, or troubleshooting the literouter gateway.
---

# Skill: literouter-playbook

> **Lazy-load skill.** This SKILL.md is the entry point only. When the user's request matches the skill description, load this file first. For deep dives into specific topics, read the referenced markdown files in this directory.

## Quick Reference

| Action | Command |
|---|---|
| Start gateway | `bash scripts/start.sh` |
| Check status | `bash scripts/status.sh` |
| Stop gateway | `bash scripts/stop.sh` |
| Restart gateway | `bash scripts/restart.sh` |
| Health probe | `curl -sk https://localhost:7766/health` |
| Hard key reset | `curl -sk -X POST https://localhost:7766/reset` |
| Unit tests | `bun test` |
| Diagnostics | `bun run scripts/doctor.ts` (JSON schema + live upstream key probes for Google, NVIDIA, OpenRouter, Zen) |
| Typecheck & lint | `bun x tsc --noEmit && uv run ruff check .` |

## ⛔ Critical: Zero Key Redaction

**NEVER** edit, sanitize, replace, or overwrite API keys in `.env.local` or `.env`. Never substitute real keys with `<REDACTED>`, `changeme`, or placeholders — this causes `staticValidateKeys` to discard key pools on boot, breaking gateway routing. `.env.local` is write-protected via `protect.sh` (owned by root, mode `644`).

## Environment Architecture

- **`.env.local`** (git-ignored secrets): live upstream API key pools (`OPENROUTER_API_KEYS`, `NVIDIA_API_KEYS`, `ZEN_API_KEYS`, `GOOGLE_API_KEYS`)
- **`.env`** (tracked): operational parameters (port, timeouts, TTFT guards, reasoning defaults)

## Directive Key Format

All direct directive keys follow the strict 5-part lowercase format:
```
lr-<provider>-<payload>-<completions>-<nuances>
```

| Segment | Codes |
|---|---|
| Provider | `or` (OpenRouter), `nv` (NVIDIA), `gg` (Google), `zn` (Zen), `oa` (OpenAI), `an` (Anthropic), `gq` (Groq), `cb` (Cerebras), `ds` (DeepSeek), `ms` (Mistral), `tg` (Together) |
| Payload (wire) | `oa` (OpenAI), `cl` (Claude/Anthropic), `gg` (Google), `rs` (Responses) |
| Completion (endpoint) | `ch` (Chat `/v1/chat/completions`), `ms` (Messages `/v1/messages`), `ob` (OpenAI Beta), `gc` (GenerateContent), `em` (Embeddings), `md` (Models discovery) |
| Nuances | `no`, `dp`, `ts`, `sb`, `gm`, `g3`, `tc` (compound with `+`, e.g. `dp+ts`) |

> ⚠️ **WARNING**: When using Claude wire format (`cl`), you MUST use the Messages endpoint (`ms`). Using `cl` with Chat Completions (`ch`) triggers incomplete cross-wire translation that drops all `tool_use`/`tool_result` blocks, causing Claude Code to hang indefinitely.

Fusion presets: `lr-fse-<preset>` (e.g. `lr-fse-fast`, `lr-fse-smart`, `lr-fse-code`, `lr-fse-cheap`).

## Topic Map — Read These Files for Details

| Topic | File | When to read it |
|---|---|---|
| **Claude Code integration** | `claude-code.md` | User asks about Claude Code, Anthropic Messages API, `ANTHROPIC_BASE_URL`, or routing Claude Code through LiteRouter |
| **OpenCode2 integration** | `opencode2-playbook.md` | User asks about OpenCode2, V2 plugins, `~/.config/opencode2/`, or V1/V2 isolation |
| **Antigravity proxy** | `antigravity.md` | User asks about remote Antigravity services (`agy-gemini`, `agy-claude`), ZeroTier nodes, or Google Native RPC |
| **Setup & configuration** | `setup.md` | User asks about installing, configuring, env vars, providers.json, models.json, fusion.json, or TLS certs |
| **Setup checklist** | `setup_checklist.md` | Pre-flight verification of gateway health, key pools, and config integrity |
| **Troubleshooting** | `troubleshoot.md` | User reports an error, gateway behaving unexpectedly, or needs diagnostic procedures |
| **Antigravity IDE setup** | `agy-ide-setup.md` | User asks about installing/configuring/maintaining Google Antigravity IDE in WSL2 |

## Gateway Resilience

1. **In-Flight Error Classification & Key Rotation (`classifyUpstreamError`)**: Automatically classifies upstream HTTP errors. Retries in-flight up to 3 times across active keys for transient 400 provider errors (0s cooldown), rate limits (dynamic cooldown), exhausted quotas (7d cooldown), 401/403 bad keys (7d cooldown), and 5xx server errors (10s cooldown).
2. **Network & Transport Layer Resilience**: Wraps pre-stream socket failures, TCP resets (TCP RST / `ECONNRESET`), HTTP/2 GOAWAY (`RemoteProtocolError`), and network connection timeouts (`ConnectTimeout` / `ConnectError`) into `NoResponseError`, retrying across pooled keys in-flight (up to 3 attempts) before failing.
3. **Deterministic Fail-Fast**: Immediately aborts retries without burning other keys on deterministic client errors (HTTP 400 context length exceeded, schema/validation errors, safety filters, HTTP 404).
4. **TTFT Guard** (5s): aborts upstream if no verifiable content token arrives, rotates to next key with zero cooldown penalty.
5. **Stream Idle Guard** (30s) & **Bun Idle Timeout** (60s): protects against mid-stream stalls while giving slow/reasoning models sufficient inter-chunk leeway.
6. **SSE Keepalive** (2s/15s): injects comment frames (`: keep-alive\n\n`) to keep client connections active during thinking and long processing pauses.
7. **Ghost Response Guard**: rejects HTTP 200 responses with 0 content tokens.
8. **Client Cache Sanitizer**: strips `prompt_cache_key`/`prompt_cache_retrieval`/`prompt_cache_reset` before upstream dispatch.
9. **Mid-Stream Error Interceptor & Auto-Resend**: Detects and suppresses mid-stream in-band 5xx error chunks (`Server error mid-response. The response above may be incomplete.`) and socket drops, isolates the failing key (10s), and automatically resends across available keys into the open downstream client stream.