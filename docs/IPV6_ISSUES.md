# WSL2 Network Stability & IPv6 Routing Guide

## 1. Executive Summary & Problem Diagnosis

When running AI agent CLI tools (such as Claude Code, OpenCode, or Node.js-based SDKs) and API gateways like **LiteRouter** inside WSL2 (Windows Subsystem for Linux), network requests may suffer from connection timeouts (`ETIMEDOUT`, `ECONNREFUSED`), intermittent stalling, or redundant retry loops.

### The Root Cause: WSL2 IPv6 Routing Mismatch
1. **DNS Dual-Stack Resolution**: Upstream services (e.g., `api.anthropic.com`, `openrouter.ai`) publish both IPv4 (`A`) and IPv6 (`AAAA`) DNS records.
2. **Node.js Default Behavior**: Modern Node.js versions (v17+) prioritize IPv6 resolution by default (`--dns-result-order=verbatim`).
3. **WSL2 Virtual Hyper-V Switch**: WSL2 reports IPv6 capability to guest runtimes, but standard NAT-mode virtual switches often lack an active, routable IPv6 gateway to the external internet.
4. **The Failure Loop**:
   - Node.js attempts to establish a TCP handshake with the upstream IPv6 address (e.g. `2607:6bc0::10:443`).
   - The WSL2 network boundary silently drops or rejects the packet.
   - Client SDKs (e.g., Anthropic SDK) classify this as a transient network glitch, entering multiple exponential backoff retry cycles before falling back to IPv4 or failing outright.
   - In contrast, CLI tools like `curl` employ "Happy Eyeballs" or auto-fallback to IPv4 seamlessly.

```
+-------------------+       Dual-Stack DNS       +---------------------------+
|    Node.js /      | ------------------------> | api.anthropic.com         |
|    Claude Code    | <------------------------ | IPv6: 2607:6bc0::10 (1st) |
+-------------------+                           | IPv4: 160.79.104.10 (2nd) |
         |                                      +---------------------------+
         | (Attempts IPv6 first)
         v
+-------------------+
| WSL2 vSwitch / NAT| ---> [DROPPED / ETIMEDOUT / ECONNREFUSED]
+-------------------+
         |
         x (Stalls / Triggers 2-3 SDK Retries)
```

---

## 2. Impact in the Context of LiteRouter

LiteRouter is built on the **Bun** runtime and functions as the central routing layer on port `7766`. The IPv6 issue manifests at two distinct boundaries:

### A. Inbound / Downstream Boundary (Claude Code & Clients -> LiteRouter)
* If client tools connect to `http://localhost:7766`, `localhost` can resolve to both `::1` (IPv6 loopback) and `127.0.0.1` (IPv4 loopback).
* If Node.js attempts `::1:7766` while loopback bindings or WSL virtual adapters are misaligned, clients experience connection delays or instant ECONNREFUSED before LiteRouter even receives the request.
* **Remedy**: Always point client base URLs to explicit IPv4 (`http://127.0.0.1:7766`).

### B. Outbound / Upstream Boundary (LiteRouter -> LLM Providers)
* LiteRouter runs on **Bun**, which uses native system `fetch()` and `node:http2` connection pools.
* Bun does not parse `NODE_OPTIONS`, so Node-specific environment flags do not modify LiteRouter's runtime.
* If upstream provider domains return `AAAA` records and the WSL kernel attempts IPv6 routing before falling back, LiteRouter's Time-to-First-Token (TTFT) can be delayed.
* **Remedy**: Disabling IPv6 at the WSL kernel level ensures all outbound requests from Bun and LiteRouter immediately bind to IPv4.

---

## 3. Solutions & Implementation

### Solution 1: Node.js IPv4 Resolution Priority (Recommended for Claude Code)
Forces Node.js processes to prioritize IPv4 DNS records over IPv6.

```bash
# Add to shell profile
echo 'export NODE_OPTIONS="--dns-result-order=ipv4first"' >> ~/.bashrc
source ~/.bashrc
```

* **Effect**: Claude Code, npm, npx, and Node.js-based scripts immediately resolve `160.79.104.10` instead of `2607:6bc0::10`.
* **Scope**: Affects Node.js runtimes only. Does not alter Bun or system kernel.

---

