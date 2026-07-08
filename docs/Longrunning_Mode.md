# Fusion Dumb Forwarder (Port 7768)

Fusion is a standalone FastAPI sidecar on port 7768. It is a **dumb forwarder + smart rotator keyed on fusion groups**: each group (e.g. `local/google`, `pydantic/google`) declares its own upstream + protocol and dumb-forwards to a priority fallback chain with multi-key rotation. See **Group-Aware Routing (Upgrade)** below.

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

---

## Group-Aware Routing (Upgrade)

Fusion now routes by **fusion group**, not by entry path. Each group in `fusion.json`
declares its own `upstream` URL. The protocol is inferred from that URL:

- URL contains `/v1beta` → **native** Google SDK forward (`{upstream}/models/{model}:{action}`)
- otherwise → **OpenAI-compat** forward (`POST {upstream}` with `model` substituted in body)

This makes 7768 a dumb forwarder + smart rotator: for any fusion-group model it
substitutes the upstream model, rotates across the chain on 429/5xx/timeout, and
halts on 400/401/403. The sticky + circuit-breaker logic is shared across all groups.

### Groups

| group | upstream | protocol | purpose |
|-------|----------|----------|---------|
| `local/google` | `http://localhost:7767/v1beta` | native | OpenCode (TS proxy multi-key rotation) |
| `pydantic/google` | `http://localhost:7766/v1/chat/completions` | OpenAI-compat | pydantic-ai scripts |

Both use the same fallback chain:
`google/gemma-4-31b-it` → `google/gemini-3.1-flash-lite` → `google/gemma-4-26b-a4b-it`

### Why `pydantic/google` → `7766/v1` (not `/v1beta`)

pydantic-ai speaks OpenAI-compat only. `7766/v1/chat/completions` maps google to
Google's OpenAI-compat endpoint
(`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, see
`config.py`). `7766/v1beta` is the *native* Google SDK pass-through
(`main.py` → `.../v1beta/models/{model}:{action}`) and would reject an OpenAI
payload. So `pydantic/google` forwards to `7766/v1`, which performs the
OpenAI→Google step. `local/google` stays on `7767/v1beta` (native, via the TS
proxy) exactly as before.

### Entry path is irrelevant for fusion groups

A fusion-group model can arrive on either `/v1` or `/v1beta`; fusion uses the
**group's** protocol, not the entry path. pydantic-ai hits `7768/v1`
(OpenAI-compat) → group protocol = openai → forwarded to `7766/v1`. OpenCode hits
`7768/v1beta` → `local/google` group protocol = native → forwarded to `7767/v1beta`.

### Adding a new group (e.g. `pydantic/nvidia`)

Add an entry to `fusion.json`:

```json
"pydantic/nvidia": {
  "description": "nvidia fusion via 7766 OpenAI-compat, for pydantic-ai",
  "chain": ["nvidia/<model-a>", "nvidia/<model-b>", "nvidia/<model-c>"],
  "upstream": "http://localhost:7766/v1/chat/completions"
}
```

No `fusion.py` change required. Chain members must already exist in `models.json`
(validated at startup). Point pydantic-ai at `base_url=http://localhost:7768/v1`,
`model="pydantic/nvidia"`.

### Schema

```json
{
  "group-id": {
    "description": "...",
    "chain": ["provider/model-a", "provider/model-b", "..."],
    "upstream": "http://host:port/path"
  }
}
```

- `upstream` is optional. If omitted, fusion falls back to the global
  `FUSION_UPSTREAM_URL` (OpenAI-compat) or `FUSION_UPSTREAM_URL_NATIVE` (native)
  based on the entry path — preserving the legacy behavior.
- Protocol is inferred from `upstream` (`/v1beta` ⇒ native, else OpenAI-compat).

### Verified (upgrade)

- `pydantic/google` via `7768/v1` → `7766` OpenAI-compat → **200**,
  `X-Literouter-Model: google/gemma-4-31b-it`
- `local/google` via `7768/v1beta` → `7767` native → **200**
  (native `candidates` format preserved)
