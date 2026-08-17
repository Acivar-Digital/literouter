# Antigravity IDE Setup & Local Proxy Configuration (v3.1 / v3.2)

This document provides operational setup instructions for running Google Antigravity IDE alongside LiteRouter in WSL2 / Linux environments without root or sudo permissions.

---

## 1. Antigravity IDE Architecture

Antigravity IDE runs in user space under `~/.local/opt/antigravity-ide` or `/opt/antigravity-ide` and connects to local or remote language model endpoints.

---

## 2. Connecting Antigravity IDE to LiteRouter

To route completions from Antigravity IDE through LiteRouter on `https://localhost:7766`:

1. Set OpenAI-compatible endpoint in IDE settings:
   - **Base URL:** `https://localhost:7766/v1`
   - **API Key:** `lr-nv-oa-ch-no` (for NVIDIA models) or `lr-or-oa-ch-no` (for OpenRouter models)
   - **Model:** Target model verbatim (e.g. `meta/llama-3.1-70b-instruct`)

2. For Anthropic Claude endpoints:
   - **Base URL:** `https://localhost:7766/v1`
   - **API Key:** `lr-or-cl-ch-dp`
   - **Model:** `dots-studio/dots-3-note-preview:free`

---

## 3. Verifying Connectivity

Verify connectivity with curl:
```bash
curl -sk -X POST https://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer lr-nv-oa-ch-no" \
  -H "Content-Type: application/json" \
  -d '{"model": "meta/llama-3.1-8b-instruct", "messages": [{"role": "user", "content": "ping"}], "max_tokens": 10}'
```
Expected response: HTTP `200 OK` with JSON completion payload.
