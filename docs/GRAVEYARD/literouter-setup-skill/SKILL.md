---
name: literouter-setup
description: Use when the user wants to add/remove providers, add/delete API keys, edit OpenCode model config, or download model metadata snapshots for the LiteRouter proxy.
---

# LiteRouter Setup — Provider Onboarding

Complete workflow for adding a new provider and models through LiteRouter.

**Config sources:**
- `.env` (repo root) — provider endpoints, keys, defaults
- `~/.config/opencode/opencode.json` — model visibility in OpenCode (system-level, NOT project `.opencode/`)

---

## Step 1: Intake

Before any action, ask the user for these. Use the `question` tool. Do NOT proceed without all answered.

| # | Ask for | Default / Format |
|---|---------|------------------|
| 1 | **Model names** | Comma-separated (e.g. `deepseek-ai/deepseek-v4-flash, owl-alpha`) |
| 2 | **Provider endpoint** | Must end with `/v1` — code appends `/chat/completions` |
| 3 | **Provider name** | Lowercase prefix for model IDs (e.g. `nvidia`, `zen`) |
| 4 | **API keys** | Comma-separated, one or more |
| 5 | **npm template** | `@ai-sdk/openai-compatible` (default) |

---

## Step 2: Validate Keys

Before writing to `.env`, test every key against the provider API:

```python
import json, urllib.request

req = urllib.request.Request(
    '{BASE_URL}/chat/completions',             # code appends /chat/completions
    data=json.dumps({
        'model': '{MODEL_ID}',
        'messages': [{'role': 'user', 'content': 'hi'}],
        'max_tokens': 10,
    }).encode(),
    headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer {KEY}',
        'User-Agent': 'OpenCode/1.0',          # Cloudflare blocks bare clients
    },
    method='POST',
)
```

**If a key fails, investigate before blaming the user:**
1. Cloudflare? Look for `cf-ray` header, `error code: 1010`, HTML response → add `User-Agent`
2. Wrong model? Hit `{BASE_URL}/models` to list available models
3. Double path? `{BASE_URL}` should NOT include `/chat/completions` — code appends it

---

## Step 3: Add to `.env`

Edit `.env`, placing vars in the correct section:

| Section | Vars |
|---------|------|
| **3. API KEYS & ENDPOINTS** | `{PROVIDER}_BASE_URL`, `{PROVIDER}_API_KEYS` |
| **4. MODELS & PROVIDERS** | `{PROVIDER}_MIN_DELAY_MS`, `{PROVIDER}_MODEL` (one model ID for doctor boot validation) |

---

## Step 4: Resolve Model Limits

Check model context/output limits in this order:

1. **Provider API** — `{BASE_URL}/models/{MODEL_ID}` or `{BASE_URL}/models`
2. **OpenRouter fallback** — search model list by keyword:
   ```bash
   curl -s "https://openrouter.ai/api/v1/models" \
     -H "Authorization: Bearer $OR_KEY" | python3 -c "
   import sys, json
   data = json.load(sys.stdin)['data']
   keywords = ['deepseek', 'mimo', 'north-mini', 'nemotron']
   for m in data:
       if any(k in m['id'].lower() for k in keywords):
           print(f\"{m['id']}: context={m.get('context_length','?')}  output={m.get('top_provider',{}).get('max_completion_tokens','?')}\")
   "
   ```
3. **Sensible defaults** — 256k context / 64k output

Save metadata to `models/{provider}_{slug}.json` if available, otherwise `models/{provider}_models.json`.

---

## Step 5: Update OpenCode Config

Add model entries to `~/.config/opencode/opencode.json` under `provider.literouter.models`:

```json
"{provider}/{model-id}": {
  "name": "Human Name (Provider)",
  "limit": { "context": 1048576, "output": 65536 }
}
```

The model key prefix (before `/`) must match the provider name — LiteRouter uses it for routing.

> [!NOTE]
> For native Google SDK payloads, configure the provider in `opencode.json` with `"npm": "@ai-sdk/google"` and `"options": {"baseURL": "http://localhost:7766/v1"}`. LiteRouter will dynamically handle these as raw pass-through requests rather than converting them.

---

## Step 6: Restart & Verify

```bash
bash scripts/restart.sh
```

Check:
- `curl http://localhost:7766/health` — `config.providers` shows new provider with correct key count
- `opencode models` — models appear under `literouter/{provider}/`

**Doctor must show all keys healthy** — if skipped or failed, fix before proceeding.

---

## Step 7: Rotation Smoke Test

Verify round-robin key rotation: send 1 request per key + 1 extra (wraps to key 1).

```bash
# Template — adapt model list for your provider
for model in model1 model2 model3 model4; do
  curl -s http://localhost:7766/v1/chat/completions \
    -H "Authorization: Bearer $LR_AUTH_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":10}"
done
```

Check logs show each request using a different key:
```bash
grep "\[{PROVIDER}\]" logs/literouter.log | grep "Using rotated key"
```

The N+1th request must wrap back to key 1.

---

## Teardown

### Remove API Keys
Delete the key from `{PROVIDER}_API_KEYS` in **Section 3** of `.env`.

### Remove a Provider
Delete from `.env`:
- **Section 3**: `{PROVIDER}_BASE_URL`, `{PROVIDER}_API_KEYS`
- **Section 4**: `{PROVIDER}_MIN_DELAY_MS`, `{PROVIDER}_MODEL`, subsection comment

Remove models from OpenCode config and metadata files from `models/`. Restart.
