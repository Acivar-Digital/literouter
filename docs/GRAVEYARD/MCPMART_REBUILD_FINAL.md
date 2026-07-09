# MCPMart Rebuild: Final Production Specification

This document consolidates the complete specifications, implementation architecture, production source code files, and validation test suites for the rebuilt, high-performance MCPMart API Rotating Gateway.

---

## 1. System Architecture Overview

### Allowed Upstream Whitelist
MCPMart acts as a secure proxy to Google's Generative Language API, whitelisting exactly three models:
* `gemini-3.1-flash-lite` $\rightarrow$ Routes to `gemini-3.1-flash-lite`
* `gemma-4-31b` $\rightarrow$ Routes to `gemma-4-31b-it`
* `gemma-4-26b` $\rightarrow$ Routes to `gemma-4-26b-a4b-it`

### Rate Limiting Constraints
* **Gemini Flash Lite**: Enforces **15 RPM** / **250K TPM** limit per API key.
* **Gemma models (`31b` and `26b`)**: Enforces **16K TPM** limit per API key (with no RPM restrictions).
* **Valkey Backend**: Strict runtime database requirement (exit code `1` fail-fast if Valkey is down).

### Routing Strategies
* **Route A (Native Google REST)**: Target path `/v1beta/models/...`. Pure transparent pass-through appending `?key=GEMINI_API_KEY`.
* **Route B (OpenAI Compatibility)**: Target path `/v1/chat/completions`. Transparent pass-through targeting Google's native `/v1beta/openai/chat/completions` endpoint, replacing `"model"` payload values with upstream names, and passing keys via the `Authorization: Bearer KEY` header. This natively resolves streaming, tool calling, and thought signatures without fragile manual translation.

---

## 2. Production Source Code

### `pyproject.toml`
```toml
[project]
name = "mcpmart"
version = "0.1.0"
description = "FastAPI proxy server providing free Gemini API endpoints via round-robin key rotation"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.110.0",
    "uvicorn>=0.29.0",
    "httpx>=0.27",
    "aiosqlite>=0.20",
    "python-dotenv>=1.0",
    "requests>=2.31.0",
    "redis>=5.0.0",
    "pydantic-settings>=2.2.1",
]

[project.scripts]
mcpmart = "main:main"

[dependency-groups]
dev = [
    "ruff>=0.15.12",
    "pytest>=8.0.0",
    "pytest-asyncio>=0.23.0",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"
```

### `.env.example`
```env
REDIS_HOST="127.0.0.1"
REDIS_PORT=6379
REDIS_PASSWORD=""

MCPMART_AUTH_TOKEN="localfreegemini"
LITEROUTER_COLLAPSE_REASONING=false

# Raw API keys comma-separated pool
GEMINI_KEYS="key1,key2,key3"
```

### `src/config.py`
```python
import os
from typing import Optional
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    REDIS_HOST: str = "127.0.0.1"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: Optional[str] = None

    MCPMART_AUTH_TOKEN: str = "changeme"
    LITEROUTER_COLLAPSE_REASONING: bool = False

    GEMINI_KEYS: str = ""
    GOOGLE_API_KEYS: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

settings = Settings()
```

### `src/valkey_client.py`
```python
import logging
from typing import Optional
import redis.asyncio as redis
from src.config import settings

logger = logging.getLogger("mcpmart.valkey")

class ValkeyClient:
    def __init__(self):
        self.client: Optional[redis.Redis] = None

    async def connect(self):
        logger.info(f"Connecting to Valkey database at {settings.REDIS_HOST}:{settings.REDIS_PORT}...")
        self.client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD,
            decode_responses=True
        )
        # Verify connection immediately, forcing startup to fail fast if Valkey is down
        await self.client.ping()
        logger.info("Successfully established connection with Valkey.")

    async def ping(self) -> bool:
        if not self.client:
            return False
        try:
            return await self.client.ping()
        except Exception:
            return False

    async def close(self):
        if self.client:
            await self.client.aclose()
            logger.info("Valkey connection closed.")

valkey = ValkeyClient()
```

