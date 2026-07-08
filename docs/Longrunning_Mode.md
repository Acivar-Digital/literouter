# Long-running Mode: Eliminating the "All Models Freeze"

**Status:** ✅ IMPLEMENTED & DEPLOYED (2026-07-08)
**Beads:** `literouter-9ar` (diagnosis — closed), `literouter-4dh` (fix — closed)
**Scope:** 2 surgical changes — one in `src/main.py` (gateway), one in `fusion.py` (sidecar).
No changes to `router.py`, `config.py`, `models.json`.

**Verification at deploy:** `ruff check` — zero NEW errors (11 pre-existing `E501` long-line
violations elsewhere in `main.py` untouched). Both files compile. Services restarted via
`scripts/restart.sh` (gateway :7766 + fusion sidecar :7768 live). User to drive live testing.

---

## 1. The Problem

### 1.1 Goal
`local/google` must run **autonomously for hours/days** under opencode/pydantic-ai load,
rotating across `gemma-4-31b-it → gemini-3.1-flash-lite → gemma-4-26b-a4b-it` so a single
model's rate limit never stops the agent.

### 1.2 Why it currently freezes
Two independent defects stack into a self-freezing cascade.

**Defect A — the gateway burns keys on client errors (DOMINANT trigger).**
`src/main.py` treats **any** upstream `>= 400` as a node failure:

```python
# main.py:472-475  (OpenAI route)  — identical block at 362-364 (SDK route)
if upstream_resp.status_code >= 400:
    if is_stream:
        await upstream_resp.aread()
    upstream_resp.raise_for_status()   # 400 -> HTTPStatusError
```

The `except (httpx.HTTPStatusError, ...)` block then calls
`router.report_error(provider, key, "400", model)` → `router.py:230` falls into the
`else` branch → **30s `error_400` cooldown per key**. The loop retries the *same bad
request* on the next key, burning all 5 keys, then `NoDeploymentsAvailable` → **429** to the
caller. A single malformed/oversized client request thus ices every key for a model.

**Log proof** (`gateway_7766.log` + `fusion_sidecar.log`): the incident shows
**27 `error_400` cooldowns** — the largest category (vs 9 `rate_limited`, 8 `error_500`,
1 `timed_out`). At `19:03:41` `gemini-3.1-flash-lite` lost all 4 keys to 400s; the sidecar
received 429 and chained to the next model, repeating the burn.

**Defect B — the sidecar is blind to *why* it got 429, so it always walks the full chain.**
`fusion.py:182` advances to the next model on **every** 429/5xx:

```python
if resp.status_code == 429 or resp.status_code >= 500:
    continue   # advance — no memory, no backoff
```

The sidecar has **no per-model memory**. So when `gemma` is cooled (Defect A, or a real
rate limit), the very next autonomous request re-hits `gemma` first, gets 429, burns
`gemini`, gets 429, burns `gemma-26b`, and **all three are iced for 65s**. Under continuous
load this repeats every cycle → permanent freeze. This is the amplification Gemini-Pro
correctly flagged; the studio pinpointed Defect A as its biggest fuel.

### 1.3 What is NOT wrong
- **The trio/fallback concept is sound.** Google limits are per-model **and** per-project;
  each API key = one project = an independent quota pool. `router.py` already scopes
  cooldowns per `(key, model)`, so multi-key rotation is real resilience.
- **The 400 fix alone is necessary but NOT sufficient** — Defect B still freezes the trio
  under *legitimate* rate-limit bursts (the 9 real `rate_limited` events). Both fixes are
  required for durable autonomy.

---

## 2. The Fix

### Fix A — Gateway: stop 400 from burning keys  (`src/main.py`, both routes)

