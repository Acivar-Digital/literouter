# LiteRouter Technical Architecture

This document serves as the technical blueprint for LiteRouter, detailing the system design, architectural constraints, and key implementation decisions.

## Known Design Decisions (DO NOT REVERSE)

### Tier 1 DM Strength Formula: Flat 0.3 Hidden Stems
The pedagogical Tier 1 formula in `module2_root.py:calculate_dm_strength_tier1()` uses
a flat 0.3 for ALL hidden stems regardless of internal weight proportion. This is
INTENTIONAL - the book uses a simplified model. The production formula
`get_root_sub_score()` uses proper `weight x pillar_weight` proportional weighting.
BUG 4 in the Chapter 12 audit was reviewed and SKIPPED for this reason.

### Clash Hidden Stem Extraction: Uniform hidden_ratio
`calculate_clash_adjusted_dm_score()` (module2_root.py:462-470) applies `hidden_ratio=1.0`
to ALL hidden stems in a clashed branch (not just DM-element stems). The book's Case 12.1
is inconsistent on this point. The code's uniform treatment is architecturally cleaner
and follows Chapter 02 Rule 2.1 literally. Audited and confirmed in BUGS_CHAP12_AUDIT.md.

### Output Drain in Clash-Adjusted Formula
`calculate_clash_adjusted_dm_score()` includes `- (output_dm x 1.0)` even though the
book's Case 12.1 doesn't show it. Preserved as a safety net - when a clashed branch
releases strong output elements, draining the DM is a real effect. See s10.2 in audit.

### True Rolling Window Rate Limiting (Atomic)
The `ModelFirstRouter` class in `src/index.ts` implements a professional-grade rolling 60-second window for RPM and TPM tracking using Redis Sorted Sets (ZSETs) and an atomic Lua script.
- **Mechanism**: Every request is recorded as a timestamped member in a ZSET.
- **Atomicity**: The quota check and recording are performed in a single Redis Lua script to prevent race conditions (boundary bursting) and ensure strict adherence to provider limits.
- **Verification**: The router purges events older than 60s and sums the remaining members to verify quota.
- **Why**: Matches professional upstream provider behavior and prevents API key bans caused by request spikes at the edge of fixed-minute buckets.

### Gemma Payload Sanitization
To prevent upstream engine crashes, all requests targeting Gemma models must be sanitized.
- **Requirement**: The properties `thinkingConfig` and `thinking_config` must be recursively stripped from the payload.
- **Enforcement**: This is handled in `src/index.ts` (payload sanitization) and is applied to both the Native Google route and the OpenAI compatibility route.

## Code Style & Conventions
- Python 3.14+ required (see pyproject.toml)
- Use `lunar-python` for all Bazi calculations - never implement Pillar/strength logic manually
- All Bazi data is in `src/engine/bazi_data.py` as deterministic lookup tables
- Classical citations must use `BaziRAG` with technical Chinese keywords only
- No LLM inference for Bazi math - only for narrative generation
- **Zero-Speculation**: Before suggesting architectural changes, consult `_docs/PM/GRAVEYARD.md` to avoid proposing rejected "shit" ideas (e.g., Medallion, DST, LLM-Math).

## Key Architecture
- `src/engine/` - Pure Python deterministic Bazi engine (modules 0-5, 8-12)
- `src/bot/` - Telegram bot, intake, validation, orchestration
- `src/config/intake_schema.json` - Defines auto vs manual intake modes
- `src/bot/conductor.py` - LLM-driven conversational intake (3 states: CHOOSING, COLLECTING, CONFIRM)
- `src/index.ts` - LLM API calls / upstream proxying for all providers (OpenRouter, Nvidia, Anthropic, Google)
- `_docs/IMPACT_MAP.md` - **Change Impact Map**: Internal module dependency graph organized by blast radius. **Always consult before making architectural changes.**

## LiteRouter Proxy Guidelines

**High-Level Purpose**: LiteRouter is a high-performance proxy that distributes requests across multiple API keys using round-robin routing with automatic cooldown, quarantine, and rate limiting. It translates upstream calls for providers like OpenRouter, Nvidia, and Anthropic.

