---
name: bgem3-dual-instance-setup
description: "Operational runbook for BGE-M3 Text Embeddings Inference (TEI) dual-tier failover across Sovereign LAN and VPS"
---

# BGE-M3 Dual-Instance TEI Setup & Operations Runbook

## 1. Executive Summary & Architecture Context

LiteRouter routes embedding inference (`POST /v1/embeddings`) for downstream applications (e.g., `baziforecast`, Chronomancer RAG, OpenCode, OMP). To guarantee high throughput and 24/7 sovereign availability without relying on fragile external meshes (e.g. ZeroTier idle drops), LiteRouter uses an **Active-Passive Multi-Tier Fusion** architecture.

```
                           POST /v1/embeddings (Ambient Zero-Config)
                                             │
                                             ▼
                       DEFAULT_EMBEDDING_DIRECTIVE = "lr-fse-embeddings"
                                             │
                                             ▼
                             executeFusionFlow("embeddings")
                                             │
                  ┌──────────────────────────┴──────────────────────────┐
                  │                                                     │
                  ▼                                                     ▼
    Tier 1: http://tei-wsl.lan:8002                       Tier 2: http://127.0.0.1:8002
  (Sovereign LAN via Windows PortProxy)                  (Local VPS Loopback - Zero Net Hop)
        • CUDA GPU (~25ms TTFT)                               • 24/7 Sovereign CPU (~150ms TTFT)
        • Fast Failover (max 2 attempts / ~3s)                • Immune to laptop sleep/Wi-Fi
                  │                                                     │
                  └──────────────────► Fallback on failure ─────────────┘
                                                │
                                                ▼
                            Sticky Cache Lifecycle (5-min TTL)
                            • Tier 2 stays sticky while WSL asleep
                            • Failure on Tier 2 instantly evicts cache
                            • 5-min TTL expires -> auto-probes Tier 1
```

### Key Operational Invariants
- **Hot Path Invariant**: The hot path NEVER crosses ZeroTier or public internet overlays. Tier 1 traverses flat 2.5 Gbps local LAN (`192.168.50.199:8002`), while Tier 2 is pure local loopback on the VPS (`127.0.0.1:8002`).
- **Fail-Fast Invariant**: Transport errors (`Unable to connect`, TCP connect timeouts) fail fast with `max_attempts: 2` (~3s total) to ensure downstream client timeouts (e.g., 10s in `python-httpx`) are never breached before Tier 2 answers.
- **Zero Client Modification Invariant**: Downstream clients call `http://literouter.lan:7766/v1/embeddings` without client-side directives or failover logic. LiteRouter handles failover, chunk slicing, and model mapping transparently.

---

## 2. Infrastructure Setup: Windows Host & PortProxy

WSL2 uses virtual Hyper-V NAT networking. For external LAN nodes (like the VPS at `192.168.50.10`) to reach TEI running inside WSL2 (`--net=host`), Windows PortProxy and Firewall rules must be configured on the Windows host (`192.168.50.199`).

### 2.1 Configure Windows PortProxy
Run in an elevated PowerShell on the Windows host:
```powershell
# Add PortProxy forwarding port 8002 from all interfaces to WSL2 localhost
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8002 connectaddress=127.0.0.1 connectport=8002

# Verify PortProxy status
netsh interface portproxy show v4tov4
```

Expected output:
```text
Listen on ipv4:             Connect to ipv4:
Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0         8002        127.0.0.1       8002
```

### 2.2 Configure Windows Firewall Rule
Run in elevated PowerShell:
```powershell
New-NetFirewallRule -DisplayName "TEI-WSL-8002" -Direction Inbound -LocalPort 8002 -Protocol TCP -Action Allow
```

---

## 3. Router DNS Resolution (ASUS RT-BE92U / Merlin)

The local domain names `tei-wsl.lan` and `tei-vps.lan` provide stable, human-readable DNS endpoints independent of DHCP renewals.

### 3.1 Edit `hosts.add` on Router
SSH into the ASUS RT-BE92U router (`192.168.50.1`):
```bash
cat << 'EOF' >> /jffs/configs/hosts.add
192.168.50.199 tei-wsl.lan
192.168.50.10 tei-vps.lan
EOF
```

### 3.2 Restart Dnsmasq
```bash
service restart_dnsmasq
```

### 3.3 Verify DNS Resolution from VPS / Client
```bash
ping -c 2 tei-wsl.lan
# Expected: PING tei-wsl.lan (192.168.50.199) 56(84) bytes of data.

ping -c 2 tei-vps.lan
# Expected: PING tei-vps.lan (192.168.50.10) 56(84) bytes of data.
```

---

## 4. Docker Container Deployment Specifications

### 4.1 Tier 1: WSL2 CUDA Instance (GPU Accelerated)
Deploy on WSL2 (RTX 4070 Laptop GPU):
```bash
docker run -d \
  --name tei-bge \
  --restart unless-stopped \
  --gpus all \
  --net=host \
  -m 4g \
  -e MODEL_ID=BAAI/bge-m3 \
  -e PORT=8002 \
  -v $HOME/.cache/huggingface:/root/.cache/huggingface \
  ghcr.io/huggingface/text-embeddings-inference:turing-1.6 \
  --model-id BAAI/bge-m3 \
  --port 8002 \
  --max-client-batch-size 32 \
  --max-batch-tokens 16384
```

