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
        "apiKey": "lr-or-cl-ms-dp"
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

---

## 4. Reasoning Stream Filter & Context Bloat Shield (Option 1B)

### The Problem: SQLite Reasoning Accumulation
In OpenCode 2 beta, streaming `delta.reasoning` / `delta.reasoning_content` SSE chunks received from reasoning models (e.g. DeepSeek-R1, Qwen-Thinking, Dots, Gemini) are accumulated into OpenCode's local SQLite session tables. On subsequent agent turns, OpenCode re-injects this raw reasoning history back into the request payload as prior assistant messages. Within a few turns, prompt size balloons from ~40K tokens to over 300K+ tokens, incurring severe latency penalties and hitting model context limits.

### The Solution: Gateway-Level Transparent Stream Stripping
LiteRouter implements **Option 1B: Gateway-Level Automatic Reasoning Stream Stripping**:
1. **Automatic Client Detection**: Detects inbound requests with `User-Agent: opencode*`, `x-opencode` header, or `x-client-name: opencode*`.
2. **SSE Stream Transformer (`createOpenCodeReasoningFilterStreamTransformer`)**: For OpenCode clients, LiteRouter intercepts downstream SSE streams and strips `delta.reasoning` and `delta.reasoning_content` in real time.
3. **Empty Chunk Suppression**: SSE chunks containing only reasoning deltas are suppressed entirely, preventing unnecessary empty SSE events downstream.
4. **Preserved Fields**: LiteRouter strictly preserves `delta.content`, `delta.role`, `delta.tool_calls`, `finish_reason`, and final `usage` chunks.
5. **Non-Streaming Sanitization**: Strips `reasoning` and `reasoning_content` from non-streaming JSON choice bodies and message objects.
6. **SDK Preservation**: Non-OpenCode clients (such as Pydantic AI, OpenAI Python SDK, curl) receive unmodified reasoning streams, ensuring observability for external orchestration.

### Directive Override Nuance (`ts` vs `sb`)
- **Enable Thinking for OpenCode (`ts`)**: If you explicitly want thinking output visible in OpenCode, use the `ts` (Thinking Support) directive nuance (e.g., `lr-or-oa-ch-ts`). This disables the OpenCode filter and passes raw reasoning deltas downstream.
- **Force Strip Reasoning (`sb`)**: If you want to force reasoning stripping regardless of client (e.g. for curl or external scripts), use the `sb` (Strip Budget / Reasoning) nuance (e.g., `lr-or-oa-ch-sb`).
