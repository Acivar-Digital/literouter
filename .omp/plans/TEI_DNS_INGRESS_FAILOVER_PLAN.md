# LiteRouter Plan: Direct DNS Ingress with Zero-Retry Immediate Switchover

**Tracking Issue:** `literouter-dns-failover`  
**Pipeline:** `embeddings` (`BAAI/bge-m3`)  
**Status:** DRAFT PLAN - STANDBY FOR USER ORDER  

---

## 1. Executive Summary & Objective

Migrate LiteRouter's embedding pipeline from the legacy reverse SSH tunnel (`127.0.0.1:8002` on VPS) to authoritative DNS ingress:
1. **Tier 1 (Home LAN):** `http://wsl.lan:8002` (resolves to `192.168.50.199` via router DNS)
2. **Tier 2 (WireGuard Away):** `http://wsl-wg.lan:8002` (resolves to `10.6.0.2` via router DNS)
3. **Tier 3 (Local VPS CPU Fallback):** `http://127.0.0.1:8003` (`teivps` container on VPS)

### Strict Requirement: Immediate Switchover (No Multi-Retry Stalls)
- Disable retries (`max_attempts: 1`, `enabled: false`) on both `tei` and `teiwg`.
- When an endpoint is unreachable (e.g. laptop away with WireGuard, so `wsl.lan` does not answer), LiteRouter must **not** attempt 3 retries or stall. It attempts the socket connection exactly once, fails fast, and **immediately switches to the next tier**.
- Once Tier 2 (`wsl-wg.lan`) succeeds, LiteRouter's `sticky_fallback` locks onto Tier 2 for subsequent requests, eliminating any wait on Tier 1 while roaming.

---

## 2. Ingress Architecture & Call Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│             LiteRouter Direct DNS Embedding Failover Chain             │
└────────────────────────────────────────────────────────────────────────┘

 Client Request (/v1/embeddings, lr-fse-embeddings)
        │
        ▼
 LiteRouter Fusion Engine (timeout_ms: 1500 - 2500ms)
        │
        ├─► Priority 1: http://wsl.lan:8002 (Home LAN GPU)
        │               • Active when laptop is on Home Wi-Fi (192.168.50.199)
        │               • max_attempts: 1 (zero retry on connection failure)
        │               • If unreachable -> IMMEDIATE SWITCH to Priority 2
        │
        ├─► Priority 2: http://wsl-wg.lan:8002 (WireGuard GPU)
        │               • Active when roaming with WireGuard ON (10.6.0.2)
        │               • max_attempts: 1 (zero retry on connection failure)
        │               • On success: sticky locks onto Priority 2 while away
        │               • If unreachable -> IMMEDIATE SWITCH to Priority 3
        │
        └─► Priority 3: http://127.0.0.1:8003 (VPS CPU Container: teivps)
                        • Always available on VPS localhost
                        • Handles traffic when laptop is asleep / suspended