### Solution 2: Explicit IPv4 Base URLs (Best Practice for LiteRouter Clients)
Prevent `localhost` hostname ambiguity across both Node.js and Bun.

```bash
# Claude Code / Anthropic SDK configuration
export ANTHROPIC_BASE_URL="http://127.0.0.1:7766"

# OpenAI-compatible clients (OpenCode, Codex, Aider, etc.)
export OPENAI_BASE_URL="http://127.0.0.1:7766/v1"
```

---

### Solution 3: WSL2 Kernel-Level IPv6 Disablement (External Traffic Only)
Disables external IPv6 routing while **keeping local loopback (`lo`) intact**.

> ⚠️ **CRITICAL FOR OPENCODE 2 & LOCAL IPC**:
> Never disable `lo` (`net.ipv6.conf.lo.disable_ipv6=1`). Modern Node 20 runtimes (used by OpenCode 2 and MCP servers) bind internal listeners to dual-stack `localhost`. Disabling loopback IPv6 causes socket binding failures (`EADDRNOTAVAIL` / `ECONNREFUSED`).

**Apply Safe Kernel Configuration:**
```bash
sudo sysctl -w net.ipv6.conf.all.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.default.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.lo.disable_ipv6=0
```

**Permanent Configuration (`/etc/sysctl.d/99-disable-ipv6.conf`):**
```ini
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
net.ipv6.conf.lo.disable_ipv6 = 0
```

---

### Solution 4: Windows Host Mirrored Networking (WSL 2.0+ Advanced)
If you are on Windows 11 with WSL 2.0+, configure mirrored networking mode in `C:\Users\<User>\.wslconfig`:

```ini
# %USERPROFILE%\.wslconfig
[wsl2]
networkingMode=mirrored
dnsTunneling=true
autoProxy=true
```

* **Effect**: WSL directly shares the Windows network interfaces and host DNS resolution path, resolving routing mismatches at the hypervisor level.

---

## 4. Solutions Comparison & Expected Outcomes

| Solution | Impact on Claude Code | Impact on LiteRouter (Bun) | Impact on System / Valkey / ZeroTier | Maintenance Overhead |
| :--- | :--- | :--- | :--- | :--- |
| **Option 1: `NODE_OPTIONS="--dns-result-order=ipv4first"`** | ✅ **Completely resolves** Claude Code timeouts & retry loops. | ⚪ **Zero impact** (Bun ignores `NODE_OPTIONS`). | ⚪ **Zero risk** to other services. | None (single line in `~/.bashrc`). |
| **Option 2: Explicit `127.0.0.1` Base URLs** | ✅ Eliminates `localhost` -> `::1` resolution stalls. | ✅ Direct routing to LiteRouter's IPv4 listener. | ⚪ **Zero risk**. | Configured in client env / scripts. |
| **Option 3: `sysctl disable_ipv6=1`** | ✅ Fixes Claude Code and all Node CLI tools. | ✅ **Optimizes Bun outbound TTFT**; guarantees zero IPv6 packet stalls. | ⚠️ Disables IPv6 loopback (`::1`). IPv4 (Valkey `127.0.0.1:6379`, ZeroTier `192.168.196.x`) operates normally. | Requires `sudo` to set in `/etc/sysctl.conf`. |
| **Option 4: Windows `.wslconfig` Mirrored Mode** | ✅ Native Windows DNS resolution for all tools. | ✅ Native routing for Bun & H2 pools. | ⚪ Seamless integration with host network stack. | Requires Windows 11 & WSL restart (`wsl --shutdown`). |

---

## 5. Recommended Standard Setup for LiteRouter

For the most resilient developer environment inside WSL2:

1. **Set Node.js DNS order in `~/.bashrc`**:
   ```bash
   export NODE_OPTIONS="--dns-result-order=ipv4first"
   ```
2. **Point all client tools to `127.0.0.1` instead of `localhost`**:
   ```bash
   export ANTHROPIC_BASE_URL="http://127.0.0.1:7766"
   export OPENAI_BASE_URL="http://127.0.0.1:7766/v1"
   ```
3. **If outbound TTFT latency persists on Bun / LiteRouter**:
   Apply Solution 3 (`sysctl disable_ipv6=1`) to eliminate upstream `AAAA` query drops.
