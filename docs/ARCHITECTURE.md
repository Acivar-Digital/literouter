# LiteRouter Architecture

## System Overview

LiteRouter is a Python + Redis API key load balancer that distributes LLM requests across multiple API keys using intelligent round-robin routing with automatic cooldown, quarantine, and rate limiting.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Application                       │
└────────────────────────────┬────────────────────────────────────┘
                             │ POST /v1/chat/completions
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FastAPI Application                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Request Handler                         │  │
│  │  1. Parse request (provider, model, messages)             │  │
│  │  2. Validate against config                               │  │
│  │  3. Enqueue for sequential processing                     │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │                                     │
│  ┌────────────────────────▼──────────────────────────────────┐  │
│  │                    Router Core                             │  │
│  │  1. Get available keys (filter cooldown/quarantine)       │  │
│  │  2. Apply round-robin selection                           │  │
│  │  3. Check rate limits                                     │  │
│  │  4. Return selected key index                             │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │                                     │
│  ┌────────────────────────▼──────────────────────────────────┐  │
│  │                  Provider Adapter                          │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │  │
│  │  │ OpenRouter   │  │   Gemini     │  │   Future     │    │  │
│  │  │  Adapter     │  │   Adapter    │  │   Adapter    │    │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │  │
│  └─────────┼─────────────────┼─────────────────┼────────────┘  │
└────────────┼─────────────────┼─────────────────┼───────────────┘
             │                 │                 │
             ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Redis State Store                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Round-   │ │ Cooldown │ │Quarantine│ │ Rate     │          │
│  │ Robin    │ │  State   │ │  State   │ │ Limits   │          │
│  │ Counter  │ │          │ │          │ │          │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. FastAPI Application (`main.py`)

The entry point for all HTTP requests. Exposes:
- `POST /v1/chat/completions` — Main routing endpoint
- `GET /metrics` — Request metrics and statistics
- `GET /health` — System health check
- `GET /health/keys` — Per-key health status

### 2. Configuration Manager (`config.py`)

Loads and validates environment variables. Supports:
- Multiple provider configurations (OpenRouter, Gemini)
- Comma-separated key lists
- Routing parameters (cooldown, quarantine, rate limits)
- Runtime validation with clear error messages

### 3. Pydantic Models (`models.py`)

Defines request/response schemas:
- `ChatRequest` — Incoming request with provider, model, messages
- `ChatResponse` — Standardized response format
- `MetricsResponse` — Metrics endpoint output
- `HealthStatus` — Key health information

### 4. Router Core (`router.py`)

The heart of LiteRouter. Implements:
- Round-robin key selection with Redis persistence
- Cooldown filtering (skip keys in cooldown period)
- Quarantine filtering (skip keys exceeding failure threshold)
- Rate limit checking before key selection
- Failure tracking and automatic quarantine promotion

### 5. Redis Client (`redis_client.py`)

Manages Redis connections:
- Connection pooling for performance
- Separate databases for routing state and token storage
- Automatic reconnection on failure
- Key namespace isolation (`lr:` prefix)

### 6. Request Queue (`queue.py`)

Ensures sequential processing:
- Redis-backed FIFO queue
- Prevents concurrent key usage conflicts
- Supports priority ordering if needed
- Automatic cleanup of stale entries

### 7. Rate Limiter (`rate_limiter.py`)

Per-key and global rate limiting:
- Sliding window algorithm
- Configurable RPM and window size
- Burst allowance support
- Redis-backed counters with TTL

### 8. Metrics Collector (`metrics.py`)

Tracks system performance:
- Total request count
- Error count and error rate
- Rolling average latency
- Per-key success/failure ratios
- Health score calculation

### 9. Doctor CLI (`doctor.py`)

Diagnostics and health checks:
- Redis connectivity test
- Key configuration validation
- Provider API key verification
- Rate limit status check
- System resource monitoring

### 10. Gemini Adapter (`gemini.py`)

Google Gemini provider integration:
- Request format translation
- Response normalization
- Error handling specific to Gemini API
- Model mapping and validation

### 11. Embedding Cache (`embed_cache.py`)

Optional embedding result caching:
- Redis-backed cache for embedding results
- TTL-based expiration
- Reduces redundant API calls

### 12. Test Suite (`tests/`)

Unit and integration tests:
- Router logic tests
- Round-robin distribution verification
- Cooldown/quarantine state transitions
- Rate limit enforcement

## Redis Key Schema

| Key Pattern | Type | Description | TTL |
|---|---|---|---|
| `lr:rr:{provider}` | STRING | Current round-robin index | None |
| `lr:cooldown:{provider}:{key_idx}` | STRING | Cooldown expiration timestamp (Unix) | Dynamic (COOLDOWN_SECONDS) |
| `lr:quarantine:{provider}:{key_idx}` | STRING | Quarantine expiration timestamp (Unix) | Dynamic (QUARANTINE_DURATION) |
| `lr:failures:{provider}:{key_idx}` | STRING | Consecutive failure count | None |
| `lr:ratelimit:{provider}:{key_idx}` | HASH | Rate limit state: `{window_start, count}` | Dynamic (RATE_LIMIT_WINDOW) |
| `lr:metrics:requests` | STRING | Total request count | None |
| `lr:metrics:errors` | STRING | Total error count | None |
| `lr:metrics:latency` | STRING | Rolling average latency (ms) | None |
| `lr:queue` | LIST | Pending request IDs (FIFO) | None |

## Graceful Degradation Pattern

LiteRouter implements multiple layers of graceful degradation:

```
┌─────────────────────────────────────────────────────────┐
│                    Degradation Levels                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Level 0: Normal Operation                              │
│  All keys healthy, round-robin distributes evenly       │
│                                                         │
│  Level 1: Key Cooldown                                  │
│  Individual keys enter cooldown after rate limit hit    │
│  Remaining keys absorb traffic                          │
│                                                         │
│  Level 2: Key Quarantine                                │
│  Keys with repeated failures quarantined                │
│  Pool shrinks but continues serving                     │
│                                                         │
│  Level 3: Partial Provider Failure                      │
│  If all keys for a provider unavailable                 │
│  Return 503 with specific error message                 │
│                                                         │
│  Level 4: Redis Failure                                 │
│  If Redis unreachable, fallback to in-memory state      │
│  Round-robin continues (non-persistent)                 │
│  Cooldown/quarantine disabled until Redis recovers      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Multi-Instance Coordination

### Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Instance A  │    │  Instance B  │    │  Instance C  │
│  :8000       │    │  :8000       │    │  :8000       │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
              ┌────────────▼────────────┐
              │      Redis Server       │
              │    localhost:6379       │
              │  DB 0: Routing State    │
              │  DB 1: Token Storage    │
              └─────────────────────────┘
```

### Coordination Mechanisms

1. **Atomic Round-Robin** — `INCR` operation ensures no two instances select the same key index simultaneously
2. **Shared Cooldown State** — All instances see the same cooldown timestamps
3. **Distributed Quarantine** — Failure counts aggregated across all instances
4. **Global Rate Limits** — Rate limit counters shared via Redis hashes
5. **Queue Serialization** — `BLPOP` ensures only one instance processes each queued request

### Deployment Considerations

- Load balancer (nginx, HAProxy) distributes incoming requests across instances
- All instances must connect to the same Redis server
- Redis should be configured for persistence (RDB/AOF) to survive restarts
- Monitor Redis memory usage — key count scales with `providers × keys`
- Consider Redis Sentinel or Cluster for high-availability deployments
