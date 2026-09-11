# Antigravity IDE Setup & Local Proxy Configuration (v4.0)

This document provides operational setup instructions for running Google Antigravity IDE alongside LiteRouter in WSL2 / Linux environments without root or sudo permissions.

---

## 1. Antigravity IDE Architecture

Antigravity IDE runs in user space under `~/.local/opt/antigravity-ide` or `/opt/antigravity-ide` and connects to local or remote language model endpoints.

---

## 2. Connecting Antigravity IDE to LiteRouter

To route completions from Antigravity IDE through LiteRouter over HTTP/2 on `https://localhost:7766`:

1. Set OpenAI-compatible endpoint in IDE settings:
   - **Base URL:** `https://localhost:7766/v1`
   - **API Key:** `lr-or-ao-ch-dp` (or `lr-or-oa-ch-no` for OpenRouter models, `lr-nv-oa-ch-no` for NVIDIA models, `lr-gg-oa-ob-no` for Google OpenAI-compat)
   - **Model:** Target model verbatim (e.g. `dots-studio/dots-3-note-preview:free`, `deepseek-ai/deepseek-r1`)

2. For Google Native RPC endpoints (`:generateContent`):
   - **Base URL:** `https://localhost:7766/v1beta`
   - **API Key:** `lr-gg-gg-gc-no`
   - **Model:** `gemini-flash` or `gemini-flash-lite`

3. For Anthropic Claude endpoints:
   - **Base URL:** `https://localhost:7766/v1`
   - **API Key:** `lr-or-cl-ms-dp` (or `lr-or-ao-ch-dp`)
   - **Model:** `dots-studio/dots-3-note-preview:free`

---

## 3. Verifying Connectivity

Verify connectivity over HTTP/2 with curl:
```bash
curl -sk --http2 -X POST https://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer lr-or-ao-ch-dp" \
  -H "Content-Type: application/json" \
  -d '{"model": "dots-studio/dots-3-note-preview:free", "messages": [{"role": "user", "content": "ping"}], "max_tokens": 10}'
```
Expected response: HTTP `200 OK` with JSON completion payload.
