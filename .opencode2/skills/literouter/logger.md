# LiteRouter Terminal Telemetry & Logger Contract

> Source of truth: `src/ui/logger.ts` (388 lines). All handlers must log via this module — never `console.log` directly.
> Tests: `tests/unit/visual_telemetry.test.ts` (18 tests). Last contract change: 2026-09-07 (continuation-line timestamp fix).

## 1. Global line format (mandatory)

Every telemetry line is **column-0 aligned, single-line, self-timestamped**:

```
<EMOJI> [MM-DD-HH:mm:ss:ms] [TAG reqId] message
```

- Timestamp: `formatTimestamp()` (`logger.ts:9-17`) → `[09-07-09:51:38:681]`. Fresh `new Date()` per call — each line gets its own timestamp.
- Tag is always present: `[reqId]`, `[USAGE reqId]`, `[TTFT reqId]`, `[LIMIT reqId]`, `[PACER reqId]`, `[SERVED reqId]`, `[ROTATE reqId]`, `[RETRY reqId]`, `[EXHAUSTED reqId]`, `[FINISH reqId]`, `[FUSION reqId]`, `[ERROR reqId]`, `[AMBER reqId]`.
- **Anti-pattern (fixed 2026-09-07):** continuation lines with 4-space indent and no timestamp (`    🎯 Directive: ...`, `    🤖 Model: ...`, `    💬 Tokens: ...`, `    ⚠️ Parsed Retry-After ...`). If you see indented timeless lines in old terminal scrollback, that is the pre-fix format. New code emits each as a full `EMOJI + ts + [TAG reqId]` line (`logger.ts:116,133,189,268,271`).
- `console.log` = normal path, `console.warn` = limit/served-4xx/amber, `console.error` = exhausted/error.
- `logSeparator()` (`logger.ts:386`) prints the `───` rule after every `[SERVED]`.

## 2. Emoji map (`logger.ts:42-68`)

| Key | Emoji | Lines |
|---|---|---|
| `inbound` | 🔵 | inbound |
| `directive` | 🎯 | directive detail |
| `model` | 🤖 | model detail |
| `prep` | 📦 | request prep (call-site built, not in logger) |
| `upstream` | 🔌 | upstream dispatch (call-site) |
| `ttft` / `servedOk` | 🟢 | TTFT, served 2xx |
| `usage` | 🟣 | usage header |
| `tokens` | 💬 | tokens detail |
| `stats` | 📊 | stream-done bytes (call-site, `openai_original.ts`) |
| `pacer` | 🐢 | pacer dwell |
| `rotate` | 🔄 | key rotation |
| `retry` | 🟠 | retry attempt |
| `limit` / `servedErr` / `finishTrunc` | ⚠️ | limit, served 4xx/5xx, truncation |
| `exhausted` | 🔴 | pool exhausted |
| `amber` | 🟡 | amber warnings |
| `finish` | 🏁 | finish_reason |
| `boot` | 🚀 | boot |
| `error` | 💥 | errors |
| `fusion` | 🔗 | fusion preset |

Provider names (`logger.ts:19-33`): `or→OpenRouter`, `nv→NVIDIA NIM`, `gg→Google`, `zn→Zen`, `gc→GCP (Gemma)`, plus `oa/an/gq/cb/ds/ms/tg/tp`. Wire names (`logger.ts:35-40`): `oa→OpenAI`, `cl→Claude`, `gg→Google`, `rs→Responses`. Unknown codes fall back to uppercased code.

## 3. Per-function contract

### `logInbound(details: InboundLogDetails)` (`logger.ts:97-141`)
Emits 1–3 lines. Rich object form is the standard; string-legacy form (`logger.ts:138-140`) exists but handlers should use the object form.

```
🔵 [09-07-09:51:38:681] [req_demo] Inbound POST /v1/responses [HTTP/1.1] from opencode/beta
🎯 [09-07-09:51:38:681] [req_demo] Directive: lr-zn-oo-rs-no -> Target: Zen | Wire: Responses | EP: /v1/responses
🤖 [09-07-09:51:38:681] [req_demo] Model: muse-spark-1.3-contributor-free | Key: Zen [Key #5/7] | Ref: OpenCode/1.18.29
```

