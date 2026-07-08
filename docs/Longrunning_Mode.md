# Fusion Dumb Forwarder (Port 7768)

Fusion is a standalone FastAPI sidecar on port 7768. It provides a single virtual model `local/google` that dumb-forwards to a priority fallback chain on the LiteRouter (7766) gateway.

No payload sanitization in fusion.py. No `thinkingConfig` stripping. Pure forwarder.

## Fallback Chain
`google/gemma-4-31b-it` → `google/gemini-3.1-flash-lite` → `google/gemma-4-26b-a4b-it`

## Bugs Fixed

### 1. Double `models/` prefix in native route
**Symptom**: 400 "model not recognized" — fusion sent `http://7766/v1beta/models/models/local/google:generateContent`
**Cause**: FastAPI route captured `models/` prefix in path param, model wasn't found in fusion groups, fell to passthrough which added another `models/`.
**Fix**: Strip `models/` prefix before model lookup.

### 2. Missing 400/401/403 halt in native fallback loop
**Symptom**: 400 errors from 7766 fell through to the "success" relay path.
**Fix**: Added explicit halt block before success relay.

## Sticky Fallback

The original design always starts from the top of the chain on every request. This means gemma-4-31b-it is retried every ~65s, even if it's still rate-limited, wasting requests and keeping the trio frozen.

**Sticky fallback**: once the chain falls back to a lower-priority model and it succeeds, subsequent requests start from THAT position instead of the top. The sticky position expires after 5 minutes, at which point the primary is tried again (giving it real cooldown time).

### Behavior
1. Request comes in → try primary (gemma-4-31b-it) → 429 → fall to gemini-flash → 200
2. **Sticky set** to gemini-flash for 5 minutes
3. Next 5 minutes of requests start directly at gemini-flash, skipping gemma-4-31b-it entirely
4. After 5 minutes: sticky expires → try gemma-4-31b-it again
5. If primary succeeds → clear sticky (we're back to best model)
6. If primary still 429 → fall back again, refresh sticky timer

### Implementation
- `STICKY_TTL = 300.0` (5 minutes)
- `sticky_position: Dict[str, tuple[str, float]]` — group_id → (upstream_id, expiry_timestamp)
- Applied in both OpenAI and native route chain loops
- On success: if index > 0 (fallback), `_set_sticky()`; if index == 0 (primary), `_clear_sticky()`

## Verified
- curl through 7768 → 7766 → Google gemma-4-31b-it: 200 OK
- opencode CLI `-m google-trio/local/google "say hi in 3 words"`: 200 OK
