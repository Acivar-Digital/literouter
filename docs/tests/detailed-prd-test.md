# LiteRouter E2E Test Kit — Detailed Test Plan

**Version**: v2.5.0
**Last Updated**: 2026-06-18
**Purpose**: This document describes the complete end-to-end test protocol for LiteRouter. Feed this entire file to an LLM agent as a prompt — it must execute every test in order and report results.

---

## Table of Contents

1. [Test Environment Setup](#1-test-environment-setup)
2. [Test Models](#2-test-models)
3. [Suite A — Server Lifecycle](#3-suite-a--server-lifecycle)
4. [Suite B — Health & Metadata](#4-suite-b--health--metadata)
5. [Suite C — Single Provider: OpenRouter](#5-suite-c--single-provider-openrouter)
6. [Suite D — Single Provider: Nvidia](#6-suite-d--single-provider-nvidia)
7. [Suite E — Multi-Provider Routing](#7-suite-e--multi-provider-routing)
8. [Suite F — Key Rotation](#8-suite-f--key-rotation)
9. [Suite G — Streaming](#9-suite-g--streaming)
10. [Suite H — Error Handling](#10-suite-h--error-handling)
11. [Suite I — Auth & Security](#11-suite-i--auth--security)
12. [Suite J — Model Passthrough & Prefix Stripping](#12-suite-j--model-passthrough--prefix-stripping)
13. [Suite K — Rate Limiting](#13-suite-k--rate-limiting)
14. [Suite L — Payload Sanitization](#14-suite-l--payload-sanitization)
15. [Acceptance Criteria](#15-acceptance-criteria)

---

## 1. Test Environment Setup

### Prerequisites
```bash
cd ~/arthityap/literouter
uv sync                        # ensure dependencies installed
pkill -f uvicorn; sleep 1      # kill any existing instance
```

### Start the Server
```bash
uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 > /tmp/literouter_test.log 2>&1 &
echo $! > .literouter.pid
sleep 3
curl -sf http://localhost:7766/health | python3 -m json.tool   # confirm alive
```

### Server must be running for ALL tests below. If any test fails because the server is unreachable, restart the server first.

### Log Inspection
All server-side behavior is logged to `/tmp/literouter_test.log`. After each test, inspect logs with:
```bash
tail -50 /tmp/literouter_test.log
grep "Using rotated key" /tmp/literouter_test.log | tail -N
grep "error\|ERROR\|warning\|WARNING" /tmp/literouter_test.log | tail -N
```

---

## 2. Test Models

These are the models used for live E2E tests. They were chosen for fast response time and availability.

| Provider | Model ID | Why This Model |
|----------|----------|----------------|
| OpenRouter | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | Free, fast, OpenRouter-hosted |
| OpenRouter | `openrouter/anthropic/claude-3-haiku` | Fast, reliable for non-streaming test |
| Nvidia | `openai/gpt-oss-120b` | Supports `reasoning_content` (streaming thoughts), fast |

### OpenRouter Key
The `.env` has 5 OpenRouter API keys configured. Verify:
```bash
python3 -c "
import os; keys = os.environ.get('OPENROUTER_API_KEYS','')
print(f'OpenRouter keys: {len(keys.split(\",\"))}')
"
```

### Nvidia Key
The `.env` has 6 Nvidia API keys configured. Verify:
```bash
python3 -c "
import os; keys = os.environ.get('NVIDIA_API_KEYS','')
print(f'Nvidia keys: {len(keys.split(\",\"))}')
"
```

---

## 3. Suite A — Server Lifecycle

### Test A-1: Server Starts Successfully
```bash
curl -sf http://localhost:7766/health
```
**Expected**: HTTP 200, JSON with `{"status": "ok"}`.

### Test A-2: Server Reports Correct Providers
```bash
curl -sf http://localhost:7766/health | python3 -c "
import json,sys; d=json.load(sys.stdin)
providers = list(d['config']['providers'].keys())
print('Providers:', providers)
assert 'openrouter' in providers, 'openrouter missing'
assert 'nvidia' in providers, 'nvidia missing'
"
```
**Expected**: Both `openrouter` and `nvidia` listed.

### Test A-3: Correct Key Counts
```bash
curl -sf http://localhost:7766/health | python3 -c "
import json,sys; d=json.load(sys.stdin)
p = d['config']['providers']
print(f'OpenRouter keys: {p[\"openrouter\"][\"keys\"]}')
print(f'Nvidia keys: {p[\"nvidia\"][\"keys\"]}')
assert p['openrouter']['keys'] == 5
assert p['nvidia']['keys'] == 6
"
```
**Expected**: OpenRouter=5 keys, Nvidia=6 keys.

### Test A-4: Stop and Restart
```bash
kill $(cat .literouter.pid) 2>/dev/null; sleep 2
uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 > /tmp/literouter_test.log 2>&1 &
echo $! > .literouter.pid
sleep 3
curl -sf http://localhost:7766/health | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])"
```
**Expected**: `ok` after restart.

---

## 4. Suite B — Health & Metadata

### Test B-1: Health Endpoint Structure
```bash
curl -sf http://localhost:7766/health | python3 -c "
import json,sys; d=json.load(sys.stdin)
required = ['status','timestamp','config','router','queue','rateLimiter','metrics','redis']
for k in required:
    assert k in d, f'Missing key: {k}'
    print(f'  ✓ {k}')
print('All required keys present')
"
```
**Expected**: All 8 top-level keys present.

### Test B-2: Router Status Reports Key Counts
```bash
curl -sf http://localhost:7766/health | python3 -c "
import json,sys; d=json.load(sys.stdin)
rs = d['router']
for name, stats in rs.items():
    print(f'{name}: totalKeys={stats[\"totalKeys\"]}, deadKeys={stats[\"deadKeysCount\"]}, quarantined={stats[\"quarantinedKeys\"]}')
    assert stats['totalKeys'] > 0, f'{name} has 0 total keys'
    assert stats['deadKeysCount'] == 0, f'{name} has dead keys at startup'
"
```
**Expected**: All providers show correct key counts, zero dead/quarantined at startup.

### Test B-3: Metrics Initialized to Zero
```bash
curl -sf http://localhost:7766/health | python3 -c "
import json,sys; d=json.load(sys.stdin)
m = d['metrics']
assert m['requestsTotal'] == 0
assert m['requestsSuccess'] == 0
assert m['requestsError'] == 0
print('All metrics zero at startup')
"
```
**Expected**: All counters at 0.

---

## 5. Suite C — Single Provider: OpenRouter

### Test C-1: Non-Streaming Request
```bash
curl -sf -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/anthropic/claude-3-haiku","messages":[{"role":"user","content":"Reply with exactly one word: hello"}],"max_tokens":10,"stream":false}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
assert 'choices' in d, f'No choices: {d}'
assert d['choices'][0]['message']['content'], 'Empty content'
assert 'model' in d
print(f'Response: {d[\"choices\"][0][\"message\"][\"content\"]}')
print(f'Model: {d[\"model\"]}')
"
```
**Expected**: HTTP 200, valid response with content, model preserved.

### Test C-2: Free Model Request
```bash
curl -sf -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
assert 'choices' in d or 'error' in d  # may rate-limit, either is valid
print('Free model response:', 'choices' in d)
"
```
**Expected**: Either a valid response or a rate-limit error (both acceptable).

### Test C-3: Log Shows Key Rotation
After running C-1 or C-2, check:
```bash
grep "Using rotated key" /tmp/literouter_test.log | tail -3
```
**Expected**: Log line `[openrouter] Using rotated key: sk-or-v1-XXXX...` visible.

---

## 6. Suite D — Single Provider: Nvidia

### Test D-1: Nvidia Non-Streaming Request
```bash
curl -sf -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"nvidia/openai/gpt-oss-120b","messages":[{"role":"user","content":"What is 2+2? Give a short answer."}],"max_tokens":50}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
assert 'choices' in d, f'No choices: {d}'
assert d['choices'][0]['message']['content'], 'Empty content'
print(f'Response: {d[\"choices\"][0][\"message\"][\"content\"][:100]}')
# Check for reasoning_content (Nvidia gpt-oss-120b supports it)
msg = d['choices'][0]['message']
if msg.get('reasoning_content'):
    print(f'Reasoning: {msg[\"reasoning_content\"][:100]}...')
else:
    print('No reasoning_content (OK, model may not always include it)')
"
```
**Expected**: HTTP 200, valid Nvidia response. The `nvidia/` prefix is stripped before forwarding.

### Test D-2: Prefix Stripping Verification
The model `nvidia/openai/gpt-oss-120b` must be sent to Nvidia as `openai/gpt-oss-120b` (without `nvidia/` prefix). Verify in logs:
```bash
grep "OUTBOUND\|outbound\|target_url\|chat/completions" /tmp/literouter_test.log | tail -5
```
**Expected**: No `nvidia/nvidia/` double-prefix in outbound URL. The upstream call goes to `integrate.api.nvidia.com/v1/chat/completions` with model `openai/gpt-oss-120b`.

### Test D-3: Nvidia Key Rotation Log
```bash
grep "\[nvidia\] Using rotated key" /tmp/literouter_test.log | tail -3
```
**Expected**: Log line `[nvidia] Using rotated key: nvapi-XXXX...` visible.

---

## 7. Suite E — Multi-Provider Routing

### Test E-1: Same Endpoint, Different Providers
Run both requests and verify they hit different providers:
```bash
# OpenRouter request
curl -sf -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/anthropic/claude-3-haiku","messages":[{"role":"user","content":"one word: hello"}],"max_tokens":5}' \
  > /tmp/test_or.json 2>/dev/null &

# Nvidia request
curl -sf -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"nvidia/openai/gpt-oss-120b","messages":[{"role":"user","content":"one word: hello"}],"max_tokens":5}' \
  > /tmp/test_nv.json 2>/dev/null &
wait

echo "OpenRouter response:"
python3 -c "import json; d=json.load(open('/tmp/test_or.json')); print('  model:', d.get('model'), '| ok:', bool(d.get('choices')))" 2>/dev/null || echo "  (error)"

echo "Nvidia response:"
python3 -c "import json; d=json.load(open('/tmp/test_nv.json')); print('  model:', d.get('model'), '| ok:', bool(d.get('choices')))" 2>/dev/null || echo "  (error)"

echo "Logs:"
grep "Using rotated key" /tmp/literouter_test.log | tail -4
```
**Expected**: Both requests succeed (or return provider-level errors, not routing errors). Logs show keys from different pools being used.

### Test E-2: Unknown Provider Returns 400
```bash
curl -s -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"unknown-provider/some-model","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('Status code was 400, error:', d.get('error',{}).get('message','')[:80])
assert 'Unknown provider' in d.get('error',{}).get('message','') or 'unknown-provider' in d.get('error',{}).get('message','')
"
```
**Expected**: HTTP 400 with `"Unknown provider 'unknown-provider'"`.

### Test E-3: No Model Defaults to Config Provider
```bash
curl -sf -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"health check"}],"max_tokens":1}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
# Should route to default provider (openrouter) or health-check shortcut
print('Response keys:', list(d.keys()))
"
```
**Expected**: Valid response routed to default provider.

---

## 8. Suite F — Key Rotation

### Test F-1: Round-Robin Visits All OpenRouter Keys
Send 7 requests (more than 5 keys) and verify all 5 keys are used at least once:
```bash
for i in $(seq 1 7); do
  curl -sf -X POST http://localhost:7766/v1/chat/completions \
    -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free\",\"messages\":[{\"role\":\"user\",\"content\":\"r$i\"}],\"max_tokens\":1}" &
done
wait
echo "Keys used:"
grep "\[openrouter\] Using rotated key" /tmp/literouter_test.log | tail -7 | grep -o "sk-or-v1-[a-f0-9]*" | sort -u | wc -l
echo "Unique key prefixes:"
grep "\[openrouter\] Using rotated key" /tmp/literouter_test.log | tail -7 | grep -o "sk-or-v1-[a-f0-9]*" | sort -u
```
**Expected**: All 5 unique key prefixes appear across 7 requests (wraps around).

### Test F-2: Nvidia Rotation Independent of OpenRouter
Send 3 Nvidia + 3 OpenRouter requests interleaved. Each provider's rotation must be independent:
```bash
# Clear log
> /tmp/literouter_test.log
uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 > /tmp/literouter_test.log 2>&1 &
sleep 3

for i in 1 2 3; do
  curl -sf -X POST http://localhost:7766/v1/chat/completions \
    -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"nvidia/openai/gpt-oss-120b\",\"messages\":[{\"role\":\"user\",\"content\":\"nv$i\"}],\"max_tokens\":1}" &
  curl -sf -X POST http://localhost:7766/v1/chat/completions \
    -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free\",\"messages\":[{\"role\":\"user\",\"content\":\"or$i\"}],\"max_tokens\":1}" &
done
wait
echo "OpenRouter keys:"
grep "\[openrouter\] Using rotated key" /tmp/literouter_test.log | grep -o "sk-or-v1-[a-f0-9]*"
echo "Nvidia keys:"
grep "\[nvidia\] Using rotated key" /tmp/literouter_test.log | grep -o "nvapi-[a-zA-Z0-9_-]*"
```
**Expected**: 3 distinct OpenRouter keys, 3 distinct Nvidia keys. Each pool rotates independently.

---

## 9. Suite G — Streaming

### Test G-1: OpenRouter Streaming
```bash
curl -sf -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/anthropic/claude-3-haiku","messages":[{"role":"user","content":"Count to 3"}],"max_tokens":20,"stream":true}' \
  | python3 -c "
import sys
data = sys.stdin.buffer.read()
lines = data.decode('utf-8', errors='replace').strip().split('\n')
data_lines = [l for l in lines if l.startswith('data:')]
print(f'SSE data lines received: {len(data_lines)}')
assert len(data_lines) > 0, 'No SSE data lines'
has_done = any('[DONE]' in l for l in data_lines)
print(f'Has [DONE]: {has_done}')
for l in data_lines[:3]:
    print(f'  Sample: {l[:80]}')
"
```
**Expected**: Multiple `data:` lines received, includes `data: [DONE]`.

### Test G-2: Nvidia Streaming with Reasoning
```bash
curl -sf -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"nvidia/openai/gpt-oss-120b","messages":[{"role":"user","content":"What is 5+5? Think step by step."}],"max_tokens":100,"stream":true}' \
  | python3 -c "
import sys, json
data = sys.stdin.buffer.read()
lines = data.decode('utf-8', errors='replace').strip().split('\n')
data_lines = [l for l in lines if l.startswith('data:')]
print(f'SSE data lines: {len(data_lines)}')
# Try to parse one chunk
for l in data_lines[:3]:
    try:
        chunk = json.loads(l.replace('data: ','').strip())
        choices = chunk.get('choices', [])
        if choices:
            delta = choices[0].get('delta', {})
            if delta.get('reasoning_content'):
                print(f'  reasoning_content: {delta[\"reasoning_content\"][:60]}...')
            if delta.get('content'):
                print(f'  content: {delta[\"content\"][:60]}')
    except: pass
print(f'Has [DONE]: {any(\"[DONE]\" in l for l in data_lines)}')
"
```
**Expected**: Multiple SSE lines, some with `reasoning_content` delta, ends with `[DONE]`.

### Test G-3: Streaming Doesn't Hang
Set a max timeout — streaming requests must complete or error within 30 seconds:
```bash
timeout 30 curl -f -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free","messages":[{"role":"user","content":"hi"}],"max_tokens":5,"stream":true}' \
  > /dev/null 2>&1
echo "Exit code: $?"
```
**Expected**: Exit code 0 (success) or 28 (timeout from curl, acceptable for free models). NOT exit code 124 (killed by `timeout` command = hung).

---

## 10. Suite H — Error Handling

### Test H-1: Invalid Model Returns Error (Not Crash)
```bash
curl -s -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/this-model-does-not-exist-xyz","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('Error response:', json.dumps(d, indent=2)[:200])
assert 'error' in d or 'choices' in d  # either error or upstream response
"
```
**Expected**: HTTP 400 or upstream error propagated. Server does NOT crash.

### Test H-2: Invalid JSON Body
```bash
curl -s -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d 'not valid json' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('Status was 400:', d.get('error',{}).get('code'))
assert d.get('error',{}).get('code') == 400
"
```
**Expected**: HTTP 400, `"Invalid JSON body"`.

### Test H-3: Missing Auth Returns 401
```bash
curl -s -X POST http://localhost:7766/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/anthropic/claude-3-haiku","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('Error:', d.get('error',{}).get('message'))
assert d.get('error',{}).get('code') == 401
"
```
**Expected**: HTTP 401, `"Invalid API key"`.

### Test H-4: Wrong Auth Returns 401
```bash
curl -s -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer wrong-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/anthropic/claude-3-haiku","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
assert d.get('error',{}).get('code') == 401
print('Correctly rejected wrong key')
"
```
**Expected**: HTTP 401.

---

## 11. Suite I — Auth & Security

### Test I-1: No Auth Key Configured = Open Access
This requires a temporary `.env` change. Skip if `LITEROUTER_AUTH_KEY` is set.

### Test I-2: API Keys Not Leaked in Logs
After running any request, verify no full API key appears in logs:
```bash
grep -c "sk-or-v1-" /tmp/literouter_test.log
# Should only show truncated keys like "sk-or-v1-571cd6..."
grep "sk-or-v1-[a-f0-9]\{15,\}" /tmp/literouter_test.log | grep -v "Using rotated key" | head -5
```
**Expected**: No full keys in log lines. Only truncated prefixes in `[provider] Using rotated key:` lines.

### Test I-3: Request Body Not Logged
```bash
grep -c "RAW BODY\|OUTBOUND PAYLOAD\|TRANSFORMED ANTHROPIC" /tmp/literouter_test.log
```
**Expected**: 0 matches. Debug body logging was removed in v2.5.0.

---

## 12. Suite J — Model Passthrough & Prefix Stripping

### Test J-1: Model ID Preserved in Response
```bash
curl -sf -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/anthropic/claude-3-haiku","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('Response model:', d.get('model'))
# The model in the response should be the OpenRouter-routed version
assert d.get('model'), 'No model in response'
"
```
**Expected**: Model field present in response.

### Test J-2: Nvidia Prefix Stripped
Send `nvidia/openai/gpt-oss-120b`. The upstream Nvidia call must use `openai/gpt-oss-120b` (no `nvidia/` prefix). Verify the response comes from Nvidia (not OpenRouter):
```bash
curl -sf -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"nvidia/openai/gpt-oss-120b","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('Response model:', d.get('model'))
# Nvidia returns the model name without the nvidia/ prefix
print('Provider in response:', d.get('provider','N/A'))
"
```
**Expected**: Response model is `openai/gpt-oss-120b` (prefix stripped). Provider field shows Nvidia.

### Test J-3: OpenRouter Prefix Stripped
Send `openrouter/anthropic/claude-3-haiku`. The upstream OpenRouter call must use `anthropic/claude-3-haiku`:
```bash
curl -sf -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/anthropic/claude-3-haiku","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('Response model:', d.get('model'))
"
```
**Expected**: Response model is `anthropic/claude-3-haiku` (prefix stripped).

---

## 13. Suite K — Rate Limiting

### Test K-1: Rapid Requests Don't All Use Same Key
Send 5 rapid-fire requests. Due to rate limiting (min delay between calls), they should still rotate but may be spaced out:
```bash
> /tmp/literouter_test.log
uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 > /tmp/literouter_test.log 2>&1 &
sleep 3

for i in $(seq 1 5); do
  curl -sf -X POST http://localhost:7766/v1/chat/completions \
    -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free\",\"messages\":[{\"role\":\"user\",\"content\":\"rl$i\"}],\"max_tokens\":1}" &
done
wait
echo "Keys used:"
grep "\[openrouter\] Using rotated key" /tmp/literouter_test.log | grep -o "sk-or-v1-[a-f0-9]*" | sort -u
echo "Rate limit waits:"
grep "RateLimiter.*waiting" /tmp/literouter_test.log | wc -l
```
**Expected**: Multiple unique keys used. Some rate-limit waits logged (min delay = 3000ms).

---

## 14. Suite L — Payload Sanitization

### Test L-1: input_text Block Type Sanitized
OpenCode TUI sends `input_text` block types that some upstream providers reject. LiteRouter must convert them to `text`:
```bash
curl -sf -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/anthropic/claude-3-haiku","messages":[{"role":"user","content":[{"type":"input_text","text":"hello"}]}],"max_tokens":10}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
assert 'choices' in d, f'No choices: {d}'
print('Sanitized request succeeded')
"
```
**Expected**: HTTP 200, valid response. The `input_text` block was converted to `text` before forwarding.

### Test L-2: Responses API Format (input → messages)
```bash
curl -sf -X POST http://localhost:7766/v1/responses \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/anthropic/claude-3-haiku","input":[{"role":"user","content":"hi"}],"max_tokens":10}' \
  | python3 -c "
import json,sys; d=json.load(sys.stdin)
# input field should be converted to messages internally
print('Response keys:', list(d.keys())[:5])
"
```
**Expected**: HTTP 200. The `input` field is mapped to `messages` internally.

---

## 15. Acceptance Criteria

The test kit passes if and only if:

| # | Criterion | How to Verify |
|---|-----------|---------------|
| 1 | Server starts and health endpoint returns `ok` | Test A-1 |
| 2 | Both `openrouter` and `nvidia` providers configured | Test A-2 |
| 3 | 5 OpenRouter keys, 6 Nvidia keys | Test A-3 |
| 4 | Non-streaming requests work for both providers | Test C-1, D-1 |
| 5 | Streaming works for both providers | Test G-1, G-2 |
| 6 | Streaming doesn't hang | Test G-3 |
| 7 | Round-robin visits all keys in each pool | Test F-1, F-2 |
| 8 | Provider pools rotate independently | Test F-2 |
| 9 | Model prefix stripped before upstream | Test J-2, J-3 |
| 10 | Client model ID never overwritten | Test J-1 |
| 11 | Unknown provider returns 400 (not crash) | Test E-2 |
| 12 | Invalid JSON returns 400 | Test H-2 |
| 13 | Missing/wrong auth returns 401 | Test H-3, H-4 |
| 14 | No full API keys in logs | Test I-2 |
| 15 | No request body in logs | Test I-3 |
| 16 | `input_text` blocks sanitized | Test L-1 |
| 17 | `/v1/responses` endpoint works | Test L-2 |
| 18 | Rate limiting spaces out requests | Test K-1 |
| 19 | Server survives restart | Test A-4 |
| 20 | All health/metrics metadata correct | Test B-1, B-2, B-3 |

**Minimum passing threshold**: 18/20 tests must pass. Tests C-2 and G-3 may fail due to upstream rate limits on free models — this is acceptable if the error is a proper HTTP error response (not a server crash or hang).

---

## Appendix: Quick Test (Smoke Test)

For a fast sanity check, run only these 5 tests in order:

1. **A-1** — Server health
2. **C-1** — OpenRouter non-streaming
3. **D-1** — Nvidia non-streaming
4. **F-1** — Key rotation (7 requests, 5 unique keys)
5. **G-1** — OpenRouter streaming

If all 5 pass, the system is operational. Then run the full suite.

---

## Appendix: Test Result Template

Copy this template and fill in results:

```
LiteRouter E2E Test Results
Date: YYYY-MM-DD
Commit: <git SHA>
Tester: <name or "automated"]

Suite A (Lifecycle):     [ ] PASS  [ ] FAIL  Notes: ___
Suite B (Health):        [ ] PASS  [ ] FAIL  Notes: ___
Suite C (OpenRouter):    [ ] PASS  [ ] FAIL  Notes: ___
Suite D (Nvidia):        [ ] PASS  [ ] FAIL  Notes: ___
Suite E (Multi-Provider):[ ] PASS  [ ] FAIL  Notes: ___
Suite F (Rotation):      [ ] PASS  [ ] FAIL  Notes: ___
Suite G (Streaming):     [ ] PASS  [ ] FAIL  Notes: ___
Suite H (Errors):        [ ] PASS  [ ] FAIL  Notes: ___
Suite I (Security):      [ ] PASS  [ ] FAIL  Notes: ___
Suite J (Model/Prefix):  [ ] PASS  [ ] FAIL  Notes: ___
Suite K (Rate Limit):    [ ] PASS  [ ] FAIL  Notes: ___
Suite L (Sanitization):  [ ] PASS  [ ] FAIL  Notes: ___

Overall: ___/20 tests passed
```