### 4.2 Tier 2: VPS CPU Instance (24/7 Sovereign Local Fallback)
Deploy on the production VPS (`192.168.50.10`):
```bash
docker run -d \
  --name tei-bge-m3 \
  --restart always \
  -p 127.0.0.1:8002:80 \
  -m 4g \
  -e MODEL_ID=BAAI/bge-m3 \
  -v /root/.cache/huggingface:/root/.cache/huggingface \
  ghcr.io/huggingface/text-embeddings-inference:cpu-1.6 \
  --model-id BAAI/bge-m3 \
  --port 80 \
  --max-client-batch-size 16 \
  --max-batch-tokens 8192
```

---

## 5. Gateway Configuration in LiteRouter

### 5.1 `config/providers.json`
```json
{
  "providers": {
    "tei": {
      "code": "tei",
      "name": "Text Embeddings Inference (WSL CUDA)",
      "env_key": "TEI_API_KEYS",
      "strategy": "standard",
      "base_url": "http://tei-wsl.lan:8002",
      "auth_header": "Bearer",
      "headers": { "Content-Type": "application/json" },
      "endpoints": { "em": "/v1/embeddings" },
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
        "max_concurrency": 8
      }
    },
    "teivps": {
      "code": "teivps",
      "name": "Text Embeddings Inference (VPS CPU)",
      "env_key": "TEI_API_KEYS",
      "strategy": "standard",
      "base_url": "http://127.0.0.1:8002",
      "auth_header": "Bearer",
      "headers": { "Content-Type": "application/json" },
      "endpoints": { "em": "/v1/embeddings" },
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
        "max_concurrency": 8
      }
    }
  }
}
```

### 5.2 `config/fusion.json`
```json
{
  "presets": {
    "embeddings": {
      "strategy": "sticky_fallback",
      "timeout_ms": 30000,
      "models": {
        "BAAI/bge-m3": {
          "tiers": [
            { "priority": 1, "apikey": "lr-tei-oa-em-no", "model": "BAAI/bge-m3" },
            { "priority": 2, "apikey": "lr-teivps-oa-em-no", "model": "BAAI/bge-m3" }
          ]
        },
        "bge-m3": {
          "tiers": [
            { "priority": 1, "apikey": "lr-tei-oa-em-no", "model": "BAAI/bge-m3" },
            { "priority": 2, "apikey": "lr-teivps-oa-em-no", "model": "BAAI/bge-m3" }
          ]
        }
      }
    }
  }
}
```

---

## 6. Verification & Health Probes

### 6.1 Direct Health Checks
```bash
# Probe WSL2 instance via Sovereign LAN
curl -s http://tei-wsl.lan:8002/health
# Expected: {"status":"ok"} or HTTP 200

# Probe VPS local instance via loopback
curl -s http://127.0.0.1:8002/health
# Expected: {"status":"ok"} or HTTP 200
```

### 6.2 LiteRouter Ambient Embedding Test
```bash
# Request embedding through LiteRouter without Authorization header
curl -s -X POST http://literouter.lan:7766/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "BAAI/bge-m3", "input": "Hello Sovereign Embeddings"}'
```
Expected response:
```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "embedding": [-0.0123, 0.0456, ...],
      "index": 0
    }
  ],
  "model": "BAAI/bge-m3",
  "usage": {
    "prompt_tokens": 5,
    "total_tokens": 5
  }
}
```

---

## 7. Failover & Recovery Drill Runbook

### Drill Scenario: Laptop Goes to Sleep (Tier 1 Outage)
1. **Simulate Outage**: Stop the WSL2 container or disconnect Wi-Fi on the laptop.
2. **Execute Inbound Request**:
   ```bash
   curl -s -X POST http://literouter.lan:7766/v1/embeddings \
     -H "Content-Type: application/json" \
     -d '{"model": "BAAI/bge-m3", "input": "Failover verification query"}'
   ```
3. **Observe Gateway Behavior**:
   - LiteRouter probes Tier 1 (`http://tei-wsl.lan:8002`).
   - TCP connect fails after 2 attempts (~3s total).
   - Fusion engine marks Tier 1 failed and switches to Tier 2 (`http://127.0.0.1:8002`).
   - VPS CPU returns embedding in ~150ms.
   - Client receives `HTTP 200 OK`.
4. **Sticky Affinity During Sleep**:
   - Send subsequent requests. They bypass Tier 1 immediately and hit Tier 2 in ~150ms.
5. **Recovery When Awake**:
   - Restart the WSL2 container / wake laptop.
   - After 5 minutes (`FUSION_STICKY_TTL_MS`), LiteRouter probes Tier 1 again.
   - GPU answers in ~25ms; primary affinity is restored.
