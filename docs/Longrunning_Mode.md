# Fusion Dumb Forwarder (Port 7768)

Fusion is a standalone FastAPI sidecar on port 7768. It provides a single virtual model `local/google` that dumb-forwards to a priority fallback chain on the LiteRouter (7766) gateway.

No payload sanitization in fusion.py. No `thinkingConfig` stripping. Pure forwarder.

## Fallback Chain
`google/gemma-4-31b-it` → `google/gemini-3.1-flash-lite` → `google/gemma-4-26b-a4b-it`

## Bugs Fixed

### 1. Double `models/` prefix in native route
**Symptom**: 400 "model not recognized" — fusion sent `http://7766/v1beta/models/models/local/google:generateContent`
**Cause**: FastAPI route `@app.post("/v1beta/{model_name_and_action:path}")` captured `models/local/google:generateContent` as the path param. The `models/` prefix was embedded in `model_name`, so it wasn't found in `fusion_groups`, fell into passthrough, and another `models/` was prepended.
**Fix**: Added `models/` prefix stripping at the top of `fusion_native()` before model lookup.

### 2. Missing 400/401/403 halt in native fallback loop
**Symptom**: 400 errors from 7766 were falling through to the "success" relay path.
**Cause**: The native route's chain loop only checked for 429/5xx. Everything else (400, 401, 403) was treated as success.
**Fix**: Added explicit halt block for `400 <= status < 500` before the success relay.

## Verified
- curl through 7768 → 7766 → Google gemma-4-31b-it: 200 OK
- opencode CLI `-m google-trio/local/google "say hi in 3 words"`: 200 OK