### `src/doctor.py`
```python
import sys
import os
import asyncio
import httpx
import logging
from typing import List
from src.config import settings

logger = logging.getLogger("mcpmart.doctor")

def check_force_startup() -> bool:
    """
    Checks environment or CLI args to see if forcing startup is enabled.
    """
    if os.environ.get("FORCE_STARTUP", "").lower() in ("true", "1", "yes"):
        return True
    if "--force" in sys.argv or "-f" in sys.argv:
        return True
    return False

def run_gate1_static_validation() -> List[str]:
    """
    Gate 1: Extracts and filters raw keys matching invalid pattern and minimum length constraints.
    """
    raw_keys: List[str] = []

    if settings.GEMINI_KEYS:
        parts = settings.GEMINI_KEYS.split(",")
        for part in parts:
            part = part.strip()
            if not part:
                continue
            key = part.split(":")[-1].strip() if ":" in part else part
            if key:
                raw_keys.append(key)

    if settings.GOOGLE_API_KEYS:
        parts = settings.GOOGLE_API_KEYS.split(",")
        for part in parts:
            key = part.strip()
            if key:
                raw_keys.append(key)

    seen = set()
    unique_keys = []
    for k in raw_keys:
        if k not in seen:
            seen.add(k)
            unique_keys.append(k)

    placeholders = {"changeme", "placeholder", "your_key", "todo", "xxxx"}
    valid_keys = []

    for key in unique_keys:
        key_lower = key.lower()
        has_placeholder = any(p in key_lower for p in placeholders)
        has_angle_brackets = "<" in key or ">" in key
        is_long_enough = len(key) >= 30

        if has_placeholder or has_angle_brackets or not is_long_enough:
            logger.warning(
                f"Key static check failed for '{key[:8]}...': "
                f"[Placeholder={has_placeholder}, Brackets={has_angle_brackets}, LengthCheck={is_long_enough}]"
            )
            continue
        valid_keys.append(key)

    return valid_keys

async def run_gate2_live_validation(keys: List[str], force: bool) -> List[str]:
    """
    Gate 2: Query model validation concurrently to detect revoked API credentials.
    """
    if not keys:
        logger.error("No valid API credentials remained after static filter stage.")
        sys.exit(1)

    logger.info(f"Initiating live validation diagnostic for {len(keys)} unique API keys...")
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent"

    async def check_key(key: str) -> tuple[str, int, str]:
        payload = {
            "contents": [{"parts": [{"text": "ping"}]}],
            "generationConfig": {"maxOutputTokens": 100}
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(f"{url}?key={key}", json=payload)
                return key, resp.status_code, resp.text
        except Exception as e:
            return key, -1, str(e)

    tasks = [check_key(key) for key in keys]
    results = await asyncio.gather(*tasks)

    active_keys = []
    revoked_detected = False

    print("\n" + "="*60)
    print("              MCPMART API KEY DIAGNOSTIC REPORT")
    print("="*60)

    for key, status, response_text in results:
        masked = f"{key[:6]}...{key[-6:]}" if len(key) > 12 else "INVALID_KEY"
        if status == 200:
            print(f"✅ Key [{masked}]: ACTIVE (200 OK)")
            active_keys.append(key)
        elif status in (401, 403):
            print(f"❌ Key [{masked}]: REVOKED (HTTP {status})")
            revoked_detected = True
        elif status == 429:
            print(f"⚠️ Key [{masked}]: VALID BUT QUOTA LIMIT (HTTP 429)")
            active_keys.append(key)
        else:
            print(f"⚠️ Key [{masked}]: ERROR/UNREACHABLE (HTTP {status}) - {response_text[:60]}")
            active_keys.append(key)

    print("="*60 + "\n")

    if revoked_detected:
        if not force:
            logger.critical("Revoked keys detected. Gateway execution aborted. Configure force mode if override needed.")
            sys.exit(1)
        else:
            logger.warning("Revoked keys found, but force mode is configured. Pruning credentials and proceeding...")
            revoked_keys = {k for k, s, _ in results if s in (401, 403)}
            active_keys = [k for k in active_keys if k not in revoked_keys]

    if not active_keys:
        logger.critical("Zero functional keys validated. Gateway exiting.")
        sys.exit(1)

    return active_keys
```

