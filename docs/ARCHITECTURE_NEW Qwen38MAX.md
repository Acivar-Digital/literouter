## Senior QA / Data Center SME Review

### Short answer

**I would not approve LiteRouter V4.4 for general production as described.**

The architecture is strong conceptually. The station model is clear, the separation of check-in / runway / flight / landing / rescue is sensible, and the dual-queue design is a reasonable way to isolate key availability from provider rate pacing.

However, as a production gateway in a real data-center / multi-tenant environment, the plan still has several **logic gaps, operational risks, and edge cases** that could cause:

- duplicate provider billing from unsafe retries,
- memory exhaustion from unbounded queues,
- cross-tenant or cross-conversation signature leakage,
- stream corruption during provider resets,
- key-pool thundering herds,
- admin endpoint abuse,
- undefined behavior during client aborts,
- inconsistent behavior across multiple gateway replicas,
- silent semantic loss during payload conversion.

My recommendation:

> **Do not cut over to general production yet.**  
> Approve only a **controlled internal canary** after the P0 items below are closed, tested, and observable.

---

# 1. Overall Assessment

## What is good

The plan has several strong design choices:

1. **Clear separation of concerns**
   - Immigration / Check-In / Takeoff / Runway / Flight / Landing / Rescue is easy to reason about.
   - Each stage has a clear responsibility.

2. **Explicit provider abstraction**
   - The 5-part directive token is a useful routing grammar.
   - Provider, payload format, completion route, and model nuance are separated cleanly.

3. **Retry and quarantine awareness**
   - Key quarantine, recall tower, VIP retry lane, and blackbox buffer show awareness of upstream instability.

4. **Streaming awareness**
   - TTFT radar, SSE translation, tool-call assembly, and client abort handling are important for AI gateway correctness.

5. **Operational endpoints**
   - `/health`, `/reset`, and `doctor.ts` show operational intent.

But the plan is still more of a **functional architecture** than a **production reliability architecture**.

The main missing pieces are:

- security and authorization model,
- state ownership across replicas,
- bounded backpressure,
- retry idempotency,
- timeout hierarchy,
- provider error taxonomy,
- observability depth,
- chaos and load-test proof.

---

# 2. Production Approval Decision

## Verdict

### General production: **No-Go as-is**

### Controlled canary: **Possible after P0 closure**

I would allow a limited canary only if:

1. traffic is internal or low-risk,
2. spend caps exist per key and per tenant,
3. all admin endpoints are authenticated,
4. queue depth and memory limits are enforced,
5. retry behavior is proven safe,
6. observability is complete,
7. chaos tests simulate provider failure,
8. rollback to the previous gateway is one command.

For external multi-tenant production, I would require more than the current blueprint.

---

# 3. Critical P0 Gaps

These are the issues I would treat as production blockers.

---

## P0-1: Authentication and authorization model is underspecified

The blueprint says:

> Every incoming API request presents a 5-part directive token in the `Authorization: Bearer sk-lr-...` header.

But it does not define:

- how the token is authenticated,
- whether the token is signed,
- whether routing segments are tamper-proof,
- how tenant identity is resolved,
- what scopes exist,
- whether a tenant can force expensive providers,
- how keys are revoked,
- how rate limits and spend caps are applied per tenant.

### Risk

If the client can choose:

```text
lr-or-...
lr-oa-...
lr-an-...
lr-nv-...
```

then a client may be able to route traffic to expensive providers or bypass policy.

If the routing segments are embedded in the bearer token but not signed or bound to a server-side policy, the token may be forgeable or tamperable.

### Required fix

Define a clear auth model:

```text
Bearer token -> authenticated identity -> server-side routing policy
```

The token should not be the only source of routing truth unless it is cryptographically protected and validated.

At minimum:

- token lookup or signature verification,
- tenant ID,
- allowed providers,
- allowed payload formats,
- allowed completion routes,
- allowed models,
- allowed nuances,
- rate limits,
- spend caps,
- revocation list or versioning.

### Production gate

Do not go live if clients can choose arbitrary provider routing without server-side policy enforcement.

---

## P0-2: Retry behavior may duplicate non-idempotent upstream calls

The blueprint says:

> Pre-Commit Crash (0 bytes sent): Silent VIP Clone & Retry on Key #2.

This is risky.

A chat completion request is usually **not idempotent**. If the gateway sends a request to an upstream provider and then experiences a socket error, the gateway may not know whether the provider received it.

Possible cases:

1. TCP connection failed before request was sent.
2. TLS handshake failed.
3. Request headers were sent but body was not.
4. Full body was sent but response timed out.
5. Provider received request but connection reset before response.
6. Provider started generating tokens but response stream broke.

Only some of these are safe to retry.

### Risk

If the gateway retries too aggressively:

- duplicate provider charges,
- duplicate tool execution,
- duplicate side effects,
- inconsistent conversation state,
- user-visible duplicated answers,
- incorrect token accounting.

### Required fix

Define a precise commit state machine.

Example:

```text
NOT_SENT
CONNECTING
HEADERS_SENT
BODY_SENT
UPSTREAM_ACK_RECEIVED
FIRST_RESPONSE_BYTE_RECEIVED
STREAM_COMMITTED_TO_CLIENT
```

Retry rules should be explicit:

| State | Safe to retry? |
|---|---|
| DNS failure | Yes |
| TCP connect failure | Yes |
| TLS handshake failure | Yes |
| Request not written | Yes |
| Request partially written | No, unless provider supports idempotency |
| Full request written | Generally no |
| Response headers received | No |
| Any response bytes sent to client | No |

Also define:

- whether `Idempotency-Key` is sent where supported,
- whether duplicate spend is tracked,
- whether retried requests are marked in logs,
- how clients are billed or notified.

### Production gate

No silent retries after the request may have reached upstream unless the provider supports safe idempotency.

---

## P0-3: Queue 2 has no artificial timeout and can become unbounded

The blueprint says:

> NO artificial queue timeout (requests wait peacefully until their turn).

