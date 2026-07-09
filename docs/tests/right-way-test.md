# Right-Way Testing (E2E Integration & Verification)

This document establishes the mandatory protocol for verifying changes to LiteRouter. It ensures that agents do not fall into the "mocking trap" (where mocked unit tests pass but the live daemon or upstream APIs fail).

## Mandatory Test Protocol

Before claiming any feature or bug fix is complete:

### 1. Decoupled Unit Verification
Verify that the offline unit tests pass successfully.
```bash
uv run pytest
```

### 2. Live Daemon Process Verification
Never assume the background daemon matches your local code edits. You MUST restart the running process:
```bash
# 1. Kill the existing daemon
if [ -f .literouter.pid ]; then
    kill -9 $(cat .literouter.pid) || true
    rm .literouter.pid
fi

# 2. Pre-flight: refuse to boot if any API key fails upstream auth.
#    This is the gate that prevents the "placeholder key → 403 in production"
#    gap the workflow historically allowed. (See src/config.py:is_invalid_api_key
#    and src/doctor.py for the two layers.)
uv run python src/doctor.py

# 3. Boot the new daemon
nohup uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 > logs/literouter.log 2>&1 & echo $! > .literouter.pid

# 4. Check health and verify correct template config
sleep 2
curl -s http://localhost:7766/health
```

### 2.1. Pre-flight Doctor Gate (MANDATORY — DO NOT SKIP)
Before every daemon (re)start, `uv run python src/doctor.py` MUST exit 0.
- exit 0: all keys healthy → safe to boot
- exit 1: config error → fix `.env` first
- exit 2: live auth failure → REPLACE the dead keys, then re-run doctor

Override flag: `bash scripts/start.sh --force` or `bash scripts/restart.sh --skip-doctor`
is permitted but MUST be accompanied by a human confirmation in chat because it is the
exact path that previously allowed placeholder/revoked keys into the live rotation.

### 3. Real-World E2E Streaming & Payload Test
Perform a live streaming request through the daemon to verify prefix preservation, block sanitization, and non-blocking Server-Sent Events (SSE).

```bash
curl -N -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openrouter/owl-alpha",
    "stream": true,
    "messages": [
      {
        "role": "user",
        "content": [{"type": "input_text", "text": "hello"}]
      }
    ]
  }'
```

**Success Criteria:**
- The request must not hang.
- SSE chunks (`data: {...}`) must stream back immediately.
- The outbound model field must match the exact requested provider prefix (e.g. `openrouter/owl-alpha` instead of `owl-alpha`).