### `src/key_manager.py`
```python
import time
import hashlib
import logging
import collections
from typing import List, Tuple
from fastapi import HTTPException
from src.config import settings
from src.valkey_client import valkey

logger = logging.getLogger("mcpmart.key_manager")

# Bound-limited telemetry storage to prevent unbounded memory usage
latency_history = collections.deque(maxlen=5000)

VALID_KEYS: List[str] = []

ROUND_ROBIN_POINTERS = {
    "gemini-3.1-flash-lite": 0,
    "gemma-4-31b": 0,
    "gemma-4-26b": 0
}

def set_valid_keys(keys: List[str]):
    global VALID_KEYS
    VALID_KEYS = keys
    logger.info(f"KeyManager tracking updated active key pool of {len(VALID_KEYS)} keys.")

def estimate_tokens(payload: dict) -> int:
    """
    Analyzes body fields recursively to estimate expected prompt token volume.
    """
    text_parts = []

    def extract_text(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k == "text" and isinstance(v, str):
                    text_parts.append(v)
                elif k == "content" and isinstance(v, str):
                    text_parts.append(v)
                else:
                    extract_text(v)
        elif isinstance(obj, list):
            for item in obj:
                extract_text(item)

    extract_text(payload)
    prompt_text = " ".join(text_parts)
    words = prompt_text.split()
    if not words:
        return 200
    return int(len(words) * 1.3)

def resolve_model(model_name: str) -> Tuple[str, str, int, int]:
    """
    Validates model against early whitelist.
    Returns: (model_class, upstream_model_name, rpm_limit, tpm_limit)
    """
    model_lower = model_name.lower()
    if "gemini-3.1-flash-lite" in model_lower or "gemini-flash" in model_lower:
        return "gemini-3.1-flash-lite", "gemini-3.1-flash-lite", 15, 250000
    elif "gemma-4-31b" in model_lower:
        return "gemma-4-31b", "gemma-4-31b-it", 0, 16000
    elif "gemma-4-26b" in model_lower:
        return "gemma-4-26b", "gemma-4-26b-a4b-it", 0, 16000
    else:
        raise HTTPException(status_code=400, detail="Model not allowed.")

async def pre_increment_rpm(key_hash: str, model_class: str, rpm_limit: int) -> bool:
    if rpm_limit <= 0:
        return True
    timestamp = int(time.time() / 60)
    rpm_key = f"mcpmart:rpm:{key_hash}:{model_class}:{timestamp}"

    try:
        pipe = valkey.client.pipeline()
        pipe.incr(rpm_key)
        pipe.expire(rpm_key, 60)
        results = await pipe.execute()

        current_total = results[0]
        if current_total > rpm_limit:
            await valkey.client.decr(rpm_key)
            return False
        return True
    except Exception as e:
        logger.error(f"Valkey pre-increment RPM command failed: {e}")
        return False

async def pre_increment_tpm(key_hash: str, model_class: str, estimate: int, tpm_limit: int) -> bool:
    timestamp = int(time.time() / 60)
    tpm_key = f"mcpmart:tpm:{key_hash}:{model_class}:{timestamp}"

    try:
        pipe = valkey.client.pipeline()
        pipe.incrby(tpm_key, estimate)
        pipe.expire(tpm_key, 60)
        results = await pipe.execute()

        current_total = results[0]
        if current_total > tpm_limit:
            await valkey.client.decrby(tpm_key, estimate)
            return False
        return True
    except Exception as e:
        logger.error(f"Valkey pre-increment TPM command failed: {e}")
        return False

async def rollback_limits(key_hash: str, model_class: str, estimated_tpm: int, rpm_limit: int, timestamp: int):
    tpm_key = f"mcpmart:tpm:{key_hash}:{model_class}:{timestamp}"
    rpm_key = f"mcpmart:rpm:{key_hash}:{model_class}:{timestamp}"

    try:
        pipe = valkey.client.pipeline()
        pipe.decrby(tpm_key, estimated_tpm)
        if rpm_limit > 0:
            pipe.decr(rpm_key)
        await pipe.execute()
        logger.info(f"Successfully rolled back quotas for key '{key_hash[:8]}'.")
    except Exception as e:
        logger.error(f"Quota rollback execution failed: {e}")

async def reconcile_tpm(key_hash: str, model_class: str, estimated_tpm: int, actual_total: int, timestamp: int):
    tpm_key = f"mcpmart:tpm:{key_hash}:{model_class}:{timestamp}"
    delta = actual_total - estimated_tpm
    if delta == 0:
        return
    try:
        await valkey.client.incrby(tpm_key, delta)
        logger.info(f"Reconciliation delta {delta} applied to key '{key_hash[:8]}'.")
    except Exception as e:
        logger.error(f"Failed to apply reconciliation delta: {e}")

async def put_on_cooldown(key_hash: str, model_class: str):
    cooldown_key = f"mcpmart:cooldown:google:{model_class}:{key_hash}"
    try:
        await valkey.client.set(cooldown_key, "1", ex=15)
        logger.warning(f"Credential '{key_hash[:8]}' set on a 15-second cooldown.")
    except Exception as e:
        logger.error(f"Failed setting cooldown status in Valkey: {e}")

async def acquire_key(model_class: str, estimated_tpm: int, tpm_limit: int, rpm_limit: int) -> Tuple[str, str, int]:
    global VALID_KEYS
    if not VALID_KEYS:
        raise HTTPException(status_code=500, detail="No active backend endpoints configured.")

    num_keys = len(VALID_KEYS)
    start_idx = ROUND_ROBIN_POINTERS.get(model_class, 0)
    timestamp = int(time.time() / 60)

    for i in range(num_keys):
        idx = (start_idx + i) % num_keys
        key = VALID_KEYS[idx]
        key_hash = hashlib.sha256(key.encode()).hexdigest()

        cooldown_key = f"mcpmart:cooldown:google:{model_class}:{key_hash}"
        if await valkey.client.exists(cooldown_key):
            continue

        rpm_ok = await pre_increment_rpm(key_hash, model_class, rpm_limit)
        if not rpm_ok:
            continue

        tpm_ok = await pre_increment_tpm(key_hash, model_class, estimated_tpm, tpm_limit)
        if not tpm_ok:
            if rpm_limit > 0:
                rpm_key = f"mcpmart:rpm:{key_hash}:{model_class}:{timestamp}"
                await valkey.client.decr(rpm_key)
            continue

        ROUND_ROBIN_POINTERS[model_class] = (idx + 1) % num_keys
        return key, key_hash, timestamp

    raise HTTPException(status_code=429, detail="All credentials are limit-exhausted or in cooldown.")

### `src/main.py`
```python
import time
import json
import uuid
import re
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response, Depends, HTTPException, Security, status
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import httpx