In production, this is dangerous.

If provider pacing is:

- OpenRouter 200ms,
- Google 2000ms,

then max theoretical throughput per conveyor is:

- OpenRouter: ~5 requests/sec,
- Google: ~0.5 requests/sec.

If inbound traffic exceeds that, Queue 2 grows forever.

### Risk

- memory exhaustion,
- event-loop pressure,
- file-descriptor exhaustion,
- head-of-line blocking,
- client timeouts while queued,
- invisible requests that consume global timeout but are not processed,
- cascading failure during provider slowdowns.

### Required fix

Queue 2 must have:

- max queue depth per airline,
- max queue wait time,
- admission control,
- early rejection with `429` or `503`,
- queue metrics,
- backpressure to Station 1,
- eviction of expired requests,
- coordination with the 180s global lifecycle.

Example:

```text
Queue depth > 1000 -> reject with 429
Queue projected wait > 30s -> reject with 429
Global deadline expired -> cancel before provider call
```

### Production gate

No unbounded production queue is acceptable.

---

## P0-4: Timeout hierarchy is not fully defined

You mention:

- 180s global flight lifecycle,
- 120s lounge timeout,
- 15s standard TTFT guard,
- 60s reasoning TTFT guard,
- 60s quarantine,
- no artificial queue timeout.

But the relationship between these timers is unclear.

Questions:

1. Does the 180s timer start at ingress?
2. Does it include Queue 1 wait?
3. Does it include Queue 2 wait?
4. Does it include upstream TTFT?
5. Does it include full stream duration?
6. If a request waits 120s in the lounge, does it only have 60s left?
7. If TTFT radar fires after 60s, does the global timer still allow retry?
8. If the client disconnects, are all timers cancelled immediately?
9. If a retry happens, does the clock reset or inherit the original deadline?

### Risk

Timeouts can conflict:

- request may be cancelled by the global timer after response starts,
- retry may begin when there is no time left,
- timers may leak,
- clients may receive partial responses and then abrupt disconnects,
- upstream connections may remain open after client abort.

### Required fix

Create a single deadline object attached to the request lifecycle.

Example:

```text
request_deadline = now + 180s
```

Every stage checks:

```text
remaining = request_deadline - now
```

Rules:

- Queue 1 cannot wait past deadline.
- Queue 2 cannot wait past deadline.
- TTFT radar cannot exceed remaining deadline.
- Retry only allowed if enough remaining time exists.
- Client abort cancels all timers and upstream sockets.
- No timer may outlive the request.

### Production gate

Need a documented timeout hierarchy and test coverage for expired-delegate scenarios.

---

## P0-5: State is in-memory and may not work across replicas

The plan depends on:

- key round-robin state,
- key quarantine state,
- sticky fallback state,
- thought-signature cache,
- active-flight tracking,
- queue state,
- recall broadcasts.

These appear to be process-local.

### Risk

If LiteRouter runs as more than one replica:

- key rotation may double-use keys,
- quarantines may be inconsistent,
- sticky fallback may flap,
- retry counters may be inconsistent,
- thought-signature cache may not be available across nodes,
- a retried request may land on a node without signature state,
- active-flight counts may be wrong,
- provider concurrency limits may be violated.

If LiteRouter runs as one replica:

- it is a single point of failure,
- deploy causes downtime,
- crash loses queue and cache state,
- memory growth requires restart.

### Required fix

Explicitly define the deployment model.

Option A: **Single-node gateway**

Then document:

- no horizontal scaling,
- graceful restart behavior,
- queue drain behavior,
- client retry expectations,
- health-check failover.

Option B: **Multi-node gateway**

Then define shared state for:

- key quarantine,
- active key leases,
- retry attempt counters,
- signature cache,
- sticky preset state,
- queue admission,
- rate pacing.

This may require Redis, SQLite, shared memory, or another coordination mechanism. If the zero-dependency rule prevents this, the production topology must be restricted accordingly.

### Production gate

Do not run multi-replica with process-local state unless you accept undefined routing and retry behavior.

---

## P0-6: Thought-signature cache needs strict isolation and eviction rules

The Google Thought Signature Protocol says:

> LiteRouter's landing bridge caches the signature in memory for future turns.

This is one of the most dangerous parts of the plan.

Questions:

1. What is the cache key?
2. Is it per conversation?
3. Is it per tenant?
4. Is it per API key?
5. Is it per model?
6. Is it per provider account?
7. Is it per request?
8. How long is it retained?
9. What is the max memory size?
10. What happens if two concurrent requests use the same conversation?
11. What happens after gateway restart?
12. What happens if signature is stale?
13. Can one tenant receive or reuse another tenant’s signature?

### Risk

- cross-tenant data leakage,
- stale signature causing provider rejection,
- tool-call verification failures,
- memory leak,
- non-deterministic behavior across replicas,
- conversation corruption after restart.

### Required fix

Define a strict cache key such as:

```text
tenant_id:conversation_id:model:provider_account:signature_scope
```

Do not cache globally by model alone.

Also define:

- TTL,
- max entries,
- LRU eviction,
- concurrency locking,
- invalidation on provider error,
- behavior when cache miss occurs,
- no persistence unless encrypted and tenant-scoped.

### Production gate

Signature cache must be tested for isolation, staleness, concurrency, and memory growth.

---

## P0-7: Provider error classification is too coarse

The plan says:

> 429 / 5xx / Hang Handler: Quarantines failed key for 60 seconds.

That is too blunt for production.

Different errors mean different things.

### Examples

| Error | Meaning | Correct action |
|---|---|---|
| 401 | Invalid key | Remove key from pool, alert |
| 403 | Key lacks permission/model/region | Disable for that model/route |
| 429 with `Retry-After` | Rate limited | Respect header, maybe per model only |
| 429 without header | Rate limited | Backoff, reduce concurrency |
| 500 | Provider internal error | Retry possibly, track health |
| 502/503 | Provider outage | Circuit break provider or key |
| 504 | Timeout | Retry with different key if safe |
| TLS error | Infra issue | Mark socket unhealthy |
| GOAWAY | HTTP/2 drain | Reconnect |
| RST_STREAM | Stream failure | Classify per stream |
| Stall after 200 | Provider hang | TTFT radar abort |

