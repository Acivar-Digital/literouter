# LiteRouter Setup Guide

For step-by-step workflows, see **`setup_checklist.md`** — it contains executable checklists for Add Model, Delete Model, Add Provider, Delete Provider. This document covers technical details and scripts.

---

## 1. Model Registry Technical Details

`models.json` is the **lean routing registry** (ID → upstream). Rich per-model metadata lives in `models/<provider>/` as one JSON file per model, sourced from OpenRouter's public catalog.

### Directory Layout
```
models.json                     # routing registry
models/
  openrouter/                  # OpenRouter model details
  nvidia/                      # Nvidia model details  
  zen/                         # Zen model details
```

---

## 2. Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/gather_model_details.py` | Pulls OpenRouter catalog, populates `models/<provider>/` and syncs real context/max_output into `models.json` |
| `scripts/health_check_models.py` | Probes every model, reports alive vs dead (ERROR, 429, 200) |

Both run with `uv run python scripts/<script>.py`.

---

## 3. ID Normalization Rules (ORG_MAP)

OpenRouter's catalog uses different naming than our `system_id`s. Normalization happens in `gather_model_details.py`:

| Our org | OpenRouter org |
|---------|---------------|
| `meta` | `meta-llama` |
| `minimaxai` | `minimax` |
| `deepseek-ai` | `deepseek` |
| `stepfun-ai` | `stepfun` |

**`zen/deepseek*` special case:** mapped to OpenRouter's `deepseek/...` catalog entry.  
**Google is skipped** entirely (manual configuration).

---

## 4. Fusion Model Configuration (Port `7768`)

Fusion models are "virtual" models with priority-based fallback chains. If primary returns `429` or `5xx`, it tries the next model.

**Launch:**
```bash
uv run uvicorn fusion:app --host 0.0.0.0 --port 7768
```

(Requires main gateway on port `7766` running first.)

---

## 5. Google SDK Routes

- **Port `7766` native route**: `/v1beta/...` for native Google REST (preserves tool configurations)
- **Port `7766/7767` OpenAI route**: `/v1/chat/completions` for standard chat

---

## 6. Dead-Model Detection (MANDATORY PROCESS)

**Never auto-remove models.** Always follow this process:

1. Run `uv run python scripts/health_check_models.py`
2. Classify results:
   - `ERROR` → broken/gone (fatal)
   - `429` → alive but rate-limited
   - `200` → alive
3. **Report `ERROR` and `429` models to user** (grouped by failure type)
4. **Wait for explicit approval** before editing `models.json`
5. After approval: remove from `models.json` AND delete corresponding `models/<provider>/<file>.json`

> The user double-checks all removal decisions. Surfacing the list is the deliverable; deletion is only on approval.