from src.config import settings
from src.valkey_client import valkey
from src.doctor import (
    run_gate1_static_validation,
    run_gate2_live_validation,
    check_force_startup
)
from src.key_manager import (
    set_valid_keys,
    resolve_model,
    estimate_tokens,
    acquire_key,
    rollback_limits,
    reconcile_tpm,
    put_on_cooldown,
    latency_history
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("mcpmart.gateway")

@asynccontextmanager
async def gateway_lifespan(app: FastAPI):
    # Connect and lock to Valkey dependency (fail fast)
    try:
        await valkey.connect()
    except Exception as e:
        logger.critical(f"Hard dependency check failed. Valkey connection refused: {e}. Aborting startup.")
        import sys
        sys.exit(1)

    # Execute Gate 1 static filters
    raw_keys = run_gate1_static_validation()

    # Execute Gate 2 live diagnostic doctor checks
    force = check_force_startup()
    active_keys = await run_gate2_live_validation(raw_keys, force)

    # Assign pool
    set_valid_keys(active_keys)
    yield
    await valkey.close()

app = FastAPI(lifespan=gateway_lifespan, title="MCPMart API Rotation Gateway")

security_agent = HTTPBearer(auto_error=False)

def verify_token(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security_agent)):
    password = settings.MCPMART_AUTH_TOKEN
    
    # Extract candidate keys
    auth_header = credentials.credentials if credentials else None
    api_key_header = request.headers.get("x-goog-api-key")
    query_key = request.query_params.get("key")

    if (auth_header != password and 
        api_key_header != password and 
        query_key != password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized security token."
        )

