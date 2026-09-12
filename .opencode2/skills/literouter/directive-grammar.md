# Directive Grammar — full `lr-*` matrix

> Canonical location: `.opencode2/skills/literouter/directive-grammar.md`.
> Entry point: `SKILL.md` §§ Directive Key Format / Top 10 — this file **expands**
> those tables, it does not replace them. Where names differ, code wins.

## 1. Key shapes

Two shapes only (`src/directive/parser.ts:192-205`):

| Shape | Segments | Example |
|---|---|---|
| Direct | `lr-<provider>-<payload>-<completion>-<nuance>` (exactly 5 dash-parts) | `lr-nv-oa-ch-ts` |
| Fusion | `lr-fse-<preset>` (exactly 3 dash-parts) | `lr-fse-fast` |

Rules (`src/directive/parser.ts:96-109,192-196`, `src/directive/validator.ts:71-73`):

- Keys are trimmed and lowercased before parsing — `LR-NV-OA-CH-TS` works.
- Nuance segment may be compound with `+` (e.g. `dp+ts`); every part must be a
  known nuance or the whole key is rejected (`parseNuanceTokens` returns null).
- Token extraction order per request (`src/directive/validator.ts:54-69`):
  `Authorization: Bearer …` → `x-api-key` → `x-goog-api-key` → `?key=` /
  `?api_key=` / `?token=`. Missing/invalid token → `401 invalid_api_key`
  (`src/directive/validator.ts:98-116`).

## 2. Provider codes (13)

Enum: `src/directive/parser.ts:1-14`. Upstreams: `config/providers.json`.

| Code | Provider | Upstream base URL |
|---|---|---|
| `or` | OpenRouter | `https://openrouter.ai` |
| `nv` | NVIDIA NIM | `https://integrate.api.nvidia.com` |
| `gg` | Google AI Studio | `https://generativelanguage.googleapis.com` |
| `oa` | OpenAI | `https://api.openai.com` |
| `an` | Anthropic | `https://api.anthropic.com` |
| `gq` | Groq | `https://api.groq.com/openai` |
| `cb` | Cerebras | `https://api.cerebras.ai` |
| `ds` | DeepSeek | `https://api.deepseek.com` |
| `ms` | Mistral | `https://api.mistral.ai` |
| `tg` | Together | `https://api.together.xyz` |
| `zn` | Zen (OpenCode free tier) | `https://opencode.ai/zen` |
| `tp` | Test provider (tests only) | `http://127.0.0.1:8999` |
| `gc` | Google Cloud Vertex | `https://generativelanguage.googleapis.com` |

Note: `tp` exists in code (`src/directive/parser.ts:12`, `src/config/schema.ts:15`)
but is a loopback test double — never use it outside unit tests.

## 3. Payload (wire) codes (6)

Enum: `src/directive/parser.ts:16` (`WireProtocol`), `src/config/schema.ts:19`.

| Code | Wire | Meaning |
|---|---|---|
| `oa` | OpenAI Chat | Standard OpenAI Chat Completions JSON. **Scrubs** reasoning history before upstream (`src/handlers/openai_compat.ts:872` → `src/transformers/payload.ts:290`). |
| `oo` | OpenAI Original (Responses native) | Native Responses API body forwarded **verbatim** (`src/index.ts:341-351` → `src/handlers/openai_original.ts:975`). Preserves encrypted reasoning / `previous_response_id` for CoT replay. |
| `cl` | Anthropic Claude | Native Anthropic Messages wire (`src/handlers/anthropic_compat.ts:1410`). |
| `ao` | Anthropic→OpenAI cross-wire | Open-weights / XML-tool models via OpenRouter without its broken `/api/v1/messages` translator (SKILL.md §Directive). Forces reasoning-strip by default (`src/transformers/thinking.ts:108-110`). |
| `gg` | Google native | Gemini REST passthrough (`src/handlers/google_native.ts:781`). |
| `rs` | Responses (translated) | OpenAI Chat inbound translated to Responses `input` (`src/transformers/responses.ts:73`); only `response.output_text.delta` streams downstream, reasoning survives as `reasoning_tokens` usage. |

`oa` scrubs / `oo` preserves is the payload rule — keyed off payload, not
provider or endpoint (SKILL.md resilience item 32).

## 4. Completion (endpoint) codes (10)

Enum: `src/directive/parser.ts:20-30`, `src/config/schema.ts:21-32`.

