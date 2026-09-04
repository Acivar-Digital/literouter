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

Live API keys are provided as comma-separated lists:

```env
OPENROUTER_API_KEYS=sk-or-v1-key1...,sk-or-v1-key2...
NVIDIA_API_KEYS=nvapi-key1...,nvapi-key2...
ZEN_API_KEYS=sk-zen-key1...,sk-zen-key2...
GOOGLE_API_KEYS=AIzaSyKey1...,AIzaSyKey2...
```

---

## 3. Upstream Provider Registry (`config/providers.json`)

`config/providers.json` defines supported upstream providers and their endpoint routing templates:

```json
{
  "providers": {
    "openrouter": {
      "code": "or",
      "base_url": "https://openrouter.ai",
      "auth_header": "Bearer",
      "endpoints": {
        "ch": "/api/v1/chat/completions",
        "ms": "/api/v1/messages",
        "em": "/api/v1/embeddings",
        "md": "/api/v1/models"
      }
    },
    "nvidia": {
      "code": "nv",
      "base_url": "https://integrate.api.nvidia.com",
      "auth_header": "Bearer",
      "endpoints": {
        "ch": "/v1/chat/completions",
        "em": "/v1/embeddings",
        "md": "/v1/models"
      }
    },
    "google": {
      "code": "gg",
      "base_url": "https://generativelanguage.googleapis.com",
      "auth_header": "Bearer",
      "endpoints": {
        "ob": "/v1beta/openai/chat/completions",
        "gc": "/v1beta/models/{model}:generateContent",
        "em": "/v1beta/models/{model}:embedContent",
        "md": "/v1beta/models"
      }
    },
    "zen": {
      "code": "zn",
      "base_url": "https://opencode.ai/zen",
      "auth_header": "Bearer",
      "endpoints": {
        "ch": "/v1/chat/completions",
        "md": "/v1/models"
      }
    }
  }
}
```

---

## 4. Key Pool Validation Rules (`src/config/keys.ts`)

During gateway boot, `staticValidateKeys` parses and filters key pools:
1. **Placeholder Rejection**: Discards keys containing `changeme`, `placeholder`, `your_key`, `todo`, `xxxx`.
2. **Angle Bracket Rejection**: Discards keys containing `<` or `>`.
3. **Length Verification**: Discards keys shorter than 10 characters.
4. **Resilient Mock Key Loading**: If a key pool is empty during unit tests, test stubs (`sk-stub-<provider>-mock-key-1`) are injected safely to preserve test suite integrity without hitting live APIs.

---

## 5. TLS Certificate Setup

LiteRouter supports automatic TLS on port `7766` when certificate files exist:
- Certificate: `certs/localhost.pem`
- Private Key: `certs/localhost-key.pem`

If certificate files are absent, LiteRouter falls back cleanly to cleartext HTTP on `http://localhost:7766`.
