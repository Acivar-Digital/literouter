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
| `LITEROUTER_TLS_ENABLED` | `true` | Enables TLS on port 7766 using certificates in `certs/localhost.pem`. |
| `LITEROUTER_HTTP2` | `true` | Enables dual HTTP/2 (`h2`) ALPN and HTTP/1.1 TLS negotiation on port 7766. |
| `LITEROUTER_AUTH_KEY` | `""` (disabled) | Optional master gateway auth key. When omitted, declarative directive keys are used directly. |
| `LITEROUTER_HTTP_TIMEOUT_MS` | `300000` | Upstream total HTTP request timeout in milliseconds (5 minutes). |
| `LITEROUTER_NO_RESPONSE_TIMEOUT_MS` | `5000` | First-byte response / TTFT guard timeout (5 seconds). |
| `LITEROUTER_STREAM_IDLE_TIMEOUT_MS` | `30000` | Max idle time allowed between streamed tokens (30 seconds). |
| `LITEROUTER_ROTATE_DELAY_MS` | `2000` | Inter-key rotation delay upon rate limits or errors. |
| `LITEROUTER_STRIP_REASONING` | `true` | Global default to strip upstream reasoning from historical messages (overridden by `ts` nuance). |
| `LITEROUTER_AO_STRIP_REASONING` | `true` | Standard default for `ao` (Anthropic->OpenAI cross-wire) to strip reasoning parameters and prevent empty compaction responses in Claude Code (overridden by `ts` nuance). |
| `GCP_ENABLE_RETRIES` | `true` | When `true`, enables in-flight key rotation on 429/5xx for GCP (`gc`). When `false`, enables single-flight pass-through mode, passing errors downstream immediately. |
| `GCP_ENABLE_QUARANTINE` | `true` | When `true`, enables key quarantine/cooldown on errors for GCP (`gc`). When `false`, bypasses all quarantine and cooldowns, turning LiteRouter into a dumb forwarder for GCP keys. |

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
