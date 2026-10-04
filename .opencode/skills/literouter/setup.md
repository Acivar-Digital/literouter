# LiteRouter Technical Configuration & Setup Guide (v3.1 / v3.2)

This document is the definitive configuration manual for **LiteRouter**, the Bun/TypeScript AI gateway running on port `7766`.

---

## 1. Configuration Files Architecture

LiteRouter utilizes a layered configuration architecture separated into environment variables and declarative JSON schemas:

```
literouter/
├── .env.local             # [ROOT-PROTECTED] Live upstream secret API keys (Git-ignored)
├── .env                   # [TRACKED] Operational timeouts, port, and gateway knobs
├── config/
│   ├── providers.json     # Upstream provider definitions, endpoints, and base URLs
│   ├── models.json        # Upstream model metadata, capabilities, context limits
│   └── fusion.json        # Fusion presets and tiered failover hierarchies
└── certs/
    ├── localhost.pem      # TLS certificate
    └── localhost-key.pem  # TLS private key
```

---

## 2. Environment Variables Reference

### Runtime Knobs (`.env`)

| Variable | Default Value | Description |
|---|---|---|
| `LITEROUTER_PORT` | `7766` | Listening port for the Bun gateway server. |
| `LITEROUTER_TLS_ENABLED` | `false` (schema) / `true` (`.env`) | Enables TLS on port 7766 using certificates in `certs/localhost.pem`. Schema default is `false` (`src/config/schema.ts:197`); tracked `.env:98` sets `true`. |
| `LITEROUTER_HTTP2` | `false` (schema) / `true` (`.env`) | Enables dual HTTP/2 (`h2`) ALPN and HTTP/1.1 TLS negotiation on port 7766. Schema default is `false` (`src/config/schema.ts:198`), but `DEFAULT_ENV_RECORD` in `src/config/env.ts:8` and tracked `.env:99` both set `true`. |
| `LITEROUTER_AUTH_KEY` | `""` (disabled) | Optional master gateway auth key. When omitted, declarative directive keys are used directly. |
| `LITEROUTER_HTTP_TIMEOUT_MS` | `300000` | Upstream total HTTP request timeout in milliseconds (5 minutes). Schema default `300000` (`src/config/schema.ts:206`); tracked `.env` sets the legacy `LITEROUTER_HTTP_TIMEOUT=300` (seconds), normalized to `300000` by `src/config/env.ts:54-57`. |
| `LITEROUTER_NO_RESPONSE_TIMEOUT_MS` | `120000` | First-byte response / TTFT guard timeout. Schema default `120000` (`src/config/schema.ts:204`), hardcoded module default `TTFT_TIMEOUT_MS = 120000` (`src/network/fetcher.ts:61`), resolved per-request by `src/engine/dispatch.ts:192-196` and `src/network/fetcher.ts:637-638`. Tracked `.env` sets the non-`_MS` legacy alias `LITEROUTER_NO_RESPONSE_TIMEOUT=180` (seconds), normalized to `180000` by `src/config/env.ts:62-65`; the alias also seeds `LITEROUTER_TTFT_TIMEOUT_MS` when that is unset (`src/config/env.ts:66-71`). |
| `LITEROUTER_STREAM_IDLE_TIMEOUT_MS` | `120000` | Max idle time allowed between streamed tokens. Schema default `120000` (`src/config/schema.ts:205`), module fallback `STREAM_IDLE_TIMEOUT_MS = 120000` (`src/network/fetcher.ts:62`), consumed at `src/network/fetcher.ts:1034`. Tracked `.env` sets the non-`_MS` legacy alias `LITEROUTER_STREAM_IDLE_TIMEOUT=180` (seconds), normalized to `180000` by `src/config/env.ts:50-53`. |
| `LITEROUTER_ROTATE_DELAY_MS` | *(no schema default)* | Inter-key rotation delay. Not part of `EnvConfigSchema` (`src/config/schema.ts:193-230`) and **not read anywhere under `src/`** — it is a legacy knob. Tracked `.env` sets it to `100` (env-overridden, not a code default). |
| `LITEROUTER_STRIP_REASONING` | `false` (schema) / `true` (`.env`) | Global default to strip upstream reasoning from historical messages (overridden by `ts` nuance). Schema default `false` (`src/config/schema.ts:199`); tracked `.env:17` sets `true`. |
| `LITEROUTER_AO_STRIP_REASONING` | `true` | Standard default for `ao` (Anthropic->OpenAI cross-wire) to strip reasoning parameters and prevent empty compaction responses in Claude Code (overridden by `ts` nuance). Schema default `true` (`src/config/schema.ts:200`). |
| `GCP_ENABLE_RETRIES` | `true` (legacy) | **Legacy knob — not read anywhere under `src/`.** Provider retry behaviour is governed declaratively by `config/providers.json` → `request_retry` (see `config-schemas.md` §3.6). Tracked `.env:52` sets `false`. |
| `GCP_ENABLE_QUARANTINE` | `true` (legacy) | **Legacy knob — not read anywhere under `src/`.** Provider quarantine is governed declaratively by `config/providers.json` → `key_cooldown`. Tracked `.env:53` sets `false`. |

### Secret Upstream Key Pools (`.env.local`)

> Single source of truth: key pools and boot validation live in `architecture.md` §2 (`src/config/keys.ts`); JSON schemas live in `config-schemas.md`. Live API keys are comma-separated lists — never paste real keys here.

---

## 3. Upstream Provider Registry (`config/providers.json`)

> Single source of truth: `config-schemas.md` §3. Fusion presets on disk are `quad`, `pydn`, `fast`, `deep` (see `config-schemas.md` §1); `FUSION_UPSTREAM_URL` is a legacy Python fusion-sidecar env var, not a gateway constant (see `config-schemas.md` §4).

---

## 4. Key Pool Validation Rules (`src/config/keys.ts`)

> Single source of truth: `architecture.md` §2.3 (`staticValidateKeys` in `src/config/keys.ts`).

---

## 5. TLS Certificate Setup

LiteRouter supports automatic TLS on port `7766` when certificate files exist:
- Certificate: `certs/localhost.pem`
- Private Key: `certs/localhost-key.pem`

If certificate files are absent, LiteRouter falls back cleanly to cleartext HTTP on `http://localhost:7766`.