def strip_gemma_thinking(obj):
    """
    Recursively purges structural thinking keys from input parameters.
    """
    if isinstance(obj, dict):
        keys_to_remove = [k for k in obj.keys() if k.lower() in ("thinkingconfig", "thinking_config")]
        for k in keys_to_remove:
            del obj[k]
        for v in obj.values():
            strip_gemma_thinking(v)
    elif isinstance(obj, list):
        for item in obj:
            strip_gemma_thinking(item)

# =====================================================================
# ROUTE A: Native Google REST Proxy
# =====================================================================
@app.post("/models/{model}:{action}")
@app.post("/{api_version}/models/{model}:{action}")
async def route_a_native_proxy(
    model: str,
    action: str,
    request: Request,
    api_version: str = "v1beta",
    _auth = Depends(verify_token)
):
    model_class, upstream_model_name, rpm_limit, tpm_limit = resolve_model(model)

    body = await request.json()
    estimated_tpm = estimate_tokens(body)

    if model_class in ("gemma-4-31b", "gemma-4-26b"):
        strip_gemma_thinking(body)

    upstream_action_path = f"{upstream_model_name}:{action}"
    max_attempts = 3
    last_error = "Execution failure."

    for attempt in range(max_attempts):
        try:
            key, key_hash, timestamp = await acquire_key(model_class, estimated_tpm, tpm_limit, rpm_limit)
        except HTTPException as e:
            if attempt == 0:
                raise e
            break

        start_time = time.time()
        try:
            url = f"https://generativelanguage.googleapis.com/{api_version}/models/{upstream_action_path}?key={key}"
            headers = {"Content-Type": "application/json"}
            is_stream_action = "stream" in action.lower()

            client = httpx.AsyncClient(timeout=60.0)

            if is_stream_action:
                req_upstream = client.build_request("POST", url, json=body, headers=headers)
                resp_upstream = await client.send(req_upstream, stream=True)

                if resp_upstream.status_code != 200:
                    content_err = await resp_upstream.aread()
                    raise httpx.HTTPStatusError(
                        message=f"Status {resp_upstream.status_code}: {content_err.decode()}",
                        request=req_upstream,
                        response=resp_upstream
                    )

                latency_history.append(time.time() - start_time)

                async def event_generator():
                    actual_total = 0
                    has_usage = False
                    try:
                        async for chunk in resp_upstream.aiter_bytes():
                            yield chunk
                            # Capture metadata tokens passively to prevent stream corruption
                            try:
                                chunk_str = chunk.decode("utf-8", errors="ignore")
                                if "usageMetadata" in chunk_str:
                                    pt = re.search(r'"promptTokenCount"\s*:\s*(\d+)', chunk_str)
                                    ct = re.search(r'"candidatesTokenCount"\s*:\s*(\d+)', chunk_str)
                                    if pt and ct:
                                        actual_total = int(pt.group(1)) + int(ct.group(1))
                                        has_usage = True
                            except Exception:
                                pass

                        if has_usage:
                            await reconcile_tpm(key_hash, model_class, estimated_tpm, actual_total, timestamp)
                    except Exception as exc:
                        logger.error(f"Upstream stream failure on Route A: {exc}")
                        await rollback_limits(key_hash, model_class, estimated_tpm, rpm_limit, timestamp)
                        raise exc
                    finally:
                        await resp_upstream.aclose()
                        await client.aclose()

                return StreamingResponse(event_generator(), media_type="text/event-stream")

            else:
                resp_upstream = await client.post(url, json=body, headers=headers)
                await client.aclose()

                if resp_upstream.status_code != 200:
                    raise httpx.HTTPStatusError(
                        message=f"Status {resp_upstream.status_code}: {resp_upstream.text}",
                        request=resp_upstream.request,
                        response=resp_upstream
                    )

                latency_history.append(time.time() - start_time)

                try:
                    resp_json = resp_upstream.json()
                    metadata = resp_json.get("usageMetadata", {})
                    pt = metadata.get("promptTokenCount", 0)
                    ct = metadata.get("candidatesTokenCount", 0)
                    if pt or ct:
                        await reconcile_tpm(key_hash, model_class, estimated_tpm, pt + ct, timestamp)
                except Exception as ex:
                    logger.warning(f"Passive token parsing fail on Route A: {ex}")

                return Response(
                    content=resp_upstream.content,
                    status_code=resp_upstream.status_code,
                    headers={"Content-Type": "application/json"}
                )

        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            logger.error(f"Attempt {attempt+1} on Route A raised error: {exc}")
            last_error = str(exc)

            is_auth_error = False
            is_rate_limit = False
            is_timeout = isinstance(exc, httpx.TimeoutException)

            if isinstance(exc, httpx.HTTPStatusError):
                is_auth_error = exc.response.status_code in (401, 403)
                is_rate_limit = exc.response.status_code == 429

            if is_rate_limit or is_auth_error or is_timeout:
                await put_on_cooldown(key_hash, model_class)

            await rollback_limits(key_hash, model_class, estimated_tpm, rpm_limit, timestamp)
            continue

    raise HTTPException(status_code=502, detail=f"All failover attempts failed. Root error: {last_error}")

