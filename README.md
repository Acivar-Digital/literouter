# 🚀 LiteRouter

**LiteRouter** is a high-performance, minimal API key load balancer and router built with [Bun](https://bun.sh/). It is designed to be a stripped-down, resource-efficient alternative to complex routing solutions, focusing on one thing: **deterministic round-robin rotation across multiple API keys.**

---

## ✨ Features

- **Performance First**: Zero lag, minimal resource footprint. Written in TypeScript for Bun.
- **Deterministic Round-Robin**: Perfectly even distribution across your API keys. No complicated scoring—just reliable rotation.
- **Resilient Error Handling**:
  - **429 (Rate Limit)**: Automatically cools down the key for 60 seconds.
  - **401/403 (Invalid Key)**: Quarantines dead keys permanently for the duration of the process.
- **OpenAI Compatible**: Seamlessly integrates with Cursor, Continue, and any other OpenAI-compatible IDE/client.
- **Multi-Model Aliasing**: Define semantic aliases like `code`, `chat`, `light`, or `large` in `config.json` to map transparently to dedicated providers and backend models, removing IDE switching completely!
- **Transparent Parameter Passthrough**: Accurately propagates `temperature`, thinking parameters, and stream commands dictated by your IDE without interfering or overriding them.
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
    "authKey": "your-secret-router-key"
  },
  "openrouter": {
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKeys": [
      "sk-or-v1-key1",
      "sk-or-v1-key2"
    ]
  },
  "models": {
    "code": {
      "provider": "arcee-ai/bf16",
      "model": "arcee-ai/trinity-mini:free:online"
    },
    "chat": {
      "provider": "anthropic/claude-3-haiku",
      "model": "anthropic/claude-3-haiku"
    },
    "light": {
      "provider": "meta-llama/llama-3-8b-instruct",
      "model": "meta-llama/llama-3-8b-instruct"
    },
    "large": {
      "provider": "anthropic/claude-3-opus",
      "model": "anthropic/claude-3-opus"
    }
  }
}
```

### Configuration Options

| Option | Description |
| :--- | :--- |
| `server.host` | The IP address for LiteRouter to listen on. |
| `server.port` | The port for LiteRouter to listen on. |
| `server.authKey` | Bearer token to protect your LiteRouter endpoint. |
| `openrouter.baseUrl` | OpenRouter API base URL (`/chat/completions` payload destination). |
| `openrouter.apiKeys` | List of OpenRouter API keys to round-robin against. |
| `models.[alias]` | Semantic alias maps (like `code` or `chat`). |
| `models.[alias].provider` | Injects the specific fallback OpenRouter provider string (e.g. `"arcee-ai/bf16"`). |
| `models.[alias].model` | Overrides the model requested by the IDE with this explicit backend model string. |

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

- `src/server.ts`: The Bun-powered HTTP server. Translates IDE requests onto explicitly mapped OpenRouter `models`.
- `src/router.ts`: The core round-robin load-balancer and error-handling quarantine engine.
- `src/config.ts`: Parsing and validation engine resolving `config.json`.
- `src/test.ts`: Independent testing utility for upstream API keys and `model` validation.
- `src/doctor.ts`: Holistic CLI health-check and configuration diagnosis tool.

---

## 🎯 Routing Policy

LiteRouter follows a strict deterministic approach. For $N$ alive keys, the $i$-th request uses key $(i \pmod N)$. If a key fails with a 429, it is skipped until the cooldown expires. If it fails with a 401/403, it is removed from the rotation entirely.

---

## 📄 License

MIT