Also, a 429 may be:

- per key,
- per model,
- per IP,
- per account,
- per project,
- global provider capacity.

Quarantining the whole key for 60s may be wrong.

### Required fix

Create an error taxonomy:

```text
PERMANENT_AUTH_ERROR
PERMISSION_ERROR
RATE_LIMIT_KEY
RATE_LIMIT_MODEL
RATE_LIMIT_GLOBAL
TRANSIENT_UPSTREAM_ERROR
CONNECTION_ERROR
STREAM_STALL
INVALID_REQUEST
CLIENT_ABORT
```

Each class should have:

- retry policy,
- quarantine scope,
- backoff policy,
- alert threshold,
- metric label.

### Production gate

Do not use a single 60s quarantine for all 429/5xx/hang failures.

---

## P0-8: Admin endpoints need strong protection

The plan defines:

```text
/health
/reset
```

`/reset` is especially dangerous.

If unauthenticated, anyone can flush quarantines and cause:

- thundering herd to upstream providers,
- retry storms,
- key burn,
- cost spike,
- provider rate-limit exhaustion.

`/health` can also leak operational data if exposed publicly.

### Required fix

Separate endpoints:

```text
/healthz
/readyz
/livez
/metrics
/admin/reset
```

Requirements:

- `/healthz` can be public or internal-only.
- `/readyz` should reflect queue pressure and upstream health.
- `/metrics` should require auth or network restriction.
- `/admin/reset` must require strong admin auth.
- Admin actions must be audit-logged.
- Admin endpoints should be rate-limited.
- `/reset` should support scoped reset, not only global reset.

Example:

```text
POST /admin/reset/provider/openrouter
POST /admin/reset/provider/google
POST /admin/reset/key/<key_id>
```

### Production gate

No production deployment should expose unauthenticated `/reset`.

---

## P0-9: Client abort semantics are incomplete

The plan says:

> Instant O(1) Eviction on client abort returning 499.

This is only possible if response headers have not been sent.

Once response has started, the gateway cannot send HTTP 499. It can only:

- close the stream,
- abort upstream,
- log the abort,
- emit metrics.

Also, HTTP/2 upstream may support `RST_STREAM`, but some upstreams may be HTTP/1.1.

### Edge cases

1. Client aborts while request is in Queue 1.
2. Client aborts while request is in Queue 2.
3. Client aborts after key assigned but before upstream connect.
4. Client aborts after request sent but before upstream response.
5. Client aborts after response headers sent.
6. Client aborts mid-SSE event.
7. Client aborts during tool-call assembly.
8. Client aborts during retry re-enqueue.
9. Load balancer closes connection but client is still alive.
10. Client timeout is shorter than queue wait.

### Required fix

Define abort handling per stage:

| Stage | Action |
|---|---|
| Immigration | close socket, no provider call |
| Check-In | release key, cancel queue wait |
| Takeoff | cancel conversion, release key |
| Runway queue | evict request, release slot |
| Flight before upstream send | abort, release key |
| Flight after upstream send | abort upstream if possible, mark attempt |
| Landing after response started | close stream, stop converter, abort upstream |

Also define status code behavior:

- before headers: `499` or `503` where appropriate,
- after headers: no status change, close stream,
- non-stream JSON: if timeout before response, return clean JSON error.

### Production gate

Abort storms must be load-tested.

---

## P0-10: Production evidence plan is insufficient

The plan says:

- `bun run typecheck`
- `bun test`
- live smoke test

That is not enough for a production AI gateway.

You need:

1. unit tests,
2. contract tests,
3. converter golden tests,
4. SSE stream reassembly tests,
5. integration tests with mock providers,
6. failure injection tests,
7. load tests,
8. soak tests,
9. memory leak tests,
10. abort storm tests,
11. security tests,
12. runbooks,
13. dashboards,
14. alert thresholds.

### Required production evidence

At minimum:

- 24-hour soak test with stable memory and FD count,
- load test at 2x expected peak,
- abort storm test,
- provider 429 chaos test,
- provider 5xx chaos test,
- stalled TTFT test,
- partial SSE test,
- GOAWAY/RST_STREAM test,
- large payload test,
- malformed payload fuzz test,
- auth failure test,
- admin endpoint security test.

---

# 4. Station-by-Station Logic Gaps and Edge Cases

## Station 0: Travel Agency / Fusion Presets

### Logic gaps

1. **Unknown preset behavior undefined**

   If client sends:

   ```text
   lr-fse-nonexistent
   ```

   what happens?

   Should return `401`, `403`, or `400`?

2. **No healthy tier behavior undefined**

   If all tiers are unhealthy, should the gateway:

   - return `503`,
   - attempt degraded mode,
   - queue indefinitely,
   - fail fast?

3. **Sticky fallback state scope undefined**

   Is sticky state:

   - global,
   - per tenant,
   - per preset,
   - per model,
   - per process,
   - persisted?

4. **Preset model conflict undefined**

   If preset resolves to one provider/model but request body contains a different model, which wins?

5. **Fusion preset may bypass authorization**

   If presets can resolve to expensive providers, policy must validate the final concrete ticket.

### Edge cases

- preset resolves to unsupported provider route,
- tier contains no active keys,
- tier health flaps rapidly,
- sticky fallback remembers a tier that later becomes unhealthy,
- two concurrent requests race to update sticky state,
- preset resolution succeeds but selected key burns before check-in,
- client sends preset and explicit provider segments simultaneously,
- preset cache becomes stale after config reload.

### Recommendation

Add a resolution contract:

```text
preset -> concrete ticket -> policy validation -> provider key check -> enqueue
```

Also add:

- preset allowlist,
- tier health hysteresis,
- max fallback attempts,
- fallback metrics,
- explicit no-healthy-tier error.

---

