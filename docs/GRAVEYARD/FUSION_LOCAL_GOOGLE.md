# 🪦 Fusion Group `local/google` — Removed

* **Status**: 🪦 **Removed (2026-07-17)**
* **What it was**: A fusion group routing OpenCode's native `/v1beta` requests through a Google priority chain:
  `google/gemma-4-31b-it` → `google/gemini-3.1-flash-lite` → `google/gemma-4-26b-a4b-it`, forwarded to `http://localhost:7766/v1beta` (Google native `generateContent`).
* **Why removed**: The native `/v1beta` fusion path is a **dumb forwarder** — it passes the raw OpenAI-format request body (`{stream, messages}`) straight to Google's `generateContent` endpoint, which expects a Gemini `contents` payload. Every request failed with `400 INVALID_ARGUMENT: Unknown name "stream" / "messages"`. The chain's first hop halted on a client error (400) and never advanced. Effectively `local/google` was **never functional** through the native path.
* **Decision**: Remove the `local/google` group from `fusion.json` and all references. OpenCode native traffic should use a directly-routed Google model (e.g. `google/gemini-3.1-flash-lite`) rather than a fusion chain that requires body translation the native forwarder does not perform.
* **Related**: `pydantic/google` uses the OpenAI-compat `/v1` upstream (which DOES translate to Gemini format) and shares the same first-hop model — verify that chain separately before relying on it.
* **If revived**: A native `/v1beta` fusion group needs body translation (OpenAI `messages` → Gemini `contents`) inside `executeFusion`, not a dumb forward. That is a feature, not a config entry.
