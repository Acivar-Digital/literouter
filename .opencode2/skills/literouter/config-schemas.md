# LiteRouter Config Schemas (`config/`)

Source of truth for every JSON config the gateway reads at runtime.
All paths are relative to the repo root (`/home/yapilwsl/arthityap/literouter/`).
Validators live in `src/config/schema.ts` (Zod) and are re-exported from `src/lib.ts`.

> Scope note: this file documents schemas and load paths only. It never
> contains real API keys. For safe testing with stub keys, see `AGENTS.md`.

---

## 1. `config/fusion.json`

Top-level keys on disk (verified): `$schema`, `version`, `presets`, `native_chains`.

```json
{
  "$schema": "./fusion.schema.json",
  "version": "3.1",
  "presets": { "<preset>": { "strategy": "sticky_fallback", "timeout_ms": 30000, "models": {} } },
  "native_chains": { "gemini-flash": [], "gemini-flash-lite": [] }
}
```

### 1.1 `presets` (OpenAI-compat sticky fallback)

Presets on disk: `quad`, `pydn`, `fast`, `deep`.
Each preset: `strategy` (always `"sticky_fallback"`), `timeout_ms` (int),
`models` (record of virtual-model-name → `{ tiers: [...] }`).
Each tier: `priority` (positive int), `apikey` (directive key, e.g. `lr-nv-oa-ch-ts`),
`model` (upstream model id, e.g. `deepseek-ai/deepseek-r1`).

Example (`quad` → `deepseek/deepseek-r1`): priority 1 `lr-nv-oa-ch-ts` /
`deepseek-ai/deepseek-r1`, priority 2 `lr-or-oa-ch-ts` / `deepseek/deepseek-r1`.

Consumed by `loadFusionConfig()` in `src/handlers/openai_compat.ts:882`
(`resolve(process.cwd(), "config", "fusion.json")`, `JSON.parse`, falls back to
`{ version: "3.1", presets: {} }` when missing/unparseable) and executed via
`FusionEngine` in `src/fusion/engine.ts` (`resolveModelTiers` sorts by `priority`;
`createExecutionPlan` applies the sticky tier first).

Note: `loadFusionConfig()` re-reads the file on every fusion request, so preset
edits take effect without a reset.

### 1.2 `native_chains` (Google native cascades)

```json
"native_chains": {
  "gemini-flash": ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"],
  "gemini-flash-lite": ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
}
```

Consumed by `loadAndCacheNativeChains()` in `src/handlers/google_native.ts:93`
(`resolve(process.cwd(), "config", "fusion.json")`; on failure logs
`"Failed to load native_chains from config/fusion.json — using hardcoded fallback"`
and falls back to `DEFAULT_FLASH_CHAIN` / `DEFAULT_FLASH_LITE_CHAIN`
in `src/handlers/google_native.ts:36-47`).

Unlike presets, native chains are **cached** in `cachedNativeChains`
(`src/handlers/google_native.ts:49`) — edits require `POST /reset` (see §6).

### 1.3 `nativeTierIndices` (sticky position for native cascades)

In-memory `Map<string, number>` in `src/handlers/google_native.ts:50`, keyed by
chain name (`gemini-flash`, `gemini-flash-lite`). Helpers in the same file:

- `getNativeTierIndex(chainKey)` (`:52`), `setNativeTierIndex(chainKey, index)` (`:56`)
- `resetNativeTierIndices()` (`:60`); `resetNativeFlashTierIndex()` (`:64`, alias)
- `getCurrentFlashTierIndex()` (`:68`, reads `gemini-flash`)

`setNativeTierIndex` is called on tier success and on cascade advance in
`executeTierKeyLoop` / `executeNativeFusionCascade`
(`src/handlers/google_native.ts:662-760`); cleared on `POST /reset` via
`resetNativeFlashTierIndex()` from `handleHardReset()` in `src/index.ts:61`.

### 1.4 Validation gap (verified on disk)

- `config/fusion.json` declares `"$schema": "./fusion.schema.json"`, but **no
  `fusion.schema.json` file exists anywhere in the repo** (glob for
  `**/fusion.schema.json` returns zero hits). The `$schema` pointer is
  informational only; nothing enforces it at runtime.
- `FusionConfigSchema` in `src/config/schema.ts:83` validates only
  `$schema?`, `version` (default `"3.1"`), and `presets`. It has **no
  `native_chains` field**, and the runtime loaders (`loadFusionConfig`,
  `loadAndCacheNativeChains`) use untyped `JSON.parse` — they do not call the
  Zod schema. So `native_chains` shape errors fail open (fallback chains), not
  with a validation error.