## Station 1: Immigration Gate

### Logic gaps

1. **Token parsing errors not fully specified**

   Need exact status codes:

   - missing token: `401`
   - malformed token: `401` or `400`
   - unknown provider: `400` or `403`
   - unsupported route: `400`
   - unsupported nuance: `400`
   - revoked tenant: `403`

2. **Body compression not addressed**

   If clients send gzip, br, or deflate, does the 10MB limit apply to:

   - compressed bytes,
   - decompressed bytes,
   - parsed JSON size?

   A small compressed payload can expand into a large JSON object.

3. **Slowloris protection not specified**

   The 10MB streaming byte counter helps, but you also need:

   - header timeout,
   - body read timeout,
   - idle connection timeout,
   - minimum read rate.

4. **HTTP method handling not specified**

   Expected methods:

   - `POST /v1/chat/completions`
   - `POST /v1/messages`
   - `POST /v1/embeddings`
   - `GET /v1/models`

   What about:

   - `OPTIONS`
   - `HEAD`
   - `GET` on POST routes
   - unknown routes

5. **Request ID missing**

   Production debugging requires a gateway request ID propagated to logs, metrics, traces, and upstream headers where safe.

### Edge cases

- Authorization header larger than body,
- non-ASCII token segments,
- token with extra segments,
- token with missing segments,
- duplicate Authorization headers,
- chunked transfer encoding,
- invalid `Content-Length`,
- body sent as empty string,
- body sent as `null`,
- body sent as array instead of object,
- `Content-Type: application/json; charset=utf-8; boundary=...`,
- client disconnects before body is fully read,
- HTTP/1.0 client,
- HTTP/2 stream reset during body upload.

### Recommendation

Add:

```text
Header timeout: 5s
Body read timeout: 15s
Max headers size: 16KB
Max auth header size: 4KB
Max body: 10MB compressed and decompressed
Request ID: required
```

Also reject unsupported methods with `405`.

---

## Station 2: Airline Check-In & Key Lounge

### Logic gaps

1. **Key locking lifecycle undefined**

   When is a key locked?

   - when assigned?
   - when leaving queue?
   - when upstream request begins?
   - when response begins?

   When is it released?

   - after response complete?
   - after client abort?
   - after quarantine?
   - after process crash?

2. **Active-flight concurrency per key undefined**

   Some providers limit concurrent requests per key. Round-robin alone is not enough.

3. **VIP lane starvation risk**

   If retried flights always bypass normal passengers, a retry storm can starve new requests.

4. **Key health scope undefined**

   A key may be healthy for one model but rate-limited for another.

5. **Round-robin across replicas undefined**

   Monotonic round-robin in one process is easy. Across multiple processes, it requires coordination.

### Edge cases

- all keys are quarantined,
- no keys configured for provider,
- key is valid but lacks model access,
- key is valid but region-blocked,
- key has low provider quota,
- key burns while waiting in lounge,
- key burns after assignment but before takeoff,
- request aborted while key is locked,
- process crashes while key is locked,
- retry request enters VIP lane repeatedly,
- multiple retries compete for the same healthy key,
- key pool configuration changes during request,
- provider returns 401 after previously successful use.

### Recommendation

Define key state machine:

```text
IDLE
ASSIGNED
IN_FLIGHT
COOLDOWN
PERMANENTLY_BAD
DRAINED
```

Also track:

```text
key_id
provider
model_scope
active_flights
max_concurrent_flights
success_count
error_count
last_error_class
cooldown_until
total_spend
```

Add priority aging so normal requests are not starved forever.

---

## Station 3: Takeoff Floor

### Logic gaps

1. **Malformed JSON vs invalid schema not separated**

   Malformed JSON should be `400`.

   Valid JSON but invalid schema may be `422` or provider-specific `400`.

2. **Payload converter matrix incomplete**

   The plan mentions:

   - `ao / cl -> oa`
   - `oa -> gg`

   But production needs a full compatibility matrix:

   | Client format | Provider | Route | Supported? |
   |---|---|---|---|
   | OpenAI | OpenRouter | chat | ? |
   | Anthropic | OpenRouter | chat | ? |
   | OpenAI | Google | generateContent | ? |
   | Google native | Google | generateContent | ? |
   | OpenAI | Anthropic | messages | ? |
   | Anthropic | Anthropic | messages | ? |
   | OpenAI | DeepSeek | chat | ? |
   | Responses | OpenAI | responses | ? |

   Unsupported combinations must fail fast.

3. **Model in body vs nuance in token conflict undefined**

   Example:

   Token says:

   ```text
   gm
   ```

   Body says:

   ```json
   {
     "model": "google/gemini-2.5-pro"
   }
   ```

   Which wins?

4. **Unknown nuance behavior undefined**

   If nuance is unrecognized, should gateway:

   - default to `no`,
   - reject with `400`,
   - pass through?

   Fail-open is risky.

5. **Unsupported features not specified**

   Examples:

   - images,
   - audio,
   - files,
   - tool calling,
   - response format JSON,
   - parallel tool calls,
   - function calling,
   - system vs developer role,
   - assistant prefill,
   - cache_control,
   - citations,
   - embeddings with dimensions,
   - structured outputs.

### Edge cases

- empty `messages` array,
- message with unknown role,
- consecutive system messages,
- consecutive user messages,
- consecutive assistant messages,
- tool_calls with missing arguments,
- tool_call_id mismatch,
- invalid JSON in tool arguments,
- huge base64 image,
- unsupported image MIME type,
- mixed text/image content,
- duplicate message IDs,
- request asks for both stream and non-stream behavior incorrectly,
- `temperature` out of range,
- `max_tokens` negative,
- `max_tokens` greater than provider maximum,
- `stop` sequences unsupported by provider,
- `response_format` unsupported by provider,
- `tools` present but nuance is not `tc`,
- reasoning parameters present for standard nuance,
- client sends `thinking` budget for non-thinking model,
- client sends Anthropic `tool_use` blocks to OpenAI route,
- client sends OpenAI tool deltas to Anthropic route.