# =====================================================================
# ROUTE B: OpenAI Compatible Completions
# =====================================================================
@app.post("/v1/chat/completions")
@app.post("/v1/openai/chat/completions")
async def route_b_openai_completions(
    request: Request,
    _auth = Depends(verify_token)
):
    body = await request.json()
    model_id = body.get("model")
    if not model_id:
        raise HTTPException(status_code=400, detail="Missing 'model' attribute.")

    model_class, upstream_model_name, rpm_limit, tpm_limit = resolve_model(model_id)
    estimated_tpm = estimate_tokens(body)

    body["model"] = upstream_model_name

    if model_class in ("gemma-4-31b", "gemma-4-26b"):
        strip_gemma_thinking(body)

    is_stream = bool(body.get("stream", False))
    url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"

    max_attempts = 3
    last_error = "OpenAI compatible integration error."

    for attempt in range(max_attempts):
        try:
            key, key_hash, timestamp = await acquire_key(model_class, estimated_tpm, tpm_limit, rpm_limit)
        except HTTPException as e:
            if attempt == 0:
                raise e
            break

        start_time = time.time()
        try:
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}"
            }

            client = httpx.AsyncClient(timeout=60.0)

            if is_stream:
                req_upstream = client.build_request("POST", url, json=body, headers=headers)
                resp_upstream = await client.send(req_upstream, stream=True)

                if resp_upstream.status_code != 200:
                    content_err = await resp_upstream.aread()
                    raise httpx.HTTPStatusError(
                        message=f"Status {resp_upstream.status_code}: {content_err.decode()}",
                        request=req_upstream,
                        response=resp_upstream
                    )

                latency_history.append(time.time() - start_time)

                async def openai_stream_generator():
                    actual_total = 0
                    has_usage = False
                    try:
                        async for chunk in resp_upstream.aiter_bytes():
                            yield chunk
                            # Capture metadata tokens passively to prevent stream corruption
                            try:
                                chunk_str = chunk.decode("utf-8", errors="ignore")
                                if "usage" in chunk_str:
                                    pt = re.search(r'"prompt_tokens"\s*:\s*(\d+)', chunk_str)
                                    ct = re.search(r'"completion_tokens"\s*:\s*(\d+)', chunk_str)
                                    if pt and ct:
                                        actual_total = int(pt.group(1)) + int(ct.group(1))
                                        has_usage = True
                            except Exception:
                                pass

                        if has_usage:
                            await reconcile_tpm(key_hash, model_class, estimated_tpm, actual_total, timestamp)
                    except Exception as exc:
                        logger.error(f"Stream failure during mapping: {exc}")
                        await rollback_limits(key_hash, model_class, estimated_tpm, rpm_limit, timestamp)
                        raise exc
                    finally:
                        await resp_upstream.aclose()
                        await client.aclose()

                return StreamingResponse(openai_stream_generator(), media_type="text/event-stream")

            else:
                resp_upstream = await client.post(url, json=body, headers=headers)
                await client.aclose()

                if resp_upstream.status_code != 200:
                    raise httpx.HTTPStatusError(
                        message=f"Status {resp_upstream.status_code}: {resp_upstream.text}",
                        request=resp_upstream.request,
                        response=resp_upstream
                    )

                latency_history.append(time.time() - start_time)

                try:
                    resp_json = resp_upstream.json()
                    usage = resp_json.get("usage", {})
                    pt = usage.get("prompt_tokens", 0)
                    ct = usage.get("completion_tokens", 0)
                    if pt or ct:
                        await reconcile_tpm(key_hash, model_class, estimated_tpm, pt + ct, timestamp)
                except Exception as ex:
                    logger.warning(f"Passive token parsing fail on Route B: {ex}")

                return Response(
                    content=resp_upstream.content,
                    status_code=resp_upstream.status_code,
                    headers={"Content-Type": "application/json"}
                )

        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            logger.error(f"Attempt {attempt+1} on Route B raised error: {exc}")
            last_error = str(exc)

            is_auth_error = False
            is_rate_limit = False
            is_timeout = isinstance(exc, httpx.TimeoutException)

            if isinstance(exc, httpx.HTTPStatusError):
                is_auth_error = exc.response.status_code in (401, 403)
                is_rate_limit = exc.response.status_code == 429

            if is_rate_limit or is_auth_error or is_timeout:
                await put_on_cooldown(key_hash, model_class)

            await rollback_limits(key_hash, model_class, estimated_tpm, rpm_limit, timestamp)
            continue

    raise HTTPException(status_code=502, detail=f"All failover attempts failed. Root error: {last_error}")
