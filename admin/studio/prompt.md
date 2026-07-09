# Outsource Prompt: Fix LiteRouter Atomicity & Encoding Bugs

## Context

You are implementing bug fixes for **LiteRouter**, a Python rotating API gateway that proxies requests to Google, Nvidia, OpenRouter, and Zen providers. It uses Redis/Valkey sorted sets for rolling 60-second RPM/TPM quota enforcement (recently upgraded from wall-clock minute buckets — you can ignore the old code).

## Files Staged for Editing

`admin/studio/upload/` contains:
- `router.py` — Core key rotation and quota logic (main target)
- `main.py` — FastAPI routes, streaming, failover (secondary target)
- `config.py` — Configuration, model registry, env vars
- `start.sh` — Boot script
- `.env` — Environment reference

## Bugs to Fix

### Bug 1: TOCTOU Race in Quota Check (HIGH — router.py)

**Location**: `get_available_key()` method (around lines 115-170) and `_record_usage()` (lines 165-175)

**Problem**: Quota is READ (Redis ZRANGEBYSCORE) then later WRITTEN (Redis ZADD + EXPIRE). Between read and write, another concurrent request can also read under-limit quota. Both pass — RPM/TPM overrun by N concurrent burst requests.

```python
# L116 — READ quota
members = await self.redis.zrangebyscore(rolling_key, now - 60, now)
current_rpm = len(members)
current_tpm = sum(...)

# ... several Python lines (min_delay check, next key loop) ...

# L172 — WRITE usage (much later, non-atomic)
pipe.zadd(key, {member: now})
pipe.expire(key, 120)
```

**Fix**: Replace the READ+WRITE pattern with an **atomic Lua script** that does prune, check, and record in one EVAL/EVALSHA call.

Design the Lua script to:
1. Take `KEYS[1]` = rolling key, `ARGV` = `[now, max_rpm, max_tpm, estimated_tokens, member_string]`
2. `ZREMRANGEBYSCORE` old entries (score `-inf` to `now - 60`)
3. `ZRANGEBYSCORE` remaining entries (score `now - 60` to `now`)
4. Count members = RPM, sum token values = TPM
5. If RPM >= max_rpm OR TPM + estimated_tokens > max_tpm: return `0` (QUOTA_EXCEEDED)
6. Else: `ZADD` + `EXPIRE 120`, return `1` (OK)

In Python:
- Load script once in `connect()` via `script_load()`, store SHA in `self._quota_script_sha`
- Replace the quota read block + `_record_usage()` call with `evalsha(...)` in both:
  - The main loop (line ~116-139)
  - The LRU fallback path (line ~149-158)
- The Lua script result (`1` = OK, `0` = exceeded) determines whether to use the key
- Remove `_record_usage()` method entirely — it is replaced by the Lua script

**Important**: The LRU fallback must also re-check quota via the Lua script (not assume the earlier check is still valid), because concurrent requests may have consumed quota between the main loop pass and the LRU fallback.

### Bug 2: `report_error()` Exception in Failover Catch Block (HIGH — main.py)

**Location**: Two identical patterns — Google SDK route (around line 609) and OpenAI route (around line 715)

**Problem**: When a request fails and `report_error()` is called inside the `except` block, a Valkey outage will cause `report_error()` to throw. Since this isn't inside another try/except, the exception escapes the failover loop, returning HTTP 500 instead of retrying the next key.

```python
except (httpx.HTTPStatusError, httpx.RequestError) as exc:
    ...
    if active_key:
        await router.report_error(...)  # If Valkey is down, this throws!
    if attempt == num_keys:
        raise HTTPException(status_code=502, ...)
```

**Fix**: Wrap each `report_error()` call in try/except:

```python
if active_key:
    try:
        await router.report_error(provider, active_key, str(status), upstream_model)
    except Exception as report_err:
        logger.error(f"report_error failed for {provider} key {active_key[:6]}...{active_key[-4:]}: {report_err}")
```

Apply to BOTH the Google SDK route AND the OpenAI route failover catch blocks.

### Bug 3: `ensure_ascii=True` in Streaming SSE (HIGH — main.py)

**Location**: Line 445 in `stream_transformer()` — the JSON serialization of streaming chunks

**Problem**: `json.dumps(chunk_json)` uses default `ensure_ascii=True`, which escapes ALL non-ASCII characters as `\uXXXX`. This affects:
- Chinese/Japanese text in model responses
- Emojis
- LaTeX symbols after `_clean_latex_symbols_bytes` substitution
- Any Unicode content