### Recommendation

Add a converter contract:

```text
Input schema validation
Provider capability check
Nuance enforcement
Feature degradation policy
Unsupported feature error
Converter golden tests
```

Do not silently drop important fields. If a field is unsupported, return a clear error or document the loss.

---

## Station 4: Boarding Gate & Runway

### Logic gaps

1. **No queue timeout is dangerous**

   Already covered in P0-3, but worth repeating: production queues must be bounded.

2. **Rate pacing model is too simple**

   Fixed pacing per airline may not match provider behavior.

   Provider limits may be:

   - per key,
   - per model,
   - per project,
   - per IP,
   - per minute,
   - per day,
   - token-based,
   - burst-capable.

3. **Recall tower race conditions**

   If Recall Tower pulls passengers holding burned keys, what happens if:

   - request already left queue,
   - request already started upstream,
   - key becomes healthy again during recall,
   - multiple recalls happen concurrently?

4. **Dispatcher endpoint validation missing**

   The endpoint resolver must be a fixed allowlist.

   No part of the request should allow arbitrary URL construction.

### Edge cases

- queue is full,
- request expires while waiting,
- client aborts while queued,
- key burns while queued,
- airline conveyor is paused due to provider outage,
- request is recalled but already dispatched,
- duplicate recall events,
- provider endpoint changes,
- DNS failure for provider host,
- TLS handshake timeout,
- model not allowed on selected route,
- route and payload format mismatch,
- request attempts unsupported HTTP method,
- conveyor timer drifts under heavy load.

### Recommendation

Use a token-bucket or leaky-bucket model with dynamic adaptation:

```text
initial_rate = configured_rate
on_429 = reduce_rate_and_backoff
on_success = slow_recovery
on_retry_after = respect_header
```

Add per-queue metrics:

```text
queue_depth
queue_wait_p50
queue_wait_p95
evicted_count
recall_count
admission_rejected_count
```

---

## Station 5: In the Air / Pilot & Radar

### Logic gaps

1. **Commit point undefined**

   Critical for retry safety.

2. **HTTP/2 pool details incomplete**

   The plan says:

   > HTTP/2 Multi-Socket Connection Pool (>80 streams per TCP socket, GOAWAY drain)

   But production needs:

   - max concurrent streams per connection,
   - respect upstream `SETTINGS_MAX_CONCURRENT_STREAMS`,
   - connection idle timeout,
   - max connection age,
   - GOAWAY handling,
   - REFUSED_STREAM handling,
   - ENHANCE_YOUR_CALM handling,
   - RST_STREAM classification,
   - TLS session reuse,
   - DNS refresh,
   - socket health checks,
   - connection pool metrics.

3. **TTFT radar may not detect all stalls**

   TTFT is useful, but you also need:

   - time between chunks,
   - total stream duration,
   - empty keep-alive handling,
   - headers received but no body,
   - provider sends 200 but no SSE events,
   - provider sends SSE comments only.

4. **Body replay for retry not addressed**

   If request body was streamed into the first attempt, how do you retry?

   You must either:

   - buffer the full request body,
   - spool to temporary storage,
   - reject retry for large bodies,
   - require clients to resend.

   This has memory implications.

### Edge cases

- upstream connect timeout,
- TLS certificate failure,
- upstream returns 401 after key was selected,
- upstream returns 403 for model,
- upstream returns 429 with Retry-After,
- upstream returns 500 with HTML body,
- upstream returns 502 from CDN,
- upstream sends invalid JSON error,
- upstream sends `Content-Type: text/html` unexpectedly,
- upstream sends 200 but no body,
- upstream sends headers then stalls,
- upstream sends partial SSE event,
- upstream sends malformed UTF-8,
- upstream sends GOAWAY during flight,
- upstream sends RST_STREAM after partial response,
- upstream closes connection mid-body,
- key is quarantined while flight is active,
- global deadline expires after first token,
- client disconnects while upstream is still generating,
- provider returns non-stream JSON even though stream requested,
- provider returns stream even though stream false requested.

### Recommendation

Define radar guards:

```text
connect_timeout
tls_timeout
header_timeout
ttft_timeout
inter_chunk_timeout
total_stream_timeout
```

Also define HTTP/2 stream states:

```text
STREAM_IDLE
STREAM_HEADERS_SENT
STREAM_BODY_SENT
STREAM_RESPONSE_HEADERS_RECEIVED
STREAM_RESPONSE_DATA_RECEIVED
STREAM_CLOSED_BY_UPSTREAM
STREAM_RESET_BY_UPSTREAM
STREAM_ABORTED_BY_CLIENT
```

---

## Station 6: Landing Floor

### Logic gaps

1. **SSE error contract not fully defined**

   The plan says:

   > Emits clean SSE error block.

   But different clients expect different formats.

   OpenAI-compatible clients may expect:

   ```json
   {
     "error": {
       "message": "...",
       "type": "...",
       "code": "..."
     }
   }
   ```

   Anthropic clients may expect different event types.

   If response has already started, a normal HTTP error status is impossible.

2. **Tool-call assembler is high risk**

   OpenAI tool-call deltas can be fragmented.

   Need handle:

   - multiple parallel tool calls,
   - missing index,
   - out-of-order deltas,
   - duplicate indexes,
   - partial JSON arguments,
   - empty function name,
   - invalid JSON arguments,
   - tool call split across many chunks,
   - provider stop before tool call completes.

3. **Google signature stripping may break future turns**

   If signature is stripped before returning to client but not cached correctly, future tool calls may fail.

4. **Non-stream responses not addressed enough**

   The architecture is very stream-focused. But `/v1/models`, `/v1/embeddings`, and non-stream completions need clean JSON handling.

### Edge cases

