# LiteRouter

**LiteRouter** is a high‑performance, minimal API key load balancer and router built with [Bun](https://bun.sh/). It is designed to be a stripped‑down, resource‑efficient alternative to complex routing solutions, focusing on one thing: **deterministic round‑robin rotation across multiple API keys**.

---

## 🚀 New Features (v0.1.0)

### 1. Robust Configuration Validation
- **`src/validateConfig.ts`** validates `config.json` against a Zod schema.
- Enforces required fields (`openrouter.baseUrl`, `openrouter.apiKeys`, etc.) and provides path‑specific error messages.
- Exits with status 0 on success or 1 with detailed diagnostics on failure, making it CI‑friendly.

### 2. Persistent Round‑Robin Counter
- **`src/counter.ts`** stores the rotation index in `counter.json`.
- The counter survives server restarts, ensuring perfect even distribution across restarts.
- File‑level lock (`acquireLock` / `releaseLock`) guarantees atomic increments under concurrent requests.

### 3. Concurrency‑Safe Counter Updates
- Modified **`src/router.ts`** to use the persisted counter and lock around increments.
- Prevents race conditions that could cause skipped keys or duplicate selections under high load.

### 4. Comprehensive Unit Tests
- **`src/router.test.ts`** covers:
  - Deterministic round‑robin key distribution across restarts.
  - Proper skipping of dead‑quarified keys after 401/403 errors.
  - Accuracy of `getRouterStatus` reporting.

### 5. Structured Logging & Error Handling
- Enhanced error handling for 429 (rate‑limit) and 401/403 (invalid key) responses.
- Logs cooldown timers and quarantine actions with clear, searchable messages.

---

## 📂 Project Structure

- `src/server.ts` – Bun HTTP server that receives requests and forwards them to OpenRouter endpoints.
- `src/router.ts` – Core round‑robin load balancer, error handling, and status diagnostics.
- `src/config.ts` – Parses and validates configuration from `config.json`.
- `src/test.ts` – Utility for testing upstream API keys and model validation.
- `src/doctor.ts` – CLI health‑check tool for config and server diagnostics.
- `src/counter.ts` – Persistent counter implementation.
- `src/validateConfig.ts` – Configuration validation utilities.

---

## ⚙️ Configuration

Create a `config.json` file in the root directory (use `config.example.json` as a template). Example:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 7766,
    "authKey": "sk-lr-8f2a9e3b1c4d7e5f"
  },
  "openrouter": {
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKeys": [
      "<REDACTED_HISTORICAL_OPENROUTER_KEY_2>",
      "<REDACTED_HISTORICAL_OPENROUTER_KEY_1>"
    ]
  },
  "models": {
    "code": {
      "provider": "nvidia/bf16",
      "model": "nvidia/nemotron-3-nano-30b-a3b:free"
    },
    "chat": {
      "provider": "arcee-ai/prime",
      "model": "arcee-ai/trinity-large-preview:free"
    }
  }
}
```

---

## 🚀 Usage

### Start the Server
```bash
bun start
```

### Run Diagnostics
```bash
bun run doctor
```

### Test Upstream Keys
```bash
bun run preflight
```

### Debug Mode (verbose payload logging)
```bash
bun run debug
```

---

## 📄 License

MIT