```python
yield f"data: {json.dumps(chunk_json)}\n\n"
```

**Fix**: Add `ensure_ascii=False`:
```python
yield f"data: {json.dumps(chunk_json, ensure_ascii=False)}\n\n"
```

No other changes needed.

### Bug 4: `REDIS_DB` Environment Variable Ignored (MEDIUM — config.py + router.py)

**Location**: `config.py` never reads `REDIS_DB`; `router.py` uses Redis default `db=0`

**Problem**: `.env` has `REDIS_DB=0` but if a user changes it to `REDIS_DB=1`, the setting is silently ignored because neither `config.py` nor `router.py` reference it.

**Fix in `config.py`**:
```python
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
```

**Fix in `router.py`**:
Update the import and pass `db=REDIS_DB` to `redis.Redis()`:
```python
from src.config import REDIS_HOST, REDIS_PASSWORD, REDIS_PORT, REDIS_DB, get_model_limits

# In connect():
self.redis = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    password=REDIS_PASSWORD,
    db=REDIS_DB,
    decode_responses=True
)
```

### Bug 5: `zremrangebyscore` Min Score Should Be `-inf` (MEDIUM — router.py)

**Location**: `_record_usage()` line 172 (will be removed by Bug 1 fix, but if kept in LRU path, fix here)

**Problem**: `pipe.zremrangebyscore(key, 0, now - 60)` uses `0` as minimum score instead of `-inf`. Works by coincidence because `time.time()` always returns >0, but semantically wrong.

**Fix**: This is automatically resolved by Bug 1 (removing `_record_usage()`). If you keep a pipeline in any code path, use `-inf`:
```python
pipe.zremrangebyscore(key, '-inf', now - 60)
```

### Bug 6: Gate 2 Bypass on Restart (MEDIUM — start.sh)

**Location**: `start.sh` directly boots the server without running `doctor.py`

**Problem**: If a key was revoked between restarts, the server starts healthy but silently fails on every request using that key, until runtime error handling eventually quarantines it.

**Fix**: Before starting the server, run the doctor gate:
```bash
uv run python src/doctor.py
if [ $? -ne 0 ]; then
    echo "ERROR: Gate 2 validation failed. Fix keys before starting."
    exit 1
fi
```

Add this after `flush_valkey` and before the `tmux new-session` commands in `start.sh`.

## Implementation Guidelines

1. **No other changes**: Do not refactor, reformat, or rename anything beyond the specific changes requested above.
2. **Preserve logging format**: Keep the existing log message format exactly as-is (same wording, same variables).
3. **Lua script style**: Write the Lua script as a raw string at module level in `router.py` (a `QUOTA_CHECK_SCRIPT` constant), then load via `script_load` in `connect()`.
4. **Error handling**: The Lua script `evalsha` call may fail if the script isn't loaded — catch `redis.exceptions.NoScriptError` and fall back to `eval()` with the raw script as string.
5. **Return types**: The Lua script must return integer `1` (OK, quota available) or `0` (quota exceeded). Redis Lua converts these to integers in the response.
6. **Imports**: Only add imports that are actually needed (e.g., you won't need new imports for the Lua script).
7. **Don't break the Google SDK route**: The Google SDK route (`google_sdk_route`) also uses `_record_usage` through the `router` object — but it goes through `get_available_key()`, not `_record_usage()` directly. So removing `_record_usage()` is safe as long as both call paths in `get_available_key()` use the Lua script.

## Expected Output

Generate the complete modified files. Mark each change with a clear comment showing which bug number it fixes:
- `# BUG 1: TOCTOU race — atomic Lua script`
- `# BUG 2: report_error failover cascade protection`
- `# BUG 3: ensure_ascii=False for streaming`
- `# BUG 4: REDIS_DB config drift`
- `# BUG 5: zremrangebyscore -inf`
- `# BUG 6: Gate 2 on start.sh`

## Verification

After implementing, confirm:
1. `router.py`: `_record_usage()` method is removed, replaced by Lua script `evalsha` in both the main loop and LRU fallback
2. `router.py`: All ZRANGEBYSCORE quota reads inside `get_available_key()` are removed (replaced by Lua script)
3. `router.py`: `connect()` has `script_load()` call for the Lua script
4. `main.py`: Two `report_error()` call sites wrapped in try/except
5. `main.py`: One `json.dumps()` call updated with `ensure_ascii=False`
6. `config.py`: `REDIS_DB` variable added
7. `router.py`: Redis constructor uses `db=REDIS_DB`
8. `start.sh`: `uv run python src/doctor.py` added before boot