- SSE event split across TCP chunks,
- multiple SSE events in one TCP chunk,
- SSE comment keep-alive lines,
- empty data lines,
- provider sends `data: [DONE]`,
- provider sends invalid JSON in SSE data,
- provider sends duplicate `finish_reason`,
- usage appears only in final chunk,
- usage missing entirely,
- tool-call arguments arrive as invalid JSON,
- Anthropic content block sequence interrupted,
- Google signature appears in unexpected position,
- client disconnects mid-tool-call,
- upstream sends final chunk after client disconnect,
- response encoding is not UTF-8,
- provider returns 200 with error JSON,
- stream ends without stop reason.

### Recommendation

Create golden SSE fixtures for:

- normal OpenAI stream,
- normal Anthropic stream,
- Google stream with signatures,
- OpenAI tool-call stream,
- Anthropic tool-use stream,
- partial UTF-8 stream,
- error after first token,
- provider stall,
- provider reset,
- client abort.

Test converters with property-based fuzzing.

---

## Station 7: Rescue & Recall Tower

### Logic gaps

1. **Retry budget may be unsafe**

   Max 3 attempts is good, but attempts must be tracked per request, not per queue hop.

2. **Retry budget may not survive process crash**

   If process restarts, retry count may reset unless persisted.

3. **Recall broadcast may be O(n)**

   The plan says:

   > Scans Queue 2 and redirects passengers holding bad keys.

   If queue is large, scanning can become expensive.

   Event-driven key invalidation is safer.

4. **Fast-canning status codes need clarity**

   Need decide:

   - `502` for upstream bad response,
   - `503` for no available keys,
   - `504` for timeout,
   - `429` for rate limit exhausted,
   - `499` for client abort,
   - `400` for invalid request.

   Do not leak provider secrets or internal details.

### Edge cases

- provider returns 429 with long `Retry-After`,
- provider returns 401 after first successful chunk,
- provider returns 403 only for specific model,
- key quarantine expires while retry is queued,
- same request is recalled twice,
- retry enters VIP lane and burns another key,
- three attempts fail with different error classes,
- client aborts during retry re-enqueue,
- provider outage affects all keys,
- `/reset` clears quarantine during an active incident,
- rescue timer fires after request already completed.

### Recommendation

Define rescue state machine:

```text
ATTEMPT_1_IN_FLIGHT
ATTEMPT_1_FAILED_CLASSIFIED
RETRY_ELIGIBLE
RETRY_ENQUEUED_VIP
ATTEMPT_2_IN_FLIGHT
...
FINAL_FAILURE
```

Each final failure should include:

- gateway error code,
- safe client-facing message,
- provider error class,
- attempt count,
- key ID hash,
- request ID.

Do not expose raw provider keys.

---

# 5. Data-Center and Operational Concerns

As a data-center SME, I would require the following before production.

---

## 5.1 High availability

The current plan appears process-stateful.

Questions:

- Is LiteRouter single-instance?
- Can it run active-active?
- What happens during deploy?
- What happens during crash?
- Is there graceful drain?
- Can the load balancer detect queue saturation?
- Are in-flight requests drained or aborted during restart?

### Required behavior

For graceful shutdown:

1. stop accepting new requests,
2. mark `/readyz` not ready,
3. allow load balancer to drain,
4. finish in-flight streams up to grace period,
5. cancel queued requests with `503`,
6. abort upstream connections cleanly,
7. exit.

### Production gate

Zero-downtime deploy must be tested.

---

## 5.2 Capacity planning

Need define:

- max concurrent connections,
- max concurrent upstream flights,
- max queue depth per airline,
- max memory per request,
- max body size,
- max buffered retry payload,
- max file descriptors,
- max sockets,
- max HTTP/2 streams,
- expected requests/sec,
- expected tokens/sec,
- expected p95 latency,
- expected p99 queue wait.

### Risk

AI gateways can be dominated by long-lived streams. A small number of slow clients can consume many sockets.

### Required tests

- 10k concurrent connections,
- abort storm,
- slow client test,
- large payload test,
- long stream test,
- provider stall test.

---

## 5.3 Secrets management

Provider keys must not be:

- logged,
- cached longer than needed,
- exposed in error messages,
- sent to clients,
- written to disk unencrypted,
- included in traces.

Need:

- environment or KMS integration,
- key rotation procedure,
- key revocation procedure,
- key hashing for logs,
- audit log for key use.

---

## 5.4 Observability

The current metrics mention active streams and latency. Production needs more.

### Minimum metrics

#### Ingress

```text
requests_total
auth_failures_total
malformed_tokens_total
oversized_body_total
slowloris_kills_total
client_disconnects_total
```

#### Queues

```text
queue1_depth
queue2_depth
queue_wait_seconds_p50
queue_wait_seconds_p95
queue_timeout_total
queue_evicted_total
vip_retry_total
```

#### Keys

```text
keys_total
keys_healthy
keys_quarantined
keys_active
key_assignment_total
key_burn_total
key_permanent_failure_total
```

#### Upstream

```text
upstream_requests_total
upstream_status_code_total
upstream_ttft_seconds
upstream_total_latency_seconds
upstream_connect_errors_total
upstream_tls_errors_total
upstream_goaway_total
upstream_rst_stream_total
upstream_stall_total
```

#### Streaming

```text
stream_started_total
stream_completed_total
stream_aborted_total
stream_error_after_commit_total
sse_parse_errors_total
tool_assembly_errors_total
```

#### Rescue

```text
retry_total
retry_success_total
retry_exhausted_total
quarantine_total
recall_total
reset_admin_total
```

#### System

```text
process_memory_bytes
event_loop_lag_seconds
open_fds
http2_sockets_active
http2_streams_active
cpu_usage
```

### Minimum logs

Every request should log:

- request ID,
- tenant ID hash,
- provider,
- route,
- payload format,
- nuance,
- model name,
- queue wait,
- upstream status,
- TTFT,
- total time,
- attempt count,
- final status,
- error class.

Do not log:

- full bearer token,
- provider API keys,
- full prompt body by default,
- full response body by default.

---

## 5.5 Alerts

Minimum alert conditions:

