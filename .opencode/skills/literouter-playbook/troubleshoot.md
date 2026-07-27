# LiteRouter Troubleshooting Guide

This guide helps diagnose and resolve issues with the LiteRouter gateway.

## 1. Primary Logs (The Source of Truth)
All runtime logs stream to the **literouter** tmux session. Attach with `tmux attach -t literouter`.
- The Bun process logs model registrations, key rotation events, upstream errors, and backoff warnings to stdout.
- For persistent logs, check `logs/flush.log` (Valkey flush history).
- **For file-based request/response logging:** Logs are NOT persisted by default. Run `bun run src/index.ts 2>&1 | tee -a logs/gateway.log` to capture gateway output, or modify `scripts/start.sh` to pipe stdout to `logs/gateway.log`.

## 2. Common Error Patterns

### 401 Unauthorized
- **Cause:** The `LITEROUTER_AUTH_KEY` provided in the request header (`Authorization: Bearer ...`) or query param (`?key=...`) does not match the `.env` configuration.
- **Fix:** Verify the auth key in `.env` and the client request.

### 429 Too Many Requests
- **Cause 1:** Provider's quota (TPM/RPM) exhausted for all keys in rotation pool.
- **Cause 2:** All keys are in cooldown after recent errors. Top-level requests backoff **65s → 90s → 120s**. Fusion chain requests return 429 immediately (chain falls to next model).
- **Fix:** Add more API keys to `.env`, increase `LITEROUTER_MAX_ATTEMPTS`, or check rate limits in `ts-src/src/index.ts`. Use Redis to inspect cooldown state (see section 3).
- **Note:** Only `LITEROUTER_MAX_ATTEMPTS` (default 3) keys get burned per request. The rest stay fresh.

### 502 Bad Gateway
- **Cause:** The upstream provider returned a failure or the connection timed out (after all keys exhausted and all 3 backoff rounds exhausted).
- **Fix:** Check `tmux attach -t literouter` to see which specific key failed. If a key is consistently failing with 401/403, it may have been quarantined. Run `redis-cli KEYS 'cooldown:*'` to see all keys in cooldown.

### ZodValidationError / JSON Parse Errors
- **Cause:** Mismatch between the expected ACP protocol and the standard OpenAI format.
- **Fix:** Ensure the client is using `@ai-sdk/openai-compatible` to avoid the fragile ACP translation layer.

### Gemma Engine Crashes / 400 Bad Request
- **Cause:** Sending `thinkingConfig` or `thinking_config` in the request payload to a Gemma model. Google's engine crashes on these fields.
- **Fix:** The gateway automatically strips these fields when `upstream_model` contains "gemma". If you see 400s, attach to tmux and check for "thinkingConfig" references in the response body.

### Antigravity Agent (`antigravity-preview-05-2026`) / "Cannot text generation" / HTTP 400
- **Cause:** `antigravity-preview-05-2026` is an **Agent execution engine** (sandboxed Linux environment with terminal & tools), NOT a standard text-generation language model. Calling it via `:generateContent`, standard text endpoints, or OpenAI-compat `/v1/chat/completions` triggers an error ("Cannot [do] text generation" / HTTP 400).
- **Fix:** Standard models (like `gemini-3.5-flash` or `gemini-3.6-flash`) use standard text endpoints (`:generateContent` or `/v1/chat/completions`). To call Antigravity programmatically, use Google's **Interactions API** (`/v1beta/interactions`):
  - **cURL / REST:** `POST https://generativelanguage.googleapis.com/v1beta/interactions` with headers `-H "x-goog-api-key: $GEMINI_API_KEY"` `-H "Content-Type: application/json"` and body `{"agent": "antigravity-preview-05-2026", "input": "...", "environment": "remote"}`.
  - **Python SDK (`google-genai`):** Use `client.interactions.create(agent="antigravity-preview-05-2026", input="...", environment="remote")`.

### Raw LaTeX in Response (e.g. `\rightarrow`, `\times`)
- **Cause:** Upstream model output contains raw LaTeX math symbols not normalized.
- **Fix:** The gateway applies `cleanLatexSymbols()` to all streaming and non-streaming responses. If raw LaTeX still shows, check if the transform function is running for your route.
- **Function:** `cleanLatexSymbols()` in `ts-src/src/index.ts:486`.

## 3. Key Rotation & Rate Limit Debugging

### Verification Process
1. Send $N+1$ requests (where $N$ is the number of keys for a provider).
2. Check the logs for the `keyHash` of the requests. If the hash changes, rotation is working.
3. To test fusion fallback: set `LITEROUTER_MAX_ATTEMPTS=1`, send a request, then check `X-Literouter-Model` header.

### Cooldown State Reference

| Redis Key Pattern | TTL | Means |
|-------------------|-----|-------|
| `cooldown:{provider}:{hash}:{model}` = `rate_limited` | **65s** | Key hit 429 — temporary backoff |
| `cooldown:{provider}:{hash}:{model}` = `timed_out` | **10s** | Connection timeout / 503 / 504 |
| `cooldown:{provider}:{hash}:{model}` = `quarantined` | **7 days** | 401/403 — key revoked, do not use |
| `cooldown:{provider}:{hash}:{model}` = `error_*` | **30s** | Catch-all error |

### ZSET Debugging Commands (Redis/Valkey)

```bash
# List all rolling windows
redis-cli KEYS 'rolling:*'

# Inspect a specific rolling window — shows all requests in last 60s
redis-cli ZRANGEBYSCORE rolling:nvidia:abc123:deepseek-ai/deepseek-v4-pro 0 +inf WITHSCORES

# Count members in a rolling window (current RPM)
redis-cli ZCARD rolling:nvidia:abc123:deepseek-ai/deepseek-v4-pro

# Delete a rolling window (force reset for testing)
redis-cli DEL rolling:nvidia:abc123:deepseek-ai/deepseek-v4-pro

# Check cooldown state of a key
redis-cli GET cooldown:nvidia:abc123:deepseek-ai/deepseek-v4-pro

# List all cooldowns
redis-cli KEYS 'cooldown:*'

# Check backoff state (no backoff key exists if request succeeded)
# Backoff is per-request / in-memory, not stored in Redis
```

### Backoff Logs

**Top-level request** (not in fusion chain):
```
[NVIDIA] All keys exhausted, backing off 65s (round 1/3)
[GOOGLE] All keys exhausted, backing off 90s (round 2/3)
```

**Fusion chain** (no backoff — falls through immediately):
```
[FUSION] pydantic/google -> google/gemma-4-31b-it failed (429), advancing chain.
[FUSION] pydantic/google -> google/gemini-3.1-flash-lite start
```

If you see repeated backoff cycles at top level, add more keys or increase `LITEROUTER_MAX_ATTEMPTS`.