Short-circuit **400 only** (client's bad request). Return it verbatim to the caller so the
client sees its own error and self-corrects. 401/403 are deliberately **left alone** —
`router.py:227` quarantines dead/revoked keys for 7 days, which is correct behaviour.

**Edit 1 — SDK route, `src/main.py:362-364`:**
```python
            if upstream_resp.status_code >= 400:
                await upstream_resp.aread()  # Avoid connection leaking
                # LONG-RUNNING FIX: a 400 is the client's bad request, not a key/node
                # failure. Return it verbatim; do NOT report_error (no cooldown burn).
                if upstream_resp.status_code == 400:
                    return Response(
                        content=upstream_resp.content,
                        status_code=400,
                        headers={k: v for k, v in upstream_resp.headers.items()
                                 if k.lower() not in ("transfer-encoding", "content-encoding")},
                    )
                upstream_resp.raise_for_status()
```

**Edit 2 — OpenAI route, `src/main.py:472-475`** (identical block, non-stream branch uses
`upstream_resp.content` after `aread`):
```python
            if upstream_resp.status_code >= 400:
                if is_stream:
                    await upstream_resp.aread()
                # LONG-RUNNING FIX: 400 = client error, return verbatim, no key burn.
                if upstream_resp.status_code == 400:
                    content = await upstream_resp.aread() if not is_stream else upstream_resp.content
                    return Response(
                        content=content,
                        status_code=400,
                        headers={k: v for k, v in upstream_resp.headers.items()
                                 if k.lower() not in ("transfer-encoding", "content-encoding")},
                    )
                upstream_resp.raise_for_status()
```

Effect: client errors cost **zero** key cooldowns. The sidecar's existing "halt on 400"
logic (`fusion.py:188`) then returns the 400 to the agent instead of chaining.

### Fix B — Sidecar: per-model circuit breaker  (`fusion.py`)

Give the sidecar memory of *which upstream is currently cooled*, matching the gateway's
65s rate-limit cooldown. A burned model stays out of the rotation for 65s across requests,
so the next autonomous call doesn't re-ignite it (and the others). When **all** models are
cooled, fail fast with 429 instead of cycling and re-burning keys.

**Add near module top (`fusion.py`, after `fusion_groups`):**
```python
import time

# Per-model circuit breaker: mirrors gateway's 65s rate-limit cooldown.
CIRCUIT_TTL = 65.0
circuit_open_until: Dict[str, float] = {}

def _open_circuit(upstream_id: str) -> None:
    circuit_open_until[upstream_id] = time.time() + CIRCUIT_TTL

def _circuit_open(upstream_id: str) -> bool:
    return time.time() < circuit_open_until.get(upstream_id, 0.0)

def _close_circuit(upstream_id: str) -> None:
    circuit_open_until.pop(upstream_id, None)
```

**Modify PATH B loop (`fusion.py:172-230`):**
```python
    chain = fusion_groups[model].chain
    for i, upstream_id in enumerate(chain):
        # Skip an upstream we know is currently cooled (don't re-burn its keys).
        if _circuit_open(upstream_id):
            logger.info(f"{model} {upstream_id} {i+1}/{len(chain)} circuit-open, skipping")
            continue

        body["model"] = upstream_id
        try:
            req = http_client.build_request(
                "POST", FUSION_UPSTREAM_URL, headers=req_headers, json=body
            )
            resp = await http_client.send(req, stream=True)

            # Advance on 429 (exhausted/cooldown) or 5xx (upstream failure)
            if resp.status_code == 429 or resp.status_code >= 500:
                logger.info(f"{model} {upstream_id} {i + 1}/{len(chain)} -> {resp.status_code}")
                # If the gateway says all keys are cooled/exhausted, open the circuit
                # so subsequent requests skip this model for 65s instead of re-burning it.
                detail = ""
                try:
                    detail = (await resp.aread()).decode("utf-8", "ignore")
                except Exception:
                    pass
                if "cooldown" in detail or "exhausted quota" in detail:
                    _open_circuit(upstream_id)
                    logger.warning(f"{model} {upstream_id} circuit OPEN (cooldown detected)")
                else:
                    await resp.aclose()
                continue

            # Halt on 400, 401, 403 (client/auth errors) — Fix A makes 400 cheap.
            if 400 <= resp.status_code < 500 and resp.status_code != 429:
                logger.info(f"{model} {upstream_id} {i + 1}/{len(chain)} halt {resp.status_code}")
                content = await resp.aread()
                return Response(
                    content=content,
                    status_code=resp.status_code,
                    headers=clean_headers(resp.headers),
                )

            # Success (2xx) — recover the model early.
            _close_circuit(upstream_id)
            logger.info(f"{model} {upstream_id} {i+1}/{len(chain)} stream={is_stream}")
            resp_headers = clean_headers(resp.headers)
            resp_headers["X-Literouter-Model"] = upstream_id
            if is_stream:
                async def stream_gen(response):
                    try:
                        async for chunk in response.aiter_raw():
                            yield chunk
                    finally:
                        await response.aclose()
                return StreamingResponse(stream_gen(resp), status_code=resp.status_code, headers=resp_headers)
            else:
                content = await resp.aread()
                return Response(content=content, status_code=resp.status_code, headers=resp_headers)

        except (httpx.RequestError, httpx.TimeoutException) as e:
            logger.info(f"{model} {upstream_id} {i + 1}/{len(chain)} error: {e}")
            continue

    # Exhausted all backends
    logger.warning(f"fusion group={model} exhausted all backends")
    return JSONResponse(
        status_code=429,
        content={"error": "all fusion backends exhausted", "model": model, "attempted": chain},
    )
```

Notes:
- Circuit opens only on the gateway's **"cooldown"/"exhausted quota"** 429 (a real
  all-keys-cooled signal), not on every transient 429 — so a genuine one-off upstream 429
  still advances normally.
- A successful response clears the circuit immediately, so a model that recovered early is
  reused without waiting out the full 65s.

---

## 3. Expected Outcome

| Before | After |
|--------|-------|
| One bad client request ices all 5 keys of a model for 30s | 400 returned to client; **0 key cooldowns** |
| Sidecar re-hits cooled models every request → whole trio frozen 65s, repeating | Cooled models skipped for 65s; next request uses a healthy model immediately |
| `error_400` = 27/45 freeze events | `error_400` ≈ 0 |
| Under sustained load: permanent freeze | Under sustained load: graceful per-model backoff, self-heals in ≤65s |

**What this delivers:** `local/google` survives bad prompts, key cooldowns, and real
rate-limit bursts without manual intervention — meeting the long-running autonomous goal.

**Honest residual risk (by design, not a bug):** if Google rate-limits **all three**
models' keys *simultaneously* under an extreme shared burst, all circuits open and the
trio returns 429 for ≤65s. This is correct backpressure (honest "try later"), not a
*freeze* — it self-heals automatically and never requires a restart.

**Verification plan (post-implementation):**
1. `uv run ruff check .` — clean.
2. Restart gateway + sidecar (`scripts/restart.sh`).
3. Reproduce a 400 (oversized context) → confirm gateway logs NO `error_400` cooldown and
   sidecar returns the 400 to the client without chaining.
4. `uv run python TEST/test_run.py` — full suite green.
5. Sustained load test: hammer `local/google` past 15-RPM to confirm trio rotates and
   recovers within 65s (no permanent freeze).

---

*Review requested. Approved 2026-07-08 — implemented (Fix A + Fix B) with the two
refinements: gateway uses `upstream_resp.content` directly (body already loaded by the
`is_stream` `aread` above); sidecar releases the connection in a `finally` block after
`aread`. Deployed via `scripts/restart.sh`. User to validate under live autonomous load.*