- error rate above SLO,
- queue depth rising,
- queue wait p95 rising,
- all keys quarantined for a provider,
- upstream 429 spike,
- upstream 5xx spike,
- TTFT p95 degradation,
- stream abort spike,
- memory growth,
- FD exhaustion,
- event-loop lag,
- admin reset executed,
- signature cache eviction spike,
- tool assembly error spike.

---

## 5.6 SLOs

Define explicit SLOs before production.

Example:

| Metric | Target |
|---|---|
| Gateway availability | 99.9% |
| Successful non-aborted requests | 99.5% |
| p95 queue wait | < 2s |
| p99 queue wait | < 10s |
| p95 gateway overhead | < 150ms |
| TTFT radar false positives | < 0.1% |
| stream corruption rate | 0% |
| duplicate retry charge incidents | 0 tolerated |
| memory leak over 24h | none |

---

# 6. Security Review

## 6.1 Prompt and payload privacy

The gateway sees sensitive user prompts.

Need define:

- are payloads logged?
- are payloads cached?
- are payloads stored for debugging?
- are payloads sent to observability vendors?
- how long are logs retained?
- is PII redaction required?
- are embeddings or signatures considered user data?

Default recommendation:

> Do not log request or response bodies unless explicitly enabled, redacted, and access-controlled.

---

## 6.2 SSRF protection

The dispatcher must only allow fixed upstream hosts.

Do not construct upstream URLs from:

- model name,
- body fields,
- headers,
- query parameters,
- token segments except from a fixed provider map.

Example allowlist:

```text
openrouter.ai
api.openai.com
api.anthropic.com
generativelanguage.googleapis.com
api.deepseek.com
api.groq.com
api.cerebras.ai
...
```

Reject all others.

---

## 6.3 Header safety

Ensure no header injection through:

- model name,
- user ID,
- metadata,
- custom headers.

Sanitize anything forwarded upstream.

---

## 6.4 Request smuggling

Verify Bun HTTP server handles:

- conflicting `Content-Length` and `Transfer-Encoding`,
- invalid chunked encoding,
- oversized headers,
- pipelined requests,
- HTTP/2 to HTTP/1 downgrade if behind LB.

---

## 6.5 Admin abuse

Already covered, but critical:

- `/reset` must be protected,
- `/metrics` must be protected,
- admin actions must be audited,
- admin auth should be separate from normal API keys.

---

# 7. Converter-Specific Risks

The payload converters are among the highest-risk components.

## Anthropic to OpenAI

Need handle:

- Anthropic system prompt vs OpenAI system message,
- multi-part content blocks,
- tool_use blocks,
- tool_result blocks,
- assistant prefill,
- stop sequences,
- token usage mapping,
- cache_control fields,
- unsupported Anthropic metadata.

### Edge cases

- tool_use input is not an object,
- tool_result content is string vs array,
- message contains both text and tool_use,
- consecutive assistant messages,
- empty content blocks,
- unsupported image type.

---

## OpenAI to Google

Need handle:

- Gemini contents format,
- system instructions,
- function declarations,
- function responses,
- thought signatures,
- safety settings,
- generation config.

### Edge cases

- OpenAI tool-call arguments are partial JSON,
- multiple tool calls in one assistant message,
- Google rejects signature,
- signature missing from prior turn,
- model does not support thinking,
- Gemma requires alternating turns,
- consecutive same-role messages,
- client sends unsupported OpenAI fields.

---

## OpenAI SSE to Anthropic SSE

This is very easy to get wrong.

Need maintain strict event order:

```text
message_start
content_block_start
content_block_delta
content_block_stop
message_delta
message_stop
```

Tool calls require:

```text
content_block_start tool_use
input_json_delta
content_block_stop
```

### Edge cases

- tool index arrives late,
- tool name arrives in multiple deltas,
- tool arguments arrive in fragments,
- multiple tools interleave,
- stop_reason arrives before final tool JSON,
- usage arrives only at end,
- provider sends empty delta,
- provider sends invalid UTF-8,
- client expects Anthropic `ping` events.

---

# 8. Testing Plan Required Before Production

I would require the following test suite.

---

## 8.1 Unit tests

For each micro-module:

- token parser,
- fusion resolver,
- key rotator,
- quarantine,
- queue eviction,
- parameter scrubber,
- converters,
- radar timers,
- tool assembler,
- signature cleaner.

---

## 8.2 Contract tests

For every supported directive combination:

```text
provider x payload_format x completion_route x nuance
```

At minimum:

- OpenRouter + OpenAI + chat + standard,
- OpenRouter + Anthropic cross-wire + chat + standard,
- Google + OpenAI + generateContent + standard,
- Google + OpenAI + generateContent + tool calling,
- Google native + generateContent,
- Anthropic + Anthropic + messages,
- DeepSeek + OpenAI + chat + reasoning,
- Groq + OpenAI + chat,
- Cerebras + OpenAI + chat,
- NVIDIA + OpenAI + chat,
- OpenAI + Responses route.

---

## 8.3 SSE golden tests

Use recorded provider streams:

- normal stream,
- tool-call stream,
- reasoning stream,
- error after first token,
- partial chunk,
- invalid JSON,
- provider-specific keep-alive,
- GOAWAY interruption,
- RST_STREAM interruption.

---

## 8.4 Chaos tests

Simulate:

- upstream 429,
- upstream 500,
- upstream 502,
- upstream TLS reset,
- upstream TCP reset,
- upstream GOAWAY,
- upstream stall after headers,
- upstream stall after partial SSE,
- DNS failure,
- key invalid mid-flight,
- client abort storm,
- queue saturation,
- memory pressure,
- FD exhaustion.

---

## 8.5 Load tests

Test:

- sustained peak RPS,
- burst traffic,
- long-running streams,
- concurrent tool-call streams,
- large payloads,
- abort-heavy traffic,
- retry storm,
- provider slowdown.

Success criteria:

- no memory leak,
- no FD leak,
- no timer leak,
- bounded queue depth,
- predictable 429/503 behavior,
- no corrupted SSE,
- no duplicate retries beyond policy.

---

## 8.6 Security tests

