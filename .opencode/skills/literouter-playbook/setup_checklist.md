# LiteRouter Setup Checklists

Executable checklists for adding/deleting providers and models. Check each task as you complete it.

---

## 1. Agent Workflow Prerequisites

Before starting ANY checklist:
- [ ] Run `uv run python admin/code_hygiene/agent_guardrail.py checkpoint <filepath>` before editing files
- [ ] Verify `.env` file exists and has API keys: `ls -la .env && head -5 .env`
- [ ] Check current providers in `models.json`: `grep -o '"provider":"[^"]*"' models.json | sort -u`
- [ ] Verify gateway is running: `curl -s http://localhost:7766/v1/models | head -c 100`

---

## 2. Verification Criteria (What Success Looks Like)

| Test | Success criteria |
|------|------------------|
| Curl (port 7766) | `"id":"chatcmpl-..."`, `"choices":[...]`, no `"error"` field |
| Curl (port 7767) | Same as above |
| Opencode CLI | Single word response, no connection errors |
| Model removed | `{"detail":"Model 'provider/model-id' is not recognized or whitelisted"}` |
| Provider removed | All models under that provider return "not recognized" |

---

## 3. Failure Recovery (Small Model Guidance)

If any step fails:
- **Script crashes**: Read the full error, check if required files exist, restart from checkpoint
- **401/403 errors**: API key may be invalid - stop and ask user to verify `.env`
- **429 errors**: Wait 60s and retry, or try different API key
- **Connection refused**: Gateway not running - run `bash scripts/start.sh`

---

## 4. Beads Tracking (When to Stop and Report)

- [ ] Create bd issue for any discovered problems: `bd create "Problem description" -t bug -p 2`
- [ ] Flag for human when stuck: `bd human <id>` and `bd update <id> --notes "blocked on X"`

---

## 5. Add Model Checklist

- [ ] Read current `models.json` to understand structure
- [ ] Add entry to `models.json` using exact format:
  ```json
  { "system_id": "provider/model-id", "provider": "provider", "upstream_id": "upstream_id", "context": 128000, "max_output": 4096 }
  ```
- [ ] Run `uv run python scripts/gather_model_details.py` (if provider has OpenRouter mapping)
- [ ] Sync `~/.config/opencode/opencode.json` to mirror `models.json` changes. Find `provider.literouter.models` section and ensure the new model block exists with correct `name`/`limit` values
- [ ] Update `CHANGELOG.md` under current version (Added section)
- [ ] Restart gateway: `cd scripts && ./restart.sh`
- [ ] Verify connectivity via curl to port `7766`:
  ```bash
  curl -s http://localhost:7766/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
    -d '{"model": "provider/model-id", "messages": [{"role": "user", "content": "hello"}]}'
  ```
- [ ] Verify connectivity via curl to port `7767` (same command)
- [ ] Verify via OpenCode CLI: `opencode -m literouter/provider/model-id --prompt "hello" --no-color`

---

## 6. Delete Model Checklist

- [ ] Run `uv run python scripts/health_check_models.py` to confirm model is dead
- [ ] If output shows `ERROR` status, proceed. If `429`, confirm it persists across 3 tries before removing.
- [ ] **STOP HERE** - Report to user: `I found model 'provider/model-id' with ERROR status. APPROVED to delete?` and wait for explicit yes/no.
- [ ] If approved, remove entry from `models.json` (search for `"system_id": "provider/model-id"`)
- [ ] Delete metadata file: `rm models/provider/<filename>.json`. Filename = `<provider>_<model-name>_free.json` with `/` and `:` replaced by `_` (e.g. `openrouter_poolside_laguna-m.1_free.json`)
- [ ] Sync `~/.config/opencode/opencode.json` (search for `"openrouter/poolside/laguna-m.1:free"` and remove the entire block)
- [ ] Update `CHANGELOG.md` under current version (Removed section)
- [ ] Restart gateway: `cd scripts && ./restart.sh`
- [ ] Verify model returns "not recognized" error (curl to port `7766`)
- [ ] Verify model returns "not recognized" error (curl to port `7767`)

---

## 7. Add Provider Checklist

- [ ] Read current `.env` to understand format, then add:
  ```
  PROVIDER_NAME_API_KEYS=key1,key2,key3...
  PROVIDER_NAME_BASE_URL=https://api.provider.com/v1
  ```
- [ ] Read `src/config.py` to find `PROVIDER_API_URLS` dictionary and add provider's URL
- [ ] Read `src/config.py` to find `static_validate_keys` pattern and add:
  `PROVIDER_API_KEYS = static_validate_keys("PROVIDER", os.getenv("PROVIDER_API_KEYS", ""))`
- [ ] Read `ts-src/src/index.ts` to find `BASE_URLS` and add provider entry
- [ ] Read `ts-src/src/index.ts` to find `ModelFirstRouter` constructor and add key parser
- [ ] Add provider's models to `models.json` (use format: `{ "system_id": "...", "provider": "...", "upstream_id": "...", "context": ..., "max_output": ... }`)
- [ ] Extend `ORG_MAP` in `scripts/gather_model_details.py` (if provider's models are on OpenRouter under different org name)
- [ ] Run `uv run python scripts/gather_model_details.py`
- [ ] Restart gateway: `cd scripts && ./restart.sh`
- [ ] Verify both proxies (7766 and 7767) with curl tests
- [ ] Sync `~/.config/opencode/opencode.json` to mirror `models.json`
- [ ] Update `CHANGELOG.md` under current version (Added section)

---

## 8. Delete Provider Checklist

- [ ] Run `uv run python scripts/health_check_models.py` to confirm ALL models under this provider are dead or 429-stalled
- [ ] **STOP HERE** - Report to user: `Provider 'PROVIDER_NAME' has X dead models. APPROVED to delete provider?` and wait for explicit yes/no.
- [ ] If approved, search `models.json` for `"provider":"PROVIDER_NAME"` and remove all matching entries
- [ ] Delete all metadata files: `rm models/PROVIDER_NAME/*.json` (verify first with `ls models/PROVIDER_NAME/`)
- [ ] Remove provider env vars from `.env` (lines matching `{PROVIDER}_API_KEYS` and `{PROVIDER}_BASE_URL`)
- [ ] Edit `src/config.py`:
  - Search `PROVIDER_API_URLS[...]` and remove the provider's entry
  - Search `static_validate_keys("PROVIDER"` and remove that line
- [ ] Edit `ts-src/src/index.ts`:
  - Search `BASE_URLS` and remove provider's URL entry
  - Search `ModelFirstRouter` constructor and remove the provider's key parser
- [ ] Remove ORG_MAP entry in `scripts/gather_model_details.py` (if provider was OpenRouter-based)
- [ ] Sync `~/.config/opencode/opencode.json` - remove all `PROVIDER_NAME/*` model blocks under `provider.literouter.models`
- [ ] Update `CHANGELOG.md` under current version (Removed section)
- [ ] Restart gateway: `cd scripts && ./restart.sh`
- [ ] Verify ALL provider models return "not recognized" error (curl to both ports)

---

## 9. Agent Reminders (Anti-Fuckup Guide)

1. **CLI Naming Convention**: Use `literouter/` prefix for `opencode` CLI commands
   - ❌ `opencode -m openrouter/model-id`
   - ✅ `opencode -m literouter/openrouter/model-id`

2. **Mandatory Client Sync**: Never consider a model "added" until `~/.config/opencode/opencode.json` is synced

3. **Exact String Matching**: Read config files immediately before editing

4. **Gateway Restart Required**: `models.json` is read at startup only — always restart after changes