---

## 2. `config/models.json` — LEGACY advertisement-only catalog (NOT a serving gate)

`config/models.json` only feeds the `/v1/models` advertisement list. It does
**not** gate which models can be served — any `body.model` string the client
sends is forwarded dynamically (see "Dynamic passthrough" below). Never write
"must exist in `models.json` to serve": that claim is false.

Top-level shape: `{ "models": [ ... ] }`. Entry keys (verified):
`id`, `provider`, `category`, `supports_thinking`, `supports_tools`,
`context_window`, plus optional `quota: { rpm, rpd, tpm }`.

Validated by `ModelCatalogEntrySchema` / `ModelsConfigSchema` in
`src/config/schema.ts:89-101` (`supports_thinking` / `supports_tools` default
`false`; `context_window` positive int; `quota` optional `RateLimitSchema`).
All of these are **descriptive metadata** for clients browsing the catalog —
`quota` / `context_window` / capability flags do not add, remove, or block
models at request time.

Values observed on disk:

- `provider`: `openrouter`, `anthropic`, `nvidia`, `google`, `gcp`
- `category`: `reasoning`, `text-out`, `agents`, `open-weights`, `embeddings`,
  `audio-tts`, `robotics`
- `quota` present on Google metered models (e.g. `gemini-3.1-flash-lite`
  `{ rpm: 15, rpd: 500, tpm: 250000 }`), absent on e.g. `gcp` Gemma entries and
  the OpenRouter/Anthropic/NVIDIA reasoning entries.

Reader: `loadCatalogModels()` in `src/handlers/discovery.ts:38`
(`resolve(process.cwd(), "config", "models.json")` at `:39`) maps each entry
to `{ id, owned_by }` for `/v1/models` responses; fusion preset membership is
read from `config/fusion.json` in `loadFusionPresetModels`
(`src/handlers/discovery.ts:59`). When `config/models.json` is absent the
reader returns a 3-item hardcoded fallback (`:41-45`:
`anthropic/claude-3.7-sonnet`, `deepseek/deepseek-r1`, `gemini-2.5-pro`).
`filterByDirective()` (`:100-111`) only filters this **advertised** list by
directive provider/preset — it never permits or denies actual inference.

> Note: there is no `models.json` at the repo root (a root-level file does not
> exist — deleted). The only catalog path the gateway reads is
> `config/models.json`.

### 2.1 Dynamic passthrough (how serving actually resolves models)