- Line 1: `🔵 ts [reqId] Inbound METHOD PATH [protocol] from clientAgent`. `protocol` optional (`[HTTP/1.1]`, `[HTTP/2]`).
- Line 2 (only if `directiveStr`): `🎯 ts [reqId] Directive: <key> -> Target: <Provider> | Wire: <Wire> | EP: <endpoint>`. Target/wire resolved via `getProviderDisplayName` / `getWireDisplayName`; missing target → `Direct`, missing wire → `OpenAI`.
- Line 3 (only if `model`): `🤖 ts [reqId] Model: <model> | Key: <Prov> [Key #i/n]` (when `keyIndex` set) or `| Pool: <Prov> (n keys)` (pool view) + `| Nuances: [...]` (only when nuances ≠ `["no"]`) + `| Ref: <UA>` — UA only, ` @ <URL>` stripped at display (`logger.ts:132` `split(\" @ \")[0]`).
- `referrer` sourcing: looked up from `config/providers.json` `headers` via `resolveUpstreamEndpoint` / `buildAuthHeaders` — never hardcoded in handlers.
- Emitters: every handler entry (`openai_compat.ts`, `anthropic_compat.ts`, `gcp_compat.ts`, `openai_original.ts`, `google_native.ts`).

### `logTtft(reqId, ttftMs, details?, protocol?)` (`logger.ts:143-152`)
```
🟢 [09-07-09:47:30:357] [TTFT req_e8ywp7h] TTFT = 2350ms | Stream established [Upstream: HTTP/1.1]
```
- `protocol` appends `[Upstream: HTTP/1.1|HTTP/2]`. This is the attempted-transport label from `fetcher.ts:565-599`, not a wire-ALPN proof.

### `logUsage(details: UsageLogDetails)` (`logger.ts:170-191`)
Emits 2 lines, same timestamp base:
```
🟣 [09-07-09:51:38:685] [USAGE req_demo] Zen (Key #1/7)
💬 [09-07-09:51:38:685] [USAGE req_demo] Tokens: Prompt=50,059 | Reasoning=339 | Completion=1,957 | Total=52,016 | Speed=67.5 tok/s
```
- Numbers via `formatTokenNumber` (en-US commas).
- Guards: `Speed=` only when `durationMs>0 && completionTokens>0`; `Reasoning=` segment only when `reasoningTokens>0`, else omitted.
- 8 call sites: `openai_compat.ts:461/493`, `anthropic_compat.ts:1138/1192`, `gcp_compat.ts:263/295`, `openai_original.ts:229` (non-stream) + `:329` (stream).
- Streaming `/v1/responses` (`oo`, `openai_original.ts:329`): sequence is `📊 [STREAM-DONE]` (bytes+duration) → conditional `🟣 [USAGE]` → `[SERVED]`. Bytes-only `STREAM-DONE` with no `response.completed` usage frame is honest accounting, not a drop.

### `logLimit(reqId, provider, keyIdx, status?, retryAfterSec?, totalKeys?, rawMessage?)` (`logger.ts:253-273`)
```
⚠️ [09-07-09:51:38:686] [LIMIT req_demo] Zen [Key #1/7] returned 429 Too Many Requests
⚠️ [09-07-09:51:38:686] [LIMIT req_demo] Parsed Retry-After: 60s -> Quarantined Key #1 for 60s
⚠️ [09-07-09:51:38:686] [LIMIT req_demo] Upstream Error: "Rate limit exceeded"
```
- Line 1 always; line 2 only if `retryAfterSec` truthy; line 3 only if `rawMessage` non-empty (truncated to 300 chars).
- Status text via `getHttpStatusText` (`logger.ts:208-223`): named for 429/500/502/503/504, else `HTTP <n>`.
- `extractErrorMessage` (`logger.ts:225-251`): prefers `error.message` → `error` string → `message` → `detail` → trimmed raw; `undefined`/blank → `undefined`.

### `logRotate` / `logRetry` / `logExhausted` (`logger.ts:193-296`)
```
🔄 [ts] [ROTATE req] Advancing to Zen [Key #3/7] -> Retrying immediately (Attempt 2/3)
🟠 [ts] [RETRY req] Zen [Key #2] attempt 2/3 (reason)
🔴 [ts] [EXHAUSTED req] All keys in Zen cooling down. Applying backoff: 2500ms
```
- `logRotate`: `oldIdx` param is accepted but not printed (display uses `newIdx+1/total`).
- `logExhausted` and `logError` go to `console.error`.

