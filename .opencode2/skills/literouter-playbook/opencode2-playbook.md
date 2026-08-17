---
name: opencode2-playbook
description: OpenCode 2 (Next/Beta) integration, deployment, and declarative provider configuration for LiteRouter.
---

# OpenCode 2 (V2) Playbook for LiteRouter

This playbook documents the environment isolation, TLS connectivity, and declarative provider configuration for running **OpenCode 2** against LiteRouter's HTTPS gateway on port `7766`.

---

## 1. Physical Isolation Architecture

OpenCode 1 and OpenCode 2 run side-by-side with complete directory and socket isolation:

| Dimension | OpenCode 1 (Stable) | OpenCode 2 (Next / Beta) |
|---|---|---|
| **CLI Command** | `opencode` | `opencode2` |
| **Global Config Root** | `~/.config/opencode/` | `~/.config/opencode2/` |
| **XDG Config Root** | `~/.config` | `~/.config/opencode2_xdg` (symlinked to `~/.config/opencode2`) |
| **XDG Data Root** | `~/.local/share/opencode` | `~/.local/share/opencode2` |
| **XDG State Root** | `~/.local/state/opencode` | `~/.local/state/opencode2` |
| **XDG Cache Root** | `~/.cache/opencode` | `~/.cache/opencode2` |
| **Root CA File** | N/A (plain HTTP) | `~/.local/share/opencode2/mkcert/rootCA.pem` |

---

## 2. Declarative Provider Configuration (`~/.config/opencode2/opencode.json`)

OpenCode 2 connects to LiteRouter on `https://localhost:7766/v1` using declarative directive keys:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": true,
  "plugin": [],
  "provider": {
    "lr-dots": {
      "npm": "@ai-sdk/anthropic",
      "name": "LR-DOTS (LiteRouter Dots Anthropic)",
      "options": {
        "baseURL": "https://localhost:7766/v1",
        "apiKey": "lr-or-cl-ch-dp"
      },
      "models": {
        "dots-studio/dots-3-note-preview:free": {
          "name": "Dots 3 Note Preview Free (Anthropic)",
          "limit": {
            "context": 512000,
            "output": 512000
          }
        }
      }
    },
    "lr-or": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LR-OR (LiteRouter OpenRouter)",
      "options": {
        "baseURL": "https://localhost:7766/v1",
        "apiKey": "lr-or-oa-ch-no",
        "chunkTimeout": 120000
      },
      "models": {
        "liquid/lfm-2.5-2.6b:free": {
          "name": "LFM 2.5 2.6B Free",
          "limit": {
            "context": 128000,
            "output": 65536
          }
        }
      }
    },
    "lr-nv": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LR-NV (LiteRouter Nvidia)",
      "options": {
        "baseURL": "https://localhost:7766/v1",
        "apiKey": "lr-nv-oa-ch-no",
        "chunkTimeout": 120000
      },
      "models": {
        "meta/llama-3.1-8b-instruct": {
          "name": "Llama 3.1 8B Instruct",
          "limit": {
            "context": 131072,
            "output": 16384
          }
        },
        "meta/llama-3.1-70b-instruct": {
          "name": "Llama 3.1 70B Instruct",
          "limit": {
            "context": 131072,
            "output": 16384
          }
        }
      }
    },
    "lr-zn": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LR-ZN (LiteRouter Zen)",
      "options": {
        "baseURL": "https://localhost:7766/v1",
        "apiKey": "lr-zn-oa-ch-no",
        "chunkTimeout": 120000
      },
      "models": {
        "hy3-free": {
          "name": "HY3 Free",
          "limit": {
            "context": 200000,
            "output": 65536
          }
        }
      }
    },
    "lr-gg": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LR-GG (LiteRouter Google)",
      "options": {
        "baseURL": "https://localhost:7766/v1",
        "apiKey": "lr-gg-oa-ob-gm",
        "chunkTimeout": 120000
      },
      "models": {
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash",
          "limit": {
            "context": 1048576,
            "output": 65535
          }
        }
      }
    }
  },
  "model": "lr-dots/dots-studio/dots-3-note-preview:free",
  "small_model": "lr-dots/dots-studio/dots-3-note-preview:free"
}
```

---

## 3. Testing OpenCode 2 Models

Use `scripts/test_opencode2_models.sh` to run non-interactive verification across active models:

```bash
bash scripts/test_opencode2_models.sh
```
