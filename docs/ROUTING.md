# LiteRouter Routing Algorithms

## Round-Robin Algorithm

### Overview

LiteRouter uses a persistent round-robin algorithm to distribute requests evenly across API keys. The algorithm ensures:

- **Fair distribution** — Each key receives approximately equal traffic
- **Persistence** — Counter survives restarts via Redis
- **Atomicity** — No race conditions in multi-instance deployments
- **Filtering** — Cooldown and quarantined keys are skipped automatically

### Algorithm

```
function select_key(provider, keys):
    available = filter_available(keys)

    if available is empty:
        raise NoAvailableKeysError

    # Atomic increment in Redis
    index = redis.incr(f"lr:rr:{provider}")

    # Map to available key using modulo
    selected = available[index % len(available)]

    return selected


function filter_available(keys):
    available = []
    for i, key in enumerate(keys):
        if not in_cooldown(provider, i):
            if not in_quarantine(provider, i):
                if not rate_limited(provider, i):
                    available.append(key)
    return available
```

### Flow Diagram

```
                    ┌─────────────────┐
                    │  Incoming Request│
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Get All Keys   │
                    │  for Provider   │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
              ┌─────│  Is Key in      │───── Yes ──► Skip Key
              │     │  Cooldown?      │
              │     └─────────────────┘
              │             │ No
              │             ▼
              │     ┌─────────────────┐
              │     │  Is Key in      │───── Yes ──► Skip Key
              │     │  Quarantine?    │
              │     └─────────────────┘
              │             │ No
              │             ▼
              │     ┌─────────────────┐
              │     │  Is Key Rate    │───── Yes ──► Skip Key
              │     │  Limited?       │
              │     └─────────────────┘
              │             │ No
              │             ▼
              │     ┌─────────────────┐
              │     │  Add to         │
              │     │  Available Pool │
              │     └─────────────────┘
              │
              ▼
    ┌─────────────────────┐
    │  Available Pool     │
    │  Empty? ──Yes──► 503│
    └────────┬────────────┘
             │ No
             ▼
    ┌─────────────────────┐
    │  rr_index = INCR    │
    │  lr:rr:{provider}   │
    └────────┬────────────┘
             │
             ▼
    ┌─────────────────────┐
    │  selected = pool[   │
    │    rr_index % len   │
    │  ]                  │
    └────────┬────────────┘
             │
             ▼
    ┌─────────────────────┐
    │  Return Selected    │
    │  Key Index          │
    └─────────────────────┘
```

## Cooldown Flow

When a key hits a rate limit, it enters a cooldown period:

```
┌─────────────────┐
│  Rate Limit Hit │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Set Redis key:                 │
│  lr:cooldown:{provider}:{idx}   │
│  = current_time + COOLDOWN_SEC  │
│  TTL = COOLDOWN_SECONDS         │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Key excluded from available    │
│  pool during cooldown           │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  After TTL expires, key         │
│  automatically rejoins pool     │
└─────────────────────────────────┘
```

### Cooldown Configuration

| Parameter | Default | Description |
|---|---|---|
| `COOLDOWN_SECONDS` | 60 | Duration key stays in cooldown |
| Trigger | Rate limit hit | What causes cooldown entry |
| Exit | TTL expiration | Automatic, no manual intervention |

## Quarantine Flow

Keys that fail repeatedly are quarantined to prevent cascading errors:

```
┌─────────────────┐
│  Request Fails  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  INCR lr:failures:{provider}:{idx}│
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  failures >= QUARANTINE_THRESH? │
├─────────────────────────────────┤
│  No ──► Continue normal routing │
│  Yes ──► Enter quarantine       │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Set Redis key:                 │
│  lr:quarantine:{provider}:{idx} │
│  = current_time + QUARANTINE_DUR│
│  TTL = QUARANTINE_DURATION      │
│  Reset failures to 0            │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Key excluded from pool         │
│  for quarantine duration        │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  After TTL expires:             │
│  - Key rejoins pool             │
│  - Failure counter reset        │
│  - Fresh start                  │
└─────────────────────────────────┘
```

### Quarantine Configuration

| Parameter | Default | Description |
|---|---|---|
| `QUARANTINE_THRESHOLD` | 3 | Consecutive failures before quarantine |
| `QUARANTINE_DURATION` | 300 | Seconds key stays quarantined |
| Reset | On quarantine entry | Failure counter resets to 0 |

## Rate Limiting

### Sliding Window Algorithm