### 🚨 MANDATORY SKILL 🚨
**For ANY LiteRouter work, load the playbook first:**
`view_file` on `.opencode/skills/literouter-playbook/SKILL.md`

Then read the relevant appendix:
- **[`setup.md`](.opencode/skills/literouter-playbook/setup.md)** — Ops, routing, adding models/keys/providers
- **[`troubleshoot.md`](.opencode/skills/literouter-playbook/troubleshoot.md)** — `ZodValidationError`, JSON Parse errors, and rotating proxy debugging

### ⚠️ THE MANDATORY SDK REQUIREMENT: `@ai-sdk/openai-compatible` ⚠️

**DO NOT use `@ai-sdk/openai` in OpenCode config (`opencode.json`) for LiteRouter endpoints. You MUST use `@ai-sdk/openai-compatible` instead.**

#### Why? (The Protocol Mismatch Root Cause)
1. **The Endpoint Mismatch**: `@ai-sdk/openai` uses the modern `/v1/responses` (Agentic Communication Protocol / ACP) endpoint by default. However, upstream providers like OpenRouter and Nvidia only accept standard OpenAI ChatCompletions (`/v1/chat/completions`).
2. **Fragile Protocol Translation (Removed):** LiteRouter previously included an endpoint mapping layer to translate `/v1/responses` ↔ `/v1/chat/completions`. This layer was extremely fragile and prone to:
   - **Tool Call Failures**: Upstream models emitting `finish_reason: "tool_calls"` had their structured tool outputs dropped or malformed by the ACP translator, leading to client-side `ZodValidationError` errors.
   - **Stream Corruption**: Attempting to inject missing ACP structures/tokens into the SSE stream often broke the `\n\n` event delimiters, resulting in consecutive events fusing and throwing JSON Parse errors.
   **Consequently, this translation layer has been REMOVED. LiteRouter now acts as a pure rotating proxy for standard OpenAI endpoints.**
3. **The Simple Solution**: By switching the provider npm package in `opencode.json` to `@ai-sdk/openai-compatible`, the client communicates natively via standard `/v1/chat/completions`. LiteRouter then behaves as a pure rotating proxy (only swapping authorization headers and forwarding bytes), completely bypassing the fragile protocol translation code.

### Core Architecture & File Map
- `src/index.ts` - **The Core Engine** (single Bun process, port 7766): Handles `/v1/chat/completions` (OpenAI compatible) and native Google REST routes (`/v1beta/...`), implements reasoning normalization, payload sanitization, fusion, and key rotation.
- `src/index.ts` - **Provider Discovery**: Scans env vars ending with `_BASE_URL` to build the provider table. No hardcoded routing here — providers are purely data-driven from `.env`.
- `src/index.ts` (`ModelFirstRouter`) - **Key Rotation**: Uses Redis/Valkey ZSET+Lua to atomically cycle through available API keys per provider. Redis/Valkey is REQUIRED — the gateway exits(1) on a connection error (no in-memory fallback).
- `logs/literouter.log` & `logs/literouter_logs.db` - **The Truth**: The primary locations to check for stack traces, Zod validation errors, and raw incoming/outgoing request bodies. (Local logs under `logs/` are ignored in Git to prevent leaks.)
- `models.json` - **Model Registry**: Central mapping of system IDs to providers and upstream model IDs.

### Operations & Testing
- Run LiteRouter locally: `bash scripts/start.sh` (daemonizes in tmux) or `bun run src/index.ts` (foreground).
- Redis/Valkey is REQUIRED — the gateway exits(1) on a connection error (no in-memory fallback).
- **Mandatory E2E Test Protocol**: All testing must follow the "right-way" testing protocol detailed in `tests/right-way-test.md`. You must read `tests/right-way-test.md` and verify the live running daemon process using actual client requests before asserting complete status.
- **Code Change Test Protocol (`right-way-test`)**:
  1. Check all API keys are healthy for rotation.
  2. Run a Python script to perform a curl test. Send "hi" to the model $N + 1$ times (where $N$ is the number of keys; e.g., if there are 5 keys, say "hi" 6 times) and log down if key rotation occurred.
  3. Check logs to verify that the keys were indeed rotated.
  4. Insert the configuration into OpenCode if necessary.
  5. Otherwise, test the OpenCode CLI model using the setup in step 2 but via OpenCode directly.
  6. Verify the logs again to ensure rotation happened.
  7. Consider the test passed only when all steps pass successfully.

