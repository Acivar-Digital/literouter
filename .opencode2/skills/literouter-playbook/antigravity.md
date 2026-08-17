# Antigravity Remote Gateway & Proxy Integration (v3.1 / v3.2)

This guide documents the integration of remote Antigravity services (`agy-gemini`, `agy-claude`) and Google Native RPC routing through LiteRouter.

---

## 1. Antigravity Remote Service Overview

Antigravity services operate across remote ZeroTier nodes (e.g. `10.32.34.243:8045`) providing high-throughput agent models:
- **`agy-gemini`**: `@ai-sdk/google` adapter on `http://10.32.34.243:8045/v1beta`
- **`agy-claude`**: `@ai-sdk/anthropic` adapter on `http://10.32.34.243:8045/v1`

---

## 2. OpenCode Configuration

In `~/.config/opencode2/opencode.json`:

```json
{
  "provider": {
    "agy-gemini": {
      "npm": "@ai-sdk/google",
      "name": "Antigravity Gemini",
      "options": {
        "baseURL": "http://10.32.34.243:8045/v1beta",
        "apiKey": "sk-antigravity"
      },
      "models": {
        "gemini-3.1-pro-low": {
          "name": "AG Gemini 3.1 Pro Low",
          "limit": { "context": 200000, "output": 65535 }
        },
        "gemini-pro-agent": {
          "name": "AG Gemini 3.1 Pro High",
          "limit": { "context": 200000, "output": 65535 }
        }
      }
    },
    "agy-claude": {
      "npm": "@ai-sdk/anthropic",
      "name": "Antigravity Claude",
      "options": {
        "baseURL": "http://10.32.34.243:8045/v1",
        "apiKey": "sk-antigravity"
      },
      "models": {
        "claude-sonnet-4-6": {
          "name": "AG Claude Sonnet 4.6",
          "limit": { "context": 200000, "output": 65535 }
        }
      }
    }
  }
}
```

---

## 3. LiteRouter Local Google Routing (`lr-gg`)

For local rotating Google Gemini keys:
- **OpenAI-Compat Beta**: `https://localhost:7766/v1` with `apiKey: "lr-gg-oa-ob-gm"`
- **Native RPC (`:generateContent`)**: `https://localhost:7766/v1beta` with `apiKey: "lr-gg-gg-gc-gm"`
- **Turn Merging & Gemma Nuance (`gm`)**: Merges consecutive turns and strips unsupported parameters before forwarding to Google.