```
function check_rate_limit(provider, key_idx):
    window_key = f"lr:ratelimit:{provider}:{key_idx}"
    now = current_timestamp()
    window_start = now - RATE_LIMIT_WINDOW

    # Remove expired entries
    redis.zremrangebyscore(window_key, 0, window_start)

    # Count requests in current window
    count = redis.zcard(window_key)

    if count >= RATE_LIMIT_RPM:
        return RATE_LIMITED

    # Add current request
    redis.zadd(window_key, {request_id: now})
    redis.expire(window_key, RATE_LIMIT_WINDOW)

    return ALLOWED
```

### Rate Limit Flow

```
┌─────────────────┐
│  Incoming Request│
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Get current window count       │
│  from Redis sorted set          │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  count >= RATE_LIMIT_RPM?       │
├─────────────────────────────────┤
│  Yes ──► Enter cooldown         │
│          Return 429             │
│  No  ──► Increment counter      │
│          Proceed with request   │
└─────────────────────────────────┘
```

### Rate Limit Configuration

| Parameter | Default | Description |
|---|---|---|
| `RATE_LIMIT_RPM` | 60 | Max requests per minute per key |
| `RATE_LIMIT_WINDOW` | 60 | Window size in seconds |

## Mathematical Distribution Proof

### Theorem

Given `n` available keys and `m` requests, each key receives either `⌊m/n⌋` or `⌈m/n⌉` requests.

### Proof

Let `rr` be the round-robin counter value before processing `m` requests.

For request `i` (0-indexed), the selected key index is:
```
key(i) = available[(rr + i) mod n]
```

Over `m` requests, the counter increments from `rr` to `rr + m - 1`.

The number of times key `j` is selected equals the number of integers `i` in `[0, m-1]` such that:
```
(rr + i) mod n = j
```

This is equivalent to counting integers in an arithmetic progression modulo `n`.

By the division algorithm:
```
m = qn + r  where 0 ≤ r < n
```

Each key is selected exactly `q = ⌊m/n⌋` times, and the first `r` keys (in round-robin order) receive one additional request.

Therefore:
- `r` keys receive `⌊m/n⌋ + 1 = ⌈m/n⌉` requests
- `n - r` keys receive `⌊m/n⌋` requests

The maximum difference between any two keys is 1 request. ∎

### Example

With 3 keys and 10 requests:
```
m = 10, n = 3
10 = 3 × 3 + 1

Key 0: ⌈10/3⌉ = 4 requests
Key 1: ⌊10/3⌋ = 3 requests
Key 2: ⌊10/3⌋ = 3 requests
```

## Mechanism Interaction Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Mechanism Interaction                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Request ──► Rate Limit Check ──► Exceeded? ──Yes──► Cooldown      │
│                  │                                      │           │
│                 No                                      ▼           │
│                  │                              Key excluded        │
│                  ▼                                from pool         │
│  Round-Robin Selection                                             │
│                  │                                                 │
│                  ▼                                                 │
│  Key Available? ──No──► Try Next Key ──► None Left? ──► 503       │
│        │                                                       │
│       Yes                                                       │
│        │                                                        │
│        ▼                                                        │
│  Forward Request to Provider                                    │
│        │                                                        │
│        ▼                                                        │
│  Response Received? ──No──► Failure ──► Increment Counter       │
│        │                                      │                 │
│       Yes                                     ▼                 │
│        │                              Threshold Hit?            │
│        ▼                                      │                 │
│  Return Response ──► Reset Failure Counter   Yes──► Quarantine  │
│                                               │                 │
│                                              No                 │
│                                               │                 │
│                                               ▼                 │
│                                          Continue Normal       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### State Transitions

```
                    ┌──────────────┐
                    │   HEALTHY    │◄──────────────────────┐
                    │  (Active)    │                        │
                    └──────┬───────┘                        │
                           │ Rate limit hit                 │
                           ▼                                │
                    ┌──────────────┐                        │
                    │  COOLDOWN    │─── TTL expires ───────►│
                    │  (60s)       │                        │
                    └──────┬───────┘                        │
                           │ Request fails                  │
                           ▼                                │
                    ┌──────────────┐                        │
                    │   FAILED     │                        │
                    │  (count++)   │                        │
                    └──────┬───────┘                        │
                           │ count >= threshold             │
                           ▼                                │
                    ┌──────────────┐                        │
                    │ QUARANTINED  │─── TTL expires ───────►│
                    │  (300s)      │   (reset count)        │
                    └──────────────┘                        │
```