| Code | Endpoint | Inbound route → handler |
|---|---|---|
| `ch` | Chat (`POST /v1/chat/completions`) | `src/index.ts:149` → `src/handlers/openai_compat.ts:959` `handleOpenAICompat` |
| `ms` | Messages (`POST /v1/messages`, `/messages`, `/api/v1/messages`) | `src/index.ts:150-152` → `src/handlers/anthropic_compat.ts:1410` `handleAnthropicCompat` |
| `rs` | Responses (`POST /v1/responses`) | `src/index.ts:347-348` → `src/handlers/openai_original.ts:975` `handleOpenAiOriginal` |
| `gc` | GenerateContent (`/v1beta/models/*`, `/v1/models/*`) | `src/index.ts:208-209` → `src/handlers/google_native.ts:781` `handleGoogleNative` |
| `ob` | OpenAI Beta (`/v1beta/openai/*`) | `src/index.ts:205-206` → `src/handlers/google_native.ts:824` `handleGoogleOpenAIBeta`; `gc` provider also serves `/v1beta/openai/*` via `src/handlers/gcp_compat.ts:614` (`src/index.ts:335-336`) |
| `em` | Embeddings | Declared in `CompletionCodeSchema` (`src/config/schema.ts:28`); provider endpoint map key (`ProviderEndpointsSchema`, `src/config/schema.ts:50-53`). No dedicated inbound route in `ROUTE_MAP` (`src/index.ts:148-156`). |
| `md` | Models discovery (`GET /v1/models`, `/v1beta/models`) | `src/index.ts:165-199` → `src/handlers/discovery.ts:113` `handleModelsDiscovery` |
| `g1` | Google v1 (completion-code slot, **not** a nuance) | Declared `src/directive/parser.ts:25`, `src/config/schema.ts:26`. Provider endpoint map key only. |
| `im` | Images | Declared `src/directive/parser.ts:26`, `src/config/schema.ts:27`. Provider endpoint map key only. |
| `au` | Audio | Declared `src/directive/parser.ts:28`, `src/config/schema.ts:29`. Provider endpoint map key only. |

## 5. Nuance codes (8, compoundable with `+`)

Parser set: `src/directive/parser.ts:32,85-94`.

| Code | Name | Effect (grounded) |
|---|---|---|
| `no` | none | No modifier. (Also gates Ling auto-transform off: `src/transformers/payload.ts:335`.) |
| `dp` | Dots XML polyfill | `applyDotPrompt(messages)` (`src/transformers/nuances.ts:195-197`); `tc`-family path also injects tool-schema prompt + compacts history (`src/transformers/payload.ts:298-305`). |
| `ts` | Thinking Support | **Never strip reasoning** — `shouldStripReasoning` returns false (`src/transformers/thinking.ts:102-104`, `src/transformers/opencode_adapter.ts:30-32`); injects thought signatures (`src/transformers/payload.ts:295-297`). Overrides OpenCode auto-strip. |
| `sb` | Strip (force) | **Always strip reasoning**, any client (`src/transformers/thinking.ts:105-107`, `src/transformers/opencode_adapter.ts:33-35`). |
| `gm` | Gemma merge | `applyGemmaConstraints` (`src/transformers/payload.ts:292-294`) + `scrubGemmaParameters` when scrubbing enabled (`:349-351`). |
| `g3` | Google-3 cleanup | `cleanGoogle3Nuance` (`src/transformers/nuances.ts:198-200`). |
| `tc` | Tool compaction | Normalizes `tool_choice` to target wire (`src/transformers/nuances.ts:201-203`); injects tool-schema prompt, serializes Dots history, merges consecutive messages (`src/transformers/payload.ts:298-305`; also `src/handlers/openai_compat.ts:396`). |
| `lg` | Ling | Ling-dialect request transform (`src/transformers/payload.ts:333-339`); Ling tool path in `openai_compat.ts:392`. **Parser-only**: accepted by `parseNuanceTokens` (`src/directive/parser.ts:93`) but absent from `NuanceCodeSchema` (`src/config/schema.ts:34-42`) — config-file validation will reject what the gateway parser accepts. |

Compound: split on `+`, each part validated (`src/directive/parser.ts:96-109`).
Common: `dp+ts` (XML tools + keep thinking), `tc+ts`.

> Not a nuance: `g1` (completion slot, §4) and `gb` — **`gb` appears nowhere
> in `src/`** and must never be used. Any key containing it fails parsing.

## 6. Top 10 keys (expanded — handler + why)

Same ten as SKILL.md §3; each row adds the handler `file:line` and the
mechanical reason. No contradictions — details only.