Direct (non-fusion) requests do no catalog lookup. `handleOpenAICompat()`
logs `body.model` verbatim (`src/handlers/openai_compat.ts:984,1002` via
`resolveUpstreamEndpoint`), and `executeDirectRequest()` (`:857-880`)
forwards the client-supplied model through `sanitizeAndTransformPayload()`
into `executeDirectCall()` → `resolveUpstreamEndpoint(provider, completion,
model)` (`:106-131`, `{model}` templated into the provider's endpoint path).
The **only** model-string mutation on this path is the `openrouter/` prefix
strip (`:865-868`).

Fusion requests are the one membership-gated path, and the gate is
`fusion.json`, not the catalog: `executeFusionFlow()` calls
`engine.createExecutionPlan(presetName, body.model)` (`:930`); an unknown
model/preset returns 404 `No fusion configuration found for model '...'`
(`:932-936`). Google native chains resolve tiers from `native_chains` in
`fusion.json` (`getNativeChain` / `resolveNativeChain`,
`src/handlers/google_native.ts:110-118`, cascade in `:662-760`) — again with
no catalog involvement.

Per-provider model handling on the passthrough path (transforms, not gates):

- `gcp`: `normalizeGcpModel()` strips a `gcp/` or `google/` prefix and
  `buildGcpAuthHeaders()` attaches `Authorization: Bearer` +
  `x-goog-api-key` (`src/handlers/gcp_compat.ts:54,69`).
- `zen`: bare model names only — never a `zen/` prefix (`big-pickle`,
  `hy3-free`).
- `dots` (XML tool calling): `parseDotsXml()` translates embedded XML tool
  calls into `tool_calls` (`src/transformers/dots.ts:260`); the `tc` nuance
  (or a `dots` model-name match) cross-wires the `ao` payload path, which
  strips reasoning parameters (`sanitizeAndTransformPayload`,
  `src/transformers/payload.ts:322-368`; `targetWire === "ao"` forces the
  reasoning-strip branch, `oa` is the default wire, `oo` preserves).
- Context overflow is handled by `pruneOpenAIPayload()` retry
  (`src/transformers/context_pruner.ts`, invoked at
  `src/handlers/openai_compat.ts:354-362`), keyed off the upstream error —
  not off any catalog `context_window` value.

---

## 3. `config/providers.json` — providers + headers registry

Top-level shape: `{ "providers": { "<name>": { ... } } }`.
Entry keys (verified): `code`, `base_url`, `auth_header`, optional `headers`,
`endpoints`, `limits`.

Validated by `ProviderConfigEntrySchema` / `ProvidersConfigSchema` in
`src/config/schema.ts:55-65` (`auth_header` is `"Bearer" | "x-api-key"`,
default `"Bearer"`; `endpoints` is a record keyed by `CompletionCodeSchema`;
`limits` is a record of name → `RateLimitSchema`).

### 3.1 Providers on disk (name → `code` → `base_url`)

| name | code | base_url |
|---|---|---|
| `openrouter` | `or` | `https://openrouter.ai` |
| `nvidia` | `nv` | `https://integrate.api.nvidia.com` |
| `google` | `gg` | `https://generativelanguage.googleapis.com` |
| `openai` | `oa` | `https://api.openai.com` |
| `anthropic` | `an` | `https://api.anthropic.com` |
| `groq` | `gq` | `https://api.groq.com/openai` |
| `cerebras` | `cb` | `https://api.cerebras.ai` |
| `deepseek` | `ds` | `https://api.deepseek.com` |
| `mistral` | `ms` | `https://api.mistral.ai` |
| `together` | `tg` | `https://api.together.xyz` |
| `zen` | `zn` | `https://opencode.ai/zen` |
| `testprovider` | `tp` | `http://127.0.0.1:8999` |
| `gcp` | `gc` | `https://generativelanguage.googleapis.com` |

Codes must stay in sync with `ProviderCodeSchema`
(`src/config/schema.ts:3-17`); directive parsing, `globalKeyPool`, and the
pacer all key off the two-letter code.

### 3.2 `headers` registry (static per-provider headers)

Only two providers define `headers` on disk; all others omit it:

- `openrouter.headers`: `HTTP-Referer: https://opencode.ai`,
  `X-Title: OpenCode`, `User-Agent: OpenCode/1.18.29`
- `zen.headers`: `HTTP-Referer: https://opencode.ai`, `Referer: https://opencode.ai`,
  `X-Title: OpenCode`, `User-Agent: OpenCode/1.18.29`

Merged into every upstream request by `buildAuthHeaders()` in
`src/handlers/openai_compat.ts:133` (`Object.assign(headers, p.headers)` when
the provider code matches). `resolveUpstreamEndpoint()` in the same file
(`:106`) also returns `p.headers` so callers (e.g. Google native referrer
logging) can read them. Default env fallbacks for the same values live in
`EnvConfigSchema` (`LITEROUTER_HTTP_REFERER`, `LITEROUTER_X_TITLE`,
`LITEROUTER_USER_AGENT`, `src/config/schema.ts:144-146`).

### 3.3 `endpoints` (completion-code → path)

Endpoint codes observed on disk: `ch`, `ms`, `ob`, `gc`, `g1`, `em`, `md`,
`rs`, `im`, `au` — matching `CompletionCodeSchema`
(`src/config/schema.ts:21-32`). Examples: google `ob` =
`/v1beta/openai/chat/completions`, google `gc` =
`/v1beta/models/{model}:generateContent` (`{model}` is substituted in
`resolveUpstreamEndpoint`, `src/handlers/openai_compat.ts:106-131`).

### 3.4 `limits` (`rpm` / `rpd` / `tpm`)

Each provider has a `default` limit; `google` additionally carries per-model
overrides mirroring the `quota` values in `config/models.json` (e.g.
`gemini-3.1-flash-lite`, `gemini-3.5-flash`, `gemma-4-26b`,
`text-embedding-004`, `antigravity`).

Providers state is **cached** in `cachedRegistry`
(`src/handlers/openai_compat.ts:69`), loaded once from
`resolve(process.cwd(), "config", "providers.json")` (`:79`). Edits require
`POST /reset` (see §6).

---

## 4. `FUSION_UPSTREAM_URL` — what it is (and is not)

There is **no `FUSION_UPSTREAM_URL` constant in `src/`** (grep over `src/`
returns zero hits). The names `FUSION_UPSTREAM_URL` /
`FUSION_UPSTREAM_URL_NATIVE` are legacy **Python fusion-sidecar env vars**
documented in `docs/swap_env.md:64-65` and `docs/Longrunning_Mode.md:118`:

| var | example | meaning |
|---|---|---|
| `FUSION_UPSTREAM_URL` | `http://localhost:7767/v1/chat/completions` | OpenAI-compat upstream for the sidecar |
| `FUSION_UPSTREAM_URL_NATIVE` | `http://localhost:7767/v1beta` | Google native upstream for the sidecar |

Do not reference them as TypeScript constants. The TS gateway resolves
upstreams from `config/providers.json` via `resolveUpstreamEndpoint()`
(`src/handlers/openai_compat.ts:106`), with test override through
`MOCK_<CODE>_PORT` env vars (`overrideProviderUrl`, same file `:91`) and
native base override via `MOCK_GG_PORT` / `GOOGLE_NATIVE_BASE_URL`
(`src/handlers/google_native.ts:160-170`).

---

## 5. Zod validators (`src/config/schema.ts`)

| schema | lines | validates |
|---|---|---|
| `ProviderCodeSchema` | `:3-17` | `or nv gg oa an gq cb ds ms tg zn tp gc` |
| `PayloadCodeSchema` | `:19` | `oa oo cl gg rs ao` |
| `CompletionCodeSchema` | `:21-32` | `ch ms ob gc g1 im em au md rs` |
| `NuanceCodeSchema` | `:34-42` | `no dp ts gm g3 sb tc` |
| `RateLimitSchema` | `:44-48` | `{ rpm, rpd, tpm }` non-negative ints |
| `ProviderEndpointsSchema` | `:50-53` | record `CompletionCode → path` |
| `ProviderConfigEntrySchema` | `:55-61` | one `config/providers.json` entry |
| `ProvidersConfigSchema` | `:63-65` | `{ providers: {...} }` |
| `FusionTierSchema` | `:67-71` | `{ priority, apikey, model }` |
| `FusionModelConfigSchema` | `:73-75` | `{ tiers: [...] }` (min 1) |
| `FusionPresetSchema` | `:77-81` | `{ strategy: "sticky_fallback", timeout_ms, models }` |
| `FusionConfigSchema` | `:83-87` | `{ $schema?, version, presets }` — no `native_chains` (§1.4) |
| `ModelCatalogEntrySchema` | `:89-97` | one `config/models.json` entry |
| `ModelsConfigSchema` | `:99-101` | `{ models: [...] }` |
| `EnvConfigSchema` | `:122-170` | gateway env incl. pacer/cooldown/GCP/Zen toggles |

All schemas and their inferred types are re-exported from `src/lib.ts:3-25`.

---

## 6. Edit → `POST /reset` hot-reload workflow

1. Edit `config/fusion.json` or `config/providers.json` (`config/models.json` is legacy advertisement-only for `/v1/models` — see §2; editing it never affects serving)
   on disk (JSON only — never `.env` / `.env.local`, never `src/` for a config
   change).
2. Reload state: `POST /reset` (also reachable via `GET /reset`; both map to
   `handleHardReset` through `SYSTEM_MAP` in `src/index.ts:158-163`).
   Per-provider pool-only reset (no config reload):
   `POST /admin/pool/reset` → `handleAdminPoolReset` (`src/index.ts:81`).
3. `handleHardReset()` (`src/index.ts:61-79`) runs, in order:
   `globalCooldownManager.clearAll()` → `globalKeyPool.reset()` →
   `initializeKeyPools()` → `clearCircuitBreakerRegistry()` →
   `clearPacerRegistry()` → `resetHttp2Pool()` →
   `resetProvidersRegistryCache()` (drops the cached `config/providers.json`) →
   `loadAndCacheNativeChains()` (re-reads `native_chains`) →
   `resetNativeFlashTierIndex()` (clears `nativeTierIndices`).
   It returns `{ status: "ok", message: "Hard reset successful. ...",
   timestamp }` with HTTP 200.
4. Verify: `GET /health` (same file `:126-144`) and
   `bun run scripts/doctor.ts` for key validation.

Cache cheat-sheet (which edits need the reset):

| file / section | cached? | reload mechanism |
|---|---|---|
| `fusion.json` → `presets` | no — re-read per fusion request (`loadFusionConfig`, `src/handlers/openai_compat.ts:882`) | effective immediately |
| `fusion.json` → `native_chains` | yes — `cachedNativeChains` (`src/handlers/google_native.ts:49`) | `POST /reset` |
| `providers.json` | yes — `cachedRegistry` (`src/handlers/openai_compat.ts:69`) | `POST /reset` |
| `models.json` (legacy, advertisement-only) | no — re-read per `/v1/models` request (`loadCatalogModels`, `src/handlers/discovery.ts:38`) | effective immediately; `POST /reset` not required |

The same reset sequence is available in-process as `resetAllState()`
(`src/index.ts:411-421`, re-exported from `src/lib.ts:49-54`) for tests.
