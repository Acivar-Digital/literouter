# LiteRouter Setup Checklists

Executable checklists for adding/deleting providers and models. Check each task as you complete it.

---

## 1. Agent Workflow Prerequisites

Before starting ANY checklist:
- [ ] Run `uv run python admin/code_hygiene/agent_guardrail.py checkpoint <filepath>` before editing files
- [ ] Verify `.env` file exists and has API keys: `ls -la .env && head -5 .env`
- [ ] Check current providers in `models.json`: `grep -o '"provider":"[^"]*"' models.json | sort -u`
- [ ] Verify gateway is running: `curl -s http://localhost:7766/health`

---

## 2. Verification Criteria (What Success Looks Like)

| Test | Success criteria |
|------|------------------|
| Curl `:7766` | `"id":"chatcmpl-..."`, `"choices":[...]`, no `"error"` field |
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
- [ ] Verify the gateway:
  ```bash
  curl -s http://localhost:7766/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
    -d '{"model": "provider/model-id", "messages": [{"role": "user", "content": "hello"}]}'
  ```
- [ ] Verify via OpenCode CLI with `literouter/` prefix:
  `opencode -m literouter/provider/model-id --prompt "hello" --no-color`

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
- [ ] Verify model returns "not recognized" error:
  ```bash
  curl -s http://localhost:7766/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
    -d '{"model": "provider/model-id", "messages": [{"role": "user", "content": "hi"}]}' \
    | grep -c "not recognized or whitelisted"
  ```

---

## 7. Add Provider Checklist

- [ ] Read current `.env` to understand format, then add:
  ```
  PROVIDER_NAME_API_KEYS=key1,key2,key3...
  PROVIDER_NAME_BASE_URL=https://api.provider.com/v1
  ```
- [ ] Read `src/index.ts` to find `PROVIDER_API_URLS` dictionary and add provider's URL entry
- [ ] Read `src/index.ts` to find `API_KEYS` object and add provider's key parser
- [ ] Read `src/index.ts` to find `PROVIDER_LIMITS` and add provider-level rate limits
- [ ] Add provider's models to `models.json` (use format: `{ "system_id": "...", "provider": "...", "upstream_id": "...", "context": ..., "max_output": ... }`)
- [ ] Extend `ORG_MAP` in `scripts/gather_model_details.py` (if provider's models are on OpenRouter under different org name)
- [ ] Run `uv run python scripts/gather_model_details.py`
- [ ] Restart gateway: `cd scripts && ./restart.sh`
- [ ] Verify new provider with curl test (from section 5)
- [ ] Sync `~/.config/opencode/opencode.json` to mirror `models.json`
- [ ] Update `CHANGELOG.md` under current version (Added section)

---

## 8. Delete Provider Checklist

- [ ] Run `uv run python scripts/health_check_models.py` to confirm ALL models under this provider are dead or 429-stalled
- [ ] **STOP HERE** - Report to user: `Provider 'PROVIDER_NAME' has X dead models. APPROVED to delete provider?` and wait for explicit yes/no.
- [ ] If approved, search `models.json` for `"provider":"PROVIDER_NAME"` and remove all matching entries
- [ ] Delete all metadata files: `rm models/PROVIDER_NAME/*.json` (verify first with `ls models/PROVIDER_NAME/`)
- [ ] Remove provider env vars from `.env` (lines matching `{PROVIDER}_API_KEYS` and `{PROVIDER}_BASE_URL`)
- [ ] Edit `src/index.ts`:
  - Search `PROVIDER_API_URLS` and remove provider's URL entry
  - Search `API_KEYS` and remove provider's key parser
  - Search `PROVIDER_LIMITS` and remove provider's rate limit entry
- [ ] Remove ORG_MAP entry in `scripts/gather_model_details.py` (if provider was OpenRouter-based)
- [ ] Sync `~/.config/opencode/opencode.json` - remove all `PROVIDER_NAME/*` model blocks under `provider.literouter.models`
- [ ] Update `CHANGELOG.md` under current version (Removed section)
- [ ] Restart gateway: `cd scripts && ./restart.sh`
- [ ] Verify ALL provider models return "not recognized" error on port 7766 (run the curl test from section 6 for each model)

---

## 9. Add/Update Fusion Group Checklist

- [ ] Read `fusion.json` to understand existing chain structure
- [ ] Add or modify group entry in `fusion.json`:
  ```json
  "group-name": {
    "description": "What this chain is for",
    "chain": ["provider/model-primary", "provider/model-fallback1", "provider/model-fallback2"],
    "upstream": "http://localhost:7766/v1beta"
  }
  ```
- [ ] Ensure all models in `chain` exist in `models.json` (fusion does NOT register them — it references existing system_ids)
- [ ] Ensure upstream models are configured in `.env` with API keys for their provider
- [ ] Restart gateway: `bash scripts/stop.sh && bash scripts/start.sh`
- [ ] Verify fusion group works:
  ```bash
  curl -s http://localhost:7766/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
    -d '{"model": "group-name", "messages": [{"role": "user", "content": "hello"}]}'
  ```
- [ ] Check response header: `grep -i "x-literouter-model"` to confirm which upstream served
- [ ] Sync `~/.config/opencode/opencode.json` — add fusion group as a model under `provider.literouter.models` with the fusion group name
- [ ] Update `CHANGELOG.md` under current version (Added section)

---

## 10. Delete Fusion Group Checklist

- [ ] Read `fusion.json` to confirm group exists
- [ ] Remove the group entry from `fusion.json`
- [ ] Remove fusion group from `~/.config/opencode/opencode.json` (search the fusion group name under `provider.literouter.models`)
- [ ] Restart gateway: `bash scripts/stop.sh && bash scripts/start.sh`
- [ ] Verify group returns "not recognized" error on `:7766`
- [ ] Update `CHANGELOG.md` under current version (Removed section)

---

## 11. Agent Reminders (Anti-Fuckup Guide)

0. **Config is at the top**: All env-driven constants in `src/index.ts` near the top — one screen, no digging

1. **CLI Naming Convention**: Use `literouter/` prefix for `opencode` CLI commands
   - ❌ `opencode -m openrouter/model-id`
   - ✅ `opencode -m literouter/openrouter/model-id`

2. **Mandatory Client Sync**: Never consider a model "added" until `~/.config/opencode/opencode.json` is synced

3. **Exact String Matching**: Read config files immediately before editing

4. **Gateway Restart Required**: `models.json` and `fusion.json` are read at startup only — always restart after changes

5. **Fusion groups are not in models.json**: Fusion reads from `fusion.json`, not `models.json`. A model must exist in `models.json` to be in a fusion chain, but the fusion group name itself is separate. You add the fusion group name to `opencode.json` so OpenCode can target it.

6. **Single port**: All traffic goes through `:7766`. The Python gateway (`:7766`) and fusion sidecar (`:7768`) no longer exist.