| Key | Handler (`file:line`) | Why this combination |
|---|---|---|
| `lr-zn-oa-ch-no` | `src/handlers/openai_compat.ts:959` | Zen OpenAI-Chat: rotation + OpenCode identity headers, default scrub. |
| `lr-zn-oo-rs-no` | `src/handlers/openai_original.ts:975` | Zen native Responses passthrough; preserves encrypted reasoning for CoT replay. |
| `lr-or-oa-ch-no` | `src/handlers/openai_compat.ts:959` | OpenRouter Chat + agentic harness headers (`config/providers.json`). |
| `lr-nv-oa-ch-ts` | `src/handlers/openai_compat.ts:959` | NIM reasoning models emit `reasoning_content`-only opening chunks; `ts` keeps them alive. |
| `lr-or-cl-ms-no` | `src/handlers/anthropic_compat.ts:1410` | Native Claude on OpenRouter for Claude Code. |
| `lr-an-cl-ms-no` | `src/handlers/anthropic_compat.ts:1410` | Direct Anthropic Messages with key rotation. |
| `lr-gg-gg-gc-no` | `src/handlers/google_native.ts:781`<br>(v4: `src/handlers/v4/google_native.ts:5`) | Gemini REST forwarder + native fusion chains; in v4 extracts model from path & preserves `:streamGenerateContent`; `?key=` accepted (`src/directive/validator.ts:37-52`). |
| `lr-nv-oa-ch-no` | `src/handlers/openai_compat.ts:959` | High-throughput binary-multiplexed chat (Pydantic AI / `httpx http2=True`). |
| `lr-gc-oa-ch-no` | `src/handlers/gcp_compat.ts:614` | Vertex Chat, handler-paced 30 RPM conveyor (edge pacer skips `gc`: `src/index.ts:222-223`). |
| `lr-or-ao-ch-dp` | `src/handlers/openai_compat.ts:959` | Cross-wire + Dots XML extraction for open-weights tool models. |

Further grounded examples from `config/fusion.json`: `lr-an-cl-ms-no`,
`lr-or-cl-ms-no`, `lr-nv-oa-ch-ts`, `lr-or-oa-ch-ts`, `lr-gg-oa-ob-dp`,
`lr-or-oa-ch-no`, `lr-ds-oa-ch-ts`, `lr-gq-oa-ch-no`, `lr-cb-oa-ch-no`.

## 7. Fusion presets (`lr-fse-*`)

Shape: `parseFusionKey` (`src/directive/parser.ts:163-182`). Presets are data in
`config/fusion.json` (v3.1, `sticky_fallback` strategy throughout):

| Preset key | `fusion.json` entry | Tiers |
|---|---|---|
| `lr-fse-quad` | `quad` (`config/fusion.json:5`), 30s timeout | claude-3.7-sonnet (`or-cl-ms` → `an-cl-ms`), deepseek-r1 (`nv-oa-ch-ts` → `or-oa-ch-ts`), gemini-2.5-pro (`gg-oa-ob-dp` → `or-oa-ch-no`) |
| `lr-fse-pydn` | `pydn` (`config/fusion.json:53`), 25s timeout | deepseek-reasoner (`ds-oa-ch-ts` → `nv-oa-ch-ts`), claude-3-7-sonnet (`an-cl-ms` → `or-cl-ms`) |
| `lr-fse-fast` | `fast` (`config/fusion.json:87`), 15s timeout | gemini-3.1-flash-lite (`gg-oa-ob-dp` → `or-oa-ch-no`), llama-3.3-70b (`gq-oa-ch-no` → `cb-oa-ch-no`) |
| `lr-fse-deep` | `deep` (`config/fusion.json:121`), 45s timeout | deepseek-r1 three-tier (`nv-oa-ch-ts` → `ds-oa-ch-ts` → `or-oa-ch-ts`) |

Native chains (`config/fusion.json:147-158`, trigger model names, key stays
`lr-gg-gg-gc-no`): `gemini-flash` cascades `3.8 → 3.7 → 3.6 → 3.5`;
`gemini-flash-lite` cascades `3.5 → 3.1`.

> Name caution: SKILL.md §Directive mentions `fast/smart/code/cheap` as
> examples. The only presets present in `config/fusion.json` are
> `quad/pydn/fast/deep` — `smart/code/cheap` do not exist there. Use the
> table above as truth.

## 8. Endpoint-mismatch 400 rules

Enforced twice per request: `dispatchRoute` (`src/index.ts:375-379`) and
`handleAppRequest` (`src/index.ts:432-436`), via `validateEndpointMatch`
(`src/index.ts:289-316`):

| Inbound path | Directive completion | Result |
|---|---|---|
| `POST /v1/chat/completions` | `rs` | `400` `"Endpoint mismatch: Directive specifies Responses API (-rs-). Use /v1/responses."` (`src/index.ts:293-303`) |
| `POST /v1/responses` | `ch` | `400` `"Endpoint mismatch: Directive specifies Chat Completions (-ch-). Use /v1/chat/completions."` (`src/index.ts:304-314`) |
| anything else | anything | No mismatch — falls through to pacer → route dispatch (`src/index.ts:381-405`) |