Test:

- malformed bearer tokens,
- revoked tokens,
- unauthorized provider selection,
- oversized body,
- compressed body bomb,
- SSRF attempts,
- header injection,
- admin endpoint access,
- log redaction,
- key leakage in errors,
- request smuggling patterns.

---

# 9. Specific Edge Cases I Would Want Tested

Below is a concise edge-case checklist.

## Token and routing

- token with missing segment,
- token with extra segment,
- unknown provider code,
- unknown payload code,
- unknown route code,
- unknown nuance code,
- token with valid format but revoked tenant,
- fusion preset unknown,
- fusion preset resolves to no healthy tier,
- fusion preset conflicts with body model.

## Request body

- empty JSON object,
- empty messages array,
- null messages,
- missing model,
- unsupported model,
- invalid role,
- duplicate tool_call_id,
- invalid tool arguments,
- huge base64 image,
- unsupported attachment type,
- malformed JSON,
- valid JSON but invalid schema,
- stream true and stream false edge cases,
- unsupported response_format,
- max_tokens zero,
- max_tokens negative,
- temperature out of bounds.

## Queue and key assignment

- all keys dead,
- one key left and it burns,
- key burns during queue wait,
- key burns after assignment,
- VIP retry starves normal traffic,
- queue depth reaches limit,
- queue wait exceeds global deadline,
- client aborts in queue,
- process restart while queued.

## Upstream flight

- connect timeout,
- TLS failure,
- DNS failure,
- HTTP/2 GOAWAY,
- REFUSED_STREAM,
- RST_STREAM,
- provider 200 but no body,
- provider 200 but no SSE events,
- provider sends invalid SSE,
- provider sends HTML error,
- provider sends JSON error after 200,
- provider stalls between chunks,
- provider returns usage only at end,
- provider returns partial tool call,
- provider closes stream early.

## Client behavior

- client disconnects before upload completes,
- client disconnects during queue,
- client disconnects after first token,
- client disconnects mid-tool-call,
- client sends duplicate requests,
- client retries while original still active,
- client timeout shorter than queue wait,
- client expects non-stream JSON,
- client expects SSE but provider returns JSON.

## Landing

- partial UTF-8 sequence at chunk boundary,
- SSE event split across chunks,
- multiple SSE events in one chunk,
- invalid JSON in SSE data,
- missing finish reason,
- missing usage,
- duplicate finish reason,
- tool-call index missing,
- tool-call arguments invalid,
- signature block arrives unexpectedly,
- signature cache miss on next turn,
- signature cache hit from wrong tenant.

## Rescue

- retry after 429,
- retry after 500,
- no retry after 400,
- no retry after 401,
- no retry after client abort,
- retry after GOAWAY,
- retry budget exhausted,
- retry succeeds on second key,
- retry causes duplicate upstream request,
- reset clears quarantine during retry storm.

---

# 10. What I Would Require for Production Sign-Off

I would sign off only after the following artifacts exist.

---

## 10.1 Architecture artifacts

- final deployment topology,
- single-node vs multi-node state plan,
- key pool ownership model,
- queue capacity model,
- timeout hierarchy diagram,
- retry state machine,
- abort handling matrix,
- converter compatibility matrix,
- security model,
- secrets handling design.

---

## 10.2 Runtime protections

- max body size enforced,
- max header size enforced,
- max queue depth enforced,
- max queue wait enforced,
- max active flights per key enforced,
- max retry attempts enforced,
- admin authentication enforced,
- rate limiting enforced,
- spend caps enforced,
- graceful shutdown implemented.

---

## 10.3 Observability

- request ID propagation,
- structured logs,
- redaction verified,
- queue metrics,
- key metrics,
- upstream metrics,
- stream metrics,
- retry metrics,
- system metrics,
- dashboards,
- alerts.

---

## 10.4 Test evidence

- typecheck clean,
- unit tests pass,
- converter golden tests pass,
- SSE reassembly tests pass,
- mock provider integration tests pass,
- load test report,
- soak test report,
- chaos test report,
- security test report,
- abort storm test report.

---

## 10.5 Operational readiness

- incident runbook,
- key rotation runbook,
- provider outage runbook,
- queue saturation runbook,
- memory leak runbook,
- deploy rollback procedure,
- admin reset procedure,
- on-call escalation path.

---

# 11. Final Approval Statement

## Would I approve this plan for production?

### Not as-is.

The plan is promising, but it is not yet production-hardened.

I would classify the current blueprint as:

> **Architecturally sound, but production readiness is blocked by missing safety controls around authentication, state, retries, backpressure, streaming failure handling, and operational observability.**

## What would change my answer to yes?

I would approve a **limited production canary** if you close the following first:

1. define and enforce server-side authorization policy,
2. make retry behavior idempotency-safe,
3. bound all queues and enforce admission control,
4. define a single request deadline hierarchy,
5. secure `/reset` and admin endpoints,
6. define key quarantine error taxonomy,
7. isolate and limit thought-signature cache,
8. define single-node vs multi-instance state strategy,
9. prove graceful shutdown and deploy drain,
10. provide load, chaos, and security test evidence.

For a **general multi-tenant production rollout**, I would additionally require:

- spend controls,
- tenant isolation tests,
- PII handling policy,
- provider ToS review,
- HA or failover plan,
- 7-day stable soak,
- on-call runbooks,
- dashboards and alerts.

---

# 12. Bottom Line

The LiteRouter V4.4 design is intellectually strong and has a good modular shape. The “dual-queue airport” model is a useful abstraction.

But production gateways fail in the ugly spaces:

- provider ambiguity,
- partial streams,
- client aborts,
- retry side effects,
- queue pressure,
- key exhaustion,
- secret leakage,
- timeout conflicts,
- state inconsistency across replicas.

Those areas are currently under-specified.

My recommendation:

> **Hold general production cutover.**  
> Convert the P0 gaps into engineering tickets, add the operational controls, and run the chaos/load/security suite. Then approve a controlled canary with rollback and spend caps.