```python
"""MCPMart entry point."""
import os
import uvicorn
from dotenv import load_dotenv

load_dotenv()

def main() -> None:
    host = os.getenv("MCPMART_HOST", "0.0.0.0")
    port = int(os.getenv("MCPMART_PORT", "18000"))
    uvicorn.run("src.main:app", host=host, port=port)

if __name__ == "__main__":
    main()
```

---

## 3. Server Startup/Shutdown Orchestrators

### `scripts/start.sh`
```bash
#!/bin/bash
set -e

# Resolve script directory and change context to repository root
cd "$(dirname "$0")/.."

echo "Wiping rate limiting tables on start lifecycle hook..."
if command -v valkey-cli &> /dev/null; then
    valkey-cli FLUSHALL || echo "Valkey flush failed, bypassing..."
elif command -v redis-cli &> /dev/null; then
    redis-cli FLUSHALL || echo "Redis flush failed, bypassing..."
else
    echo "Warning: Valkey command line interface utility not found."
fi

echo "Starting MCPMart gateway process on 0.0.0.0:18000..."
exec .venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 18000
```

### `scripts/stop.sh`
```bash
#!/bin/bash
echo "Stopping active MCPMart instances..."
pkill -f "uvicorn src.main:app" || echo "No running processes found."

echo "Purging Valkey databases..."
if command -v valkey-cli &> /dev/null; then
    valkey-cli FLUSHALL || echo "Valkey flush failed."
elif command -v redis-cli &> /dev/null; then
    redis-cli FLUSHALL || echo "Redis flush failed."
else
    echo "Warning: No database CLI tool available."
fi
```

