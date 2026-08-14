---
name: mcpmart-playbook
description: Playbook and operational guide for the consolidated MCPMart Rotating API Key Gateway.
---

# MCPMart API Rotating Gateway Playbook

This playbook provides operational procedures, architecture mappings, troubleshooting, and testing instructions for the MCPMart gateway service running on the VPS (`vps466a` / `10.32.34.243`).

## 1. Quick Reference & Commands
All operations are run inside `/home/vps466a/services/mcpmart/` on the VPS:

* **Start background daemon**: `nohup scripts/restart.sh > server.log 2>&1 &`
* **Restart service**: `bash scripts/restart.sh`
* **Stop service**: `bash scripts/stop.sh`
* **Force free port 18000**: `fuser -k 18000/tcp`
* **Run in foreground**: `uv run python main.py`
* **View runtime logs**: `tail -f server.log`

---

## 2. API Endpoints

The gateway listens on port `18000` with the security token `localfreegemini`.

### Route A: Native Google REST Proxy
* **Path**: `POST http://10.32.34.243:18000/v1beta/models/{model_name}:generateContent`
* **Behavior**: Pass-through query authentication via API keys in URL param (`?key=`).

### Route B: OpenAI Compatibility Layer
* **Path**: `POST http://10.32.34.243:18000/v1/chat/completions`
* **Behavior**: Proxies requests transparently to Google's native OpenAI endpoint (`/v1beta/openai/chat/completions`) using the selected key as `Bearer KEY` in headers. Handles tool calling, streaming, reasoning collapse, and removes thought signatures natively.

---

## 3. Whitelisted Models & Rate Limits
* `gemini-3.1-flash-lite` $\rightarrow$ Routes to `gemini-3.1-flash-lite` (15 RPM / 250K TPM limit per key).
* `gemma-4-31b` $\rightarrow$ Routes to `gemma-4-31b-it` (16K TPM limit per key, unlimited RPM).
* `gemma-4-26b` $\rightarrow$ Routes to `gemma-4-26b-a4b-it` (16K TPM limit per key, unlimited RPM).

---

## 4. Troubleshooting Checklist
1. **Startup fails (`exit 1`)**:
   - Check if Valkey database is active on port `6379` (hard fail-fast dependency).
   - Check if any keys are revoked (Gate 2 validation fails on boot unless `FORCE_STARTUP=True` is configured in environment).
2. **Address already in use (`Errno 98`)**:
   - Run `fuser -k 18000/tcp` to terminate legacy processes and rerun.
3. **HTTP 400 Bad Request**:
   - Check that requested client model matches one of the three whitelisted models.

---

## 5. Verification Test Suite
Local test scripts are located under `/home/yapilwsl/arthityap/literouter/POC_mcpmart/`:
* **Run 12-Permutation test matrix**: `uv run python POC_mcpmart/test_openai_matrix.py`
* **Run basic gateway checks**: `uv run python POC_mcpmart/test_gateway.py`