```

---

## 3. Implementation Blueprint & File Changes

### 3.1 Type & Directive Schema Registration
Register the new provider code `"teiwg"` alongside `"tei"` and `"teivps"`:

1. **`src/config/schema.ts`**:
   Add `"teiwg"` to `ProviderCodeSchema`:
   ```ts
   export const ProviderCodeSchema = z.enum([
     "openrouter",
     "nvidia",
     "google",
     "zen",
     "gcp",
     "groq",
     "tei",
     "teiwg",
     "teivps",
   ]);
   ```

2. **`src/directive/parser.ts`**:
   Add `"teiwg"` to `ProviderCode` type and `VALID_PROVIDERS` array:
   ```ts
   export type ProviderCode =
     | "openrouter"
     | "nvidia"
     | "google"
     | "zen"
     | "gcp"
     | "groq"
     | "tei"
     | "teiwg"
     | "teivps";
   ```

3. **`src/config/keys.ts`**:
   Map `"teiwg"` to use ambient `TEI_API_KEYS`:
   ```ts
   export const PROVIDER_ENV_KEY_MAP: Record<ProviderCode, string> = {
     ...
     tei: "TEI_API_KEYS",
     teiwg: "TEI_API_KEYS",
     teivps: "TEI_API_KEYS",
   };
   ```

---

### 3.2 Provider Definitions (`config/providers.json`)
Configure `tei` and `teiwg` with **`request_retry.enabled: false`** and **`max_attempts: 1`**:

```json
{
  "tei": {
    "code": "tei",
    "name": "Text Embeddings Inference (WSL2 GPU - Home LAN)",
    "env_key": "TEI_API_KEYS",
    "strategy": "standard",
    "base_url": "http://wsl.lan:8002",
    "auth_header": "Bearer",
    "headers": {
      "Content-Type": "application/json"
    },
    "endpoints": {
      "em": "/v1/embeddings"
    },
    "request_retry": {
      "enabled": false,
      "max_attempts": 1
    },
    "pacer": {
      "enabled": true,
      "min_delay_ms": 10,
      "max_delay_ms": 50,
      "max_queue_depth": 500,
      "max_queue_wait_ms": 5000,
      "max_concurrency": 8
    }
  },
  "teiwg": {
    "code": "teiwg",
    "name": "Text Embeddings Inference (WSL2 GPU - WireGuard Away)",
    "env_key": "TEI_API_KEYS",
    "strategy": "standard",
    "base_url": "http://wsl-wg.lan:8002",
    "auth_header": "Bearer",
    "headers": {
      "Content-Type": "application/json"
    },
    "endpoints": {
      "em": "/v1/embeddings"
    },
    "request_retry": {
      "enabled": false,
      "max_attempts": 1
    },
    "pacer": {
      "enabled": true,
      "min_delay_ms": 10,
      "max_delay_ms": 50,
      "max_queue_depth": 500,
      "max_queue_wait_ms": 5000,
      "max_concurrency": 8
    }
  },
  "teivps": {
    "code": "teivps",
    "name": "Text Embeddings Inference (VPS CPU Fallback)",
    "env_key": "TEI_API_KEYS",
    "strategy": "standard",
    "base_url": "http://127.0.0.1:8003",
    "auth_header": "Bearer",
    "headers": {
      "Content-Type": "application/json"
    },
    "endpoints": {
      "em": "/v1/embeddings"
    },
    "request_retry": {
      "enabled": true,
      "max_attempts": 2,
      "delay": { "min_ms": 150, "max_ms": 500 }
    },
    "pacer": {
      "enabled": true,
      "min_delay_ms": 10,
      "max_delay_ms": 50,
      "max_queue_depth": 500,
      "max_queue_wait_ms": 5000,
      "max_concurrency": 4
    }
  }
}
```

---

### 3.3 Fusion Hierarchy (`config/fusion.json`)
Configure the 3-tier chain under `embeddings`:

```json
"embeddings": {
  "strategy": "sticky_fallback",
  "timeout_ms": 1500,
  "models": {
    "BAAI/bge-m3": {
      "tiers": [
        {
          "priority": 1,
          "apikey": "lr-tei-oa-em-no",
          "model": "BAAI/bge-m3",
          "concurrency_penalty": 200,
          "reset_cooldown_sec": 30
        },
        {
          "priority": 2,
          "apikey": "lr-teiwg-oa-em-no",
          "model": "BAAI/bge-m3",
          "concurrency_penalty": 200,
          "reset_cooldown_sec": 30
        },
        {
          "priority": 3,
          "apikey": "lr-teivps-oa-em-no",
          "model": "BAAI/bge-m3"
        }
      ]
    },
    "bge-m3": {
      "tiers": [
        {
          "priority": 1,
          "apikey": "lr-tei-oa-em-no",
          "model": "BAAI/bge-m3"
        },
        {
          "priority": 2,
          "apikey": "lr-teiwg-oa-em-no",
          "model": "BAAI/bge-m3"
        },
        {
          "priority": 3,
          "apikey": "lr-teivps-oa-em-no",
          "model": "BAAI/bge-m3"
        }
      ]
    }
  }
}
```

---

## 4. Execution Protocol & Quality Gates

When ordered to execute:
1. **Apply Code Edits:**
   Update `schema.ts`, `parser.ts`, `keys.ts`, `providers.json`, and `fusion.json`.
2. **Local Quality Gates:**
   - Run `bun run typecheck` (must pass 0 errors).
   - Run `bun run test network` and `bun run test` (must pass).
3. **Commit & Sync to Production:**
   - Commit changes to `origin/main`.
   - Run `bash scripts/sync/sync_literouter_to_vps.sh` to mirror to VPS and restart LiteRouter.
4. **Verification Protocol:**
   - Test `lr-tei-oa-em-no` (`wsl.lan:8002`).
   - Test `lr-teiwg-oa-em-no` (`wsl-wg.lan:8002`).
   - Test `lr-fse-embeddings` across both WireGuard ON and WireGuard OFF scenarios.
   - Confirm failover latency is <1.5s with zero socket retry loops.
5. **Decommission Tunnel:**
   - Kill the legacy reverse SSH tunnel process on VPS port 8002 (`tmux kill-session -t tei-tunnel` or systemd service).