### `logPacer(reqId, provider, dwellMs, {queueDepth, avgDwellMs, minIntervalMs})` (`logger.ts:303-314`)
```
🐢 [09-07-09:47:23:279] [PACER req_96voa1p] Zen dwell=0ms depth=0 avg=0ms interval=200ms
```
- Visible in tmux alongside TTFT. Intervals: 2000ms `gg`/`gc`, 200ms–500ms others.

### `logServed(reqId, durationMs, status?, attempt?, maxAttempts?)` (`logger.ts:316-331`)
```
🟢 [09-07-09:48:15:594] [SERVED req_j3ruuw2] HTTP 200 in 28981ms
```
- 🟢 `<400` via `console.log`, ⚠️ `>=400` via `console.warn`. Attempt suffix only when `maxAttempts>1`.

### `logFinishReason(reqId, finishReason?)` (`logger.ts:372-384`)
- `null`/undefined/empty → silent no-op (guard tested).
- `"length"` → `⚠️ [FINISH req] Upstream token truncation occurred (finish_reason=length)` via `logWarn`.
- else → `🏁 [FINISH req] Stream finished: finish_reason=<r>` via `logInfo`.

### `logBoot / logError / logFusion / logInfo / logWarn / logAmber` (`logger.ts:333-370,298-301`)
```
🚀 [ts] BOOT <message>                       (logBoot)
💥 [ts] [ERROR req] <message> - <err.msg>    (logError, console.error)
🔗 [ts] [FUSION req] Preset: <p> | Model: <m> -> Tier <t> (<Prov>)
🟡 [ts] [AMBER req] <message>                 (console.warn)
```
- `logInfo(emoji, message)` / `logWarn(emoji, message)`: caller picks an `EMOJI` value — never invent ad-hoc emoji. Always verify logger signature before adding call sites (do not pass `{error}` objects; it takes `(emoji: string, msg: string)`).

## 4. Full request lifecycle (what healthy scrollback looks like)

```
🐢 [PACER] ... dwell=0ms ...
🔵 [req] Inbound POST /v1/responses ...
🎯 [req] Directive: ...
🤖 [req] Model: ...
📦 ... prep (handler-built)
🔌 ... upstream dispatch (handler-built)
🟢 [TTFT req] TTFT = Nms | Stream established [Upstream: HTTP/x]
📊 [STREAM-DONE req] bytes=N duration=Nms      (oo streaming only)
🟣 [USAGE req] Prov (Key #i/n)
💬 [USAGE req] Tokens: ...
🏁 [FINISH req] Stream finished: finish_reason=stop
🟢 [SERVED req] HTTP 200 in Nms
───
```

## 5. Debugging recipes

```bash
tmux attach -t literouter                      # live tail
grep -E "🎯|🤖" logs/gateway.log | tail -20    # directive/model lines
grep "💬" logs/gateway.log | tail -20          # token lines (all carry [USAGE req])
grep "⚠️.*\[LIMIT" logs/gateway.log | tail -20 # rate-limit / quarantine events
grep "🐢.*dwell=[1-9]" logs/gateway.log        # non-zero pacer waits
bun test tests/unit/visual_telemetry.test.ts   # 18-test contract suite
```

- Missing `🎯/🤖` lines → `logInbound` called in legacy string form or `directiveStr`/`model` undefined — check handler call site.
- Missing `💬` line → `logUsage` never reached (stream dropped before usage frame) — check for `STREAM-DONE` bytes-only fallback.
- `⚠️ [LIMIT]` without `Parsed Retry-After` → `retryAfterSec` falsy — check `Retry-After` header parsing / ttl gating (e.g. `ZEN_ENABLE_QUARANTINE=false` gates `ttl` at call sites like `openai_original.ts:176-183`, `anthropic_compat.ts` zn gates).
- Timestamps misaligned / timeless indented lines → pre-2026-09-07 logger; pull latest `src/ui/logger.ts`.

## 6. Rules for adding new telemetry

1. Add the function to `src/ui/logger.ts` — never `console.log` from handlers.
2. Format: `` `${EMOJI.x} ${ts} [TAG ${reqId}] message` `` — timestamp + tag on **every** line, no multi-line single calls, no leading spaces.
3. Reuse `EMOJI` values; add a new key only if no existing icon fits.
4. Update `tests/unit/visual_telemetry.test.ts` with an `includes()` assertion per new line.
5. Run `bun run typecheck && bun test tests/unit/visual_telemetry.test.ts`.