### `scripts/restart.sh`
```bash
#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
bash "$DIR/stop.sh"
sleep 1
bash "$DIR/start.sh"
```

---

## 4. E2E Validation Verification Test Matrix

### `POC_mcpmart/test_openai_matrix.py`
```python
import asyncio
import httpx
import json

GATEWAY_URL = "http://10.32.34.243:18000"
AUTH_TOKEN = "localfreegemini"

headers = {
    "Authorization": f"Bearer {AUTH_TOKEN}",
    "Content-Type": "application/json"
}

openai_tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather for a location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "The city and state, e.g. Singapore"}
            },
            "required": ["location"]
        }
    }
}]

async def execute_test(model: str, stream: bool, use_tools: bool) -> bool:
    test_name = f"Model: {model} | Stream: {stream} | Tools: {use_tools}"
    print(f"\n--- Running: {test_name} ---")
    
    payload = {
        "model": model,
        "stream": stream,
        "messages": [{"role": "user", "content": "What is the weather in Singapore?" if use_tools else "Say ok"}]
    }
    if use_tools:
        payload["tools"] = openai_tools

    try:
        async with httpx.AsyncClient() as client:
            if stream:
                async with client.stream("POST", f"{GATEWAY_URL}/v1/chat/completions", headers=headers, json=payload, timeout=20.0) as response:
                    if response.status_code != 200:
                        print(f"FAIL: HTTP {response.status_code}")
                        return False
                    
                    has_content = False
                    has_tool_call = False
                    async for line in response.aiter_lines():
                        if line.startswith("data:"):
                            line = line[5:].strip()
                            if line == "[DONE]":
                                break
                            try:
                                data = json.loads(line)
                                choices = data.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    if delta.get("content"):
                                        has_content = True
                                    if delta.get("tool_calls"):
                                        has_tool_call = True
                            except Exception:
                                pass
                    
                    if use_tools:
                        if has_tool_call:
                            print("PASS: Stream returned tool calls.")
                            return True
                        else:
                            print("FAIL: Stream did not return tool calls.")
                            return False
                    else:
                        if has_content:
                            print("PASS: Stream returned content.")
                            return True
                        else:
                            print("FAIL: Stream returned no content.")
                            return False
            else:
                resp = await client.post(f"{GATEWAY_URL}/v1/chat/completions", headers=headers, json=payload, timeout=20.0)
                if resp.status_code != 200:
                    print(f"FAIL: HTTP {resp.status_code} - {resp.text}")
                    return False
                
                data = resp.json()
                choices = data.get("choices", [])
                if not choices:
                    print("FAIL: No choices returned")
                    return False
                
                message = choices[0].get("message", {})
                if use_tools:
                    if "tool_calls" in message:
                        print("PASS: Non-stream returned tool calls.")
                        return True
                    else:
                        print("FAIL: Non-stream did not return tool calls.")
                        return False
                else:
                    if message.get("content"):
                        print("PASS: Non-stream returned content.")
                        return True
                    else:
                        print("FAIL: Non-stream returned no content.")
                        return False

    except Exception as e:
        print(f"ERROR: {e}")
        return False

async def main():
    models = ["gemini-3.1-flash-lite", "gemma-4-31b", "gemma-4-26b"]
    streaming_options = [False, True]
    tool_options = [False, True]
    
    results = {}
    
    for model in models:
        for stream in streaming_options:
            for use_tools in tool_options:
                key = f"{model} | Stream={stream} | Tools={use_tools}"
                results[key] = await execute_test(model, stream, use_tools)
                
    print("\n" + "="*60)
    print("                12-TEST PERMUTATION SUMMARY")
    print("="*60)
    passed_count = 0
    for key, passed in results.items():
        status = "PASS" if passed else "FAIL"
        if passed:
            passed_count += 1
        print(f"{key}: {status}")
    print("="*60)
    print(f"Total: {passed_count}/12 passed.")

if __name__ == "__main__":
    asyncio.run(main())
```
