# 🚀 LiteRouter

**LiteRouter** is a high-performance, minimal API key load balancer and router built with [Bun](https://bun.sh/). It is designed to be a stripped-down, resource-efficient alternative to complex routing solutions, focusing on one thing: **deterministic round-robin rotation for a single base URL with multiple API keys.**

---

## ✨ Features

- **Performance First**: Zero lag, minimal resource footprint. Written in TypeScript for Bun.
- **Deterministic Round-Robin**: Perfectly even distribution across your API keys. No complicated scoring—just reliable rotation.
- **Resilient Error Handling**:
  - **429 (Rate Limit)**: Automatically cools down the key for 60 seconds.
  - **401/403 (Invalid Key)**: Quarantines dead keys permanently for the duration of the process.
- **OpenAI Compatible**: Seamlessly integrates with Cursor, Continue, and any other OpenAI-compatible IDE/client.
- **Provider Templates**: Swappable templates for OpenRouter and Gemini (Google Native). Each template handles request/response translation and thinking/reasoning params automatically.
- **Google Native Bridge**: The Gemini template uses Google's native REST API (`generateContent`) and translates everything to/from OpenAI format—no more "Unknown field" errors.
- **Streaming by Default**: LiteRouter automatically assumes `stream: true` unless explicitly overridden by the client.
- **Modern Configuration**: Uses a structured `config.json` with per-provider sections and per-template API keys.
- **Smart Parameter Injection**: Effortlessly inject `temperature`, `thinkingMode` (high/medium/low), and provider-specific routing into every request.
- **Model-Aware Thinking**: Automatically uses `thinking_budget` for Gemini 2.5 models and `thinking_level` for Gemini 3+ models.
- **Built-in Diagnostics**: Comes with `doctor` and `preflight` tools to validate your setup instantly.

---

## 🛠 Installation

确保你已经安装了 [Bun](https://bun.sh/).

```bash
# Clone the repository
git clone <your-repo-url>
cd literouter

# Install dependencies
bun install
```

---

## ⚙️ Configuration

Create a `config.json` file in the root directory. Use `config.example.json` as a base.

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 7766,
    "authKey": "your-secret-router-key",
    "template": "openrouter"
  },
  "openrouter": {
    "provider": "arcee-ai/bf16",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "arcee-ai/trinity-mini:free",
    "temperature": 0.3,
    "thinkingMode": "medium",
    "apiKeys": [
      "sk-or-v1-key1",
      "sk-or-v1-key2"
    ]
  },
  "gemini": {
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
    "model": "gemini-2.5-flash",
    "temperature": 0.1,
    "thinkingMode": "medium",
    "apiKeys": [
      "AIzaSy-keyA",
      "AIzaSy-keyB"
    ]
  }
}
```

### Configuration Options

| Option | Description |
| :--- | :--- |
| `server.host` | The IP address for LiteRouter to listen on. |
| `server.port` | The port for LiteRouter to listen on. |
| `server.authKey` | Bearer token to protect your LiteRouter endpoint. |
| `server.template` | Active provider template: `"openrouter"` or `"gemini"`. |
| `openrouter.provider`| **Strict Routing**: Passes the exact provider string (e.g. `"arcee-ai/bf16"`) to OpenRouter's routing logic. |
| `openrouter.baseUrl` | OpenRouter API base URL. |
| `openrouter.model` | Model name for OpenRouter. **Aliased as `code`.** |
| `openrouter.temperature`| Fixed temperature for OpenRouter requests. |
| `openrouter.thinkingMode`| Maps `high`/`medium`/`low` to `reasoning.effort`. |
| `gemini.baseUrl` | Gemini **native** REST API base URL (no `/openai` suffix). |
| `gemini.model` | Model name for Gemini. **Aliased as `code`.** |
| `gemini.temperature` | Fixed temperature for Gemini requests. |
| `gemini.thinkingMode` | `high`/`medium`/`low` — auto-maps to `thinking_budget` (2.5) or `thinking_level` (3+). |
| `[template].apiKeys` | List of API keys for the specific template. Each template uses its own keys. |

### Provider Templates

Templates handle the structural differences in how providers expect their specific parameters:

| Template | Feature | How it works |
| :--- | :--- | :--- |
| **OpenRouter** | Transport | OpenAI-compatible passthrough to `baseUrl/chat/completions` |
| **OpenRouter** | Thinking | Injects `{ "reasoning": { "effort": "high" } }` |
| **OpenRouter** | Provider | Injects `{ "provider": { "order": ["arcee-ai/bf16"] } }` |
| **OpenRouter** | Auth | Standard `Authorization: Bearer <key>` header |
| **Gemini** | Transport | Full translation: OpenAI ↔ Native REST (`generateContent` / `streamGenerateContent`) |
| **Gemini** | Message Logic| **Auto-Role Merging**: Merges consecutive same-role messages (Google requirement) |
| **Gemini** | Thinking (2.5) | Injected as `thinking_budget` (token count) |
| **Gemini** | Thinking (3+) | Injected as `thinking_level` (high/medium/low) |
| **Gemini** | Auth | API key via `?key=` query parameter (strips Bearer header) |
| **Gemini** | System Prompt | Automatically extracted to native `systemInstruction` field |
| **Gemini** | Stream | Emits standard `finish_reason: "stop"` and `data: [DONE]` on close |

To switch providers, just change `server.template` in your config — no code changes needed.

---

## 🚀 Usage

### Start the Server
```bash
bun start
```

### Stop / Restart
```bash
bun stop       # Kill the server on port 7766
bun restart    # Kill and restart in one command
```

### Run Diagnostics
```bash
# Full system check (Config + Upstream Keys + Server Health)
bun run doctor

# Quick upstream key check
bun run preflight
```

### Debug Mode
```bash
bun run debug  # Starts with verbose payload logging
```

---

## 📂 Project Structure

- `src/server.ts`: The Bun-powered HTTP server. Handles OpenAI-compatible endpoints and stream translation.
- `src/router.ts`: The core round-robin and error-handling logic.
- `src/config.ts`: Configuration loader for `config.json` with template-specific API key resolution.
- `src/templates/`: Provider template directory.
  - `types.ts`: Shared type definitions (supports URL overrides, request/response transformers, header customization).
  - `index.ts`: Template registry and factory.
  - `openrouter.ts`: OpenRouter reasoning and provider routing injection.
  - `gemini.ts`: Google Native REST bridge — full OpenAI ↔ Gemini translation (request, streaming chunks, responses).
- `src/test.ts`: Independent testing utility for upstream API keys.
- `src/doctor.ts`: Holistic health-check tool.
- [`docs/routing.md`](file:///Users/yapilymm/Downloads/projects/literouter/docs/routing.md): Detailed explanation of the deterministic distribution logic.

---

## 🎯 Routing Policy

LiteRouter follows a strict deterministic approach. For $N$ alive keys, the $i$-th request uses key $(i \pmod N)$. If a key fails with a 429, it is skipped until the cooldown expires. If it fails with a 401/403, it is removed from the rotation entirely.

---

## 📄 License

MIT