Only the `ch`/`rs` pair is fail-fast. All other completion codes
(`ms/gc/ob/em/md/…`) rely on route dispatch: unknown paths → `404`
(`src/index.ts:407-408`); wrong-handler paths are unreachable because routing
is by path, not by directive segment.

## 9. Dispatch order cheat-sheet

Engine gate first: `resolveEngine` (`src/config/env.ts:130-140`) branches
at `src/index.ts:414-417` — `v4` goes to `dispatchV4`, otherwise the legacy
order below applies. Default engine is `legacy` (see §11).

`dispatchRoute` (`src/index.ts:392-409`): admin reset → system
(`/health /reset /hello`) → models discovery → `validateEndpointMatch` →
ingress pacer (`or/nv/zn/gg` only; `gc` handler-paced, `src/index.ts:216-230`)
→ `/v1/responses` → `gc` chat/beta → `ROUTE_MAP` (`src/index.ts:148-156`) →
Google beta (`/v1beta/openai/`, `/v1beta/models/`, interactions/files;
`src/index.ts:201-212`) → `404`.

## 10. Quick validity checks

Valid: `lr-nv-oa-ch-ts`, `lr-or-ao-ch-dp+ts`, `lr-gg-gg-gc-no`,
`lr-fse-deep`, `lr-tp-oa-ch-no` (tests only).
Invalid: `lr-nv-oa-ch-gb` (unknown nuance), `lr-xx-oa-ch-no` (unknown
provider), `lr-nv-oa-ch-` (empty nuance, `src/directive/parser.ts:97-99`),
`lr-nv-oa-ch` (4 parts — neither 5-part direct nor 3-part fusion,
`src/directive/parser.ts:201-204`), `sk-anything` (no `lr-` prefix,
`src/directive/parser.ts:194-196`).

## 11. Engine selection & v4-only routes

Production engine default is `v4.1`: `LITEROUTER_ENGINE: "v4.1"` (`src/config/env.ts:51`). Legacy engine remains available as an escape hatch (`LITEROUTER_ENGINE=legacy`).
Per-request override via `x-literouter-engine: legacy|v4.1` (or `v4`, normalized to `v4.1`) header applies only when `LITEROUTER_ENGINE_OVERRIDE` is true (`src/config/env.ts:126-140`); otherwise the env default wins and the header is ignored.

Branch: `resolveEngine(req)` at `src/index.ts:414-417` — `v4.1` goes to `dispatchV4` (`src/handlers/v4/router.ts:201-211`), while `legacy` runs the legacy dispatch (§9).

`/v1/traces` is v4-only: `isTracePath` (`src/handlers/v4/router.ts:93-95`) is reachable solely through `dispatchV4` (`router.ts:209-211`). On the legacy engine the same path falls through legacy routing to `404` — a `404` on `/v1/traces` means the gateway is running legacy, not that tracing is broken.

### 11.1. Google Native (gg) v4 Path Extraction & Stream Action Preservation
Under Engine v4 (`handleV4GoogleNative` in `src/handlers/v4/google_native.ts:5` and `NativeCascadeStrategy` in `src/engine/strategies/native_cascade.ts:31-62`):
- **Path Model Extraction**: When inbound requests arrive at `/v1beta/models/*` or `/v1/models/*` without a `model` property in the JSON body, the model is extracted automatically via `/\/(?:v1beta|v1)\/models\/([^:]+)/`.
- **Stream Action Preservation**: If the inbound path requests `:streamGenerateContent` (e.g. `/v1beta/models/gemini-2.5-flash:streamGenerateContent`), `NativeCascadeStrategy.buildGoogleUrl` detects `ctx.path?.includes(":streamGenerateContent")` and replaces `:generateContent` with `:streamGenerateContent` in the upstream URL, preserving streaming RPC fidelity.

### 11.2. In-Flight Retry-After Backoff & Key #0 Elimination
Under Engine v4 dispatch (`src/engine/dispatch.ts:567-604`):
- **Retry-After Backoff**: When an upstream provider returns 429 or retryable 5xx with a `Retry-After` header, in-flight retries pause for `Math.min(retryAfterSec * 1000, 15000)` (clamped to a maximum of 15 seconds) via `Bun.sleep(delayMs)` before rotating to the next key. This adheres to upstream pacing without starving client timeouts.
- **Elimination of Key #0**: Key indexing in `src/telemetry/session.ts` and `src/ui/logger.ts` is strictly 1-based (`Key #1` to `Key #N`). When retrying before a target key index is known (`toIndex: -1`), telemetry guards against `-1 + 1 = 0`, completely eliminating `Key #0` and cleanly displaying `Pool: <Provider> (N keys)` or omitting key indices.