### Model Naming Quick Reference

The first segment of the model ID (before `/`) IS the provider name. No keyword overrides, no catch-all.

| OpenCode model key | Routes to | Sent upstream as |
|---|---|---|
| `openrouter/owl-alpha` | OpenRouter | `owl-alpha` |
| `openrouter/openai/gpt-oss-120b:free` | OpenRouter | `openai/gpt-oss-120b:free` |
| `openrouter/cohere/north-mini-code:free` | OpenRouter | `cohere/north-mini-code:free` |
| `nvidia/deepseek-ai/deepseek-v4-flash` | Nvidia | `deepseek-ai/deepseek-v4-flash` |

To remove a model: delete from `opencode.json` and `models.json`.

### Valkey Database Backend
- **No Redis Dependency**: LiteRouter does NOT run a Redis database server. We use **Valkey** (the fully open-source key-value database engine) on port `6379`.
- **Client Library Driver**: The codebase uses the standard Python `redis` package for API and protocol compatibility with third-party libraries (e.g. `redisvl`).
- **Environment Variables**: We use standard Redis-compatible environment variable keys (`REDIS_HOST`, `REDIS_PASSWORD`, etc.) to configure connection endpoints to Valkey.
- **Scanner Warnings**: Any code hygiene alerts flagging environment drift or missing packages for "Redis" are false positives. Valkey and Redis are used interchangeably here.

## Critical Patterns
- Auto mode collects only: alias, gender, dob, location -> engine computes all pillars/strength
- Never ask for computed fields: year_pillar, month_pillar, day_pillar, hour_pillar, da_yun_pillar, etc.
- Natal Sacrosanctity: full 4-pillar birth data injected into every Chronomancer prompt
- 3-Pillar Robustness: The engine supports profiles without birth hours (3 pillars); do not treat missing hours as a critical failure.
- Deterministic math only - fix `src/engine/` if calculations are wrong, never the LLM prompts

## BaziRAG Usage

BaziRAG MCP provides classical text retrieval from four Chinese sources:
- Yuan Hai Zi Ping
- San Ming Tong Hui
- Di Tian Sui
- Qiong Tong Bao Jian

**Usage**: The `query_classical_text_async` tool performs semantic search over these classical texts for grounding and verification.

**Keywords**: Always use technical Chinese terminology (e.g., cai xing, guan sha, yang ren, shi shang, zheng yin, pian cai, etc.)
English search terms will fail - always translate concepts to Chinese technical terms first.

**Best practices**:
- Use `rerank` with original query if results are too broad
- BaziRAG failures raise RuntimeError (no silent degradation, per our guiding principles)
- Validate returned citations against query context
- RAG cache (`rag_cache/`) available as fallback if BaziRAG is unavailable

## Ironclad Stability (V31-T10)
- **Zero-Fault Pipeline**: Content is sanitized (\xa0, CRLF normalization) *before* AST validation to ensure resilience against dirty input.
- **Windows Concurrency Retry**: If you encounter `PermissionError` (Access Denied) on Windows, the server now automatically retries the write 5 times.
- **Transactional Atomicity**: `move_symbol` now uses a "Two-Phase Commit" pattern. If the destination write fails, the source file is automatically restored from memory.
- **Verification**: After making structural changes to the MCP server itself, always run `uv run python codebase/test_codebase_mcp.py` to verify the 100% stability score.
- **Physical Dependency Map**: `build_repo_graph` now resolves imports to physical `.py` files, preventing the discovery of "ghost" modules.
- **Zero-Speculation Edits**: Never "clean up" adjacent code while performing a surgical edit. Maintain absolute functional parsimony.
