# LiteRouter Mobile Feasibility Analysis: iOS & Android Packaging

## 1. Executive Summary

Packaging LiteRouter as a native mobile app (iOS via App Store, Android via Play Store) is **technically infeasible** for on-device proxy execution because **Bun — the sole runtime underpinning the entire gateway — does not support iOS or Android**, and **mobile OS sandboxing fundamentally prohibits the server-style listening required by the gateway**.

However, a **viable mobile approach exists**: a lightweight mobile app that acts as a **client configuration manager** and **UI frontend** for a remote LiteRouter instance running on a LAN device or cloud host. This leverages all of LiteRouter's existing capabilities without attempting to port the Bun runtime.

| Approach | On-device Proxy | Remote Proxy Client | Mobile SDK Library |
|---|---|---|---|
| **Feasibility** | ❌ **Infeasible** | ✅ **Viable (MVP)** | ⚠️ Partial (requires rewrite) |
| **Bun Port Required** | Yes (impossible) | No | No |
| **OS Sandbox Violation** | Yes (server listen) | No | No |
| **API Key Security** | On-device (isolated) | On-device (isolated) | On-device (exposed) |
| **Background Operation** | Impossible | Not needed | Not needed |
| **App Store Compatible** | No | Yes | Yes |

---

## 2. LiteRouter Architecture Ground Truth

The following is verified against the codebase (`src/index.ts`, `src/config/env.ts`, `package.json`):

### 2.1 Runtime
- **Bun** is the sole runtime. The entry point imports `{ serve } from "bun"` (src/index.ts:1) and uses `Bun.env.*` for all configuration (src/config/env.ts:61-277).
- **Bun supports**: Linux (x64 & arm64), macOS (x64 & Apple Silicon), Windows (x64 & arm64).
- **Bun does NOT support**: iOS, Android, or any mobile OS. (Source: bun.sh README — *"Bun supports Linux (x64 & arm64), macOS (x64 & Apple Silicon), and Windows (x64 & arm64)."* No mobile targets listed in the llms.txt documentation index.)
- **JavaScriptCore** is embedded in Bun for macOS/iOS desktop, but Bun itself is not compiled for iOS/arm64 (iOS) or Android/arm64-v8a.

### 2.2 Server Architecture
```
Client → HTTP :7766 (Bun.serve) → Valkey/ZSET Key Rotation → Upstream APIs
```
- The gateway **listens on a TCP port** (default `7766`, configurable via `LITEROUTER_PORT`) using Bun's built-in HTTP server (`serve()` at src/index.ts:655).
- It **exits(1) on Valkey connection failure** — Redis/Valkey is a hard dependency with no in-memory fallback (src/index.ts:279, 291; ARCHITECTURE.md:81, 87).
- It reads `models.json` and `fusion.json` from the filesystem at startup (src/index.ts:186-222).
- It writes trace files to `logs/traces/` (src/index.ts:122).

### 2.3 Dependencies
- **`ioredis`** (npm dependency in package.json:12) — Node.js Redis client. Not compatible with React Native (requires native Node.js `net` module).
- **`bun`** — The runtime itself, providing `serve()`, `Bun.env`, `Bun.CryptoHasher`, `fetch()` polyfill, `ReadableStream`/`TransformStream` support.

### 2.4 Key Features Requiring Server Context
- **API key rotation** via Valkey ZSETs (src/index.ts:263-510)
- **Fusion fallback chains** with circuit breakers (src/index.ts:516-636)
- **Streaming proxy** with `TransformStream` for SSE normalization (src/network/fetcher.ts)
- **Bearer token authentication** via `LITEROUTER_AUTH_KEY` (src/index.ts:638-649)

---

## 3. Runtime Constraints: Bun on Mobile

### 3.1 Bun Platform Support (Verified)
From the official Bun README (bun.sh):

> "Bun supports Linux (x64 & arm64), macOS (x64 & Apple Silicon), and Windows (x64 & arm64)."

The complete documentation index (bun.sh/docs/llms.txt) lists **zero** pages related to iOS, Android, or mobile. Bun is a server/desktop runtime.

### 3.2 Why Bun Cannot Run on Mobile
1. **No compiled binary**: Bun is distributed as a pre-compiled binary for x86_64/aarch64 Linux, x86_64/arm64 macOS, and x86_64/arm64 Windows. There are no iOS or Android binaries.
2. **Apple App Store policies**: Even if a Bun binary could be compiled for iOS, Apple's App Store Review Guidelines Section 2.5.2 states: *"Apps should not attempt to hide, misdescribe, or circumvent the iOS platform security mechanisms."*
3. **JavaScriptCore vs Bun**: While iOS ships a system JavaScriptCore, Bun is far more than a JS engine — it includes a custom event loop, HTTP server, filesystem layer, and npm-style module resolution. A mobile app using just JSC would require reimplementing all of Bun's server functionality in native code.

### 3.3 Impact on LiteRouter
Since `src/index.ts:1` does `import { serve } from "bun"` and `src/index.ts:655` calls `serve({...})`, the entire gateway is irrevocably tied to the Bun runtime's HTTP server implementation. **There is no way to run LiteRouter on a mobile device without Bun.**

---

## 4. Mobile OS Constraints

### 4.1 iOS App Sandbox (Critical Blocker)

**Listening on network ports (Server Mode):**
- iOS apps run in a sandbox that **prohibits binding to network ports** for serving incoming connections from other devices. An app cannot call `listen()` and accept connections from laptops, tablets, or other phones.
- `Network Extension Framework` allows proxy *configuration* (e.g., SOCKS proxies) but does **not** permit running a full HTTP server that accepts external connections. It operates through the system's proxy settings, not direct socket listening.

**Background Execution:**
- iOS allows background modes only for specific categories: audio, location, Bluetooth, external accessories, and AirPlay. A general HTTP proxy server is **not** a permitted background mode.
- Background App Refresh allocates ~30-second windows every ~15-30 minutes, insufficient for a real-time proxy.
- `UIBackgroundTaskIdentifier` expires in ~30 seconds.

**App Transport Security (ATS):**
- By default, iOS requires HTTPS for all network connections. The gateway currently serves plain HTTP on port 7766 (src/index.ts:655, KIV.md:102 notes "gateway serves plain HTTP on 7766"). Connecting to a plain HTTP upstream would require ATS exceptions in `Info.plist`, which App Store review frequently rejects unless justified.

**No Bash / Package Manager:**
- iOS has no shell, no package manager, no Redis/Valkey binary. The `scripts/start.sh` relies on tmux, pgrep, bash, and Valkey flush — none available on iOS.

### 4.2 Android Constraints

**No Native Bun Binary:**
- Bun does not ship an Android (arm64-v8a / armeabi-v7a) binary. The README lists only Linux, macOS, Windows.

**Termux (Possible but Not App Store):**
- The `docs/KIV.md` document already explores this path: *"Run LiteRouter on a repurposed old Android smartphone (via Termux/PRoot)"* (KIV.md:84, 109-130).
- This works but requires:
  1. User installs Termux from F-Droid (not Google Play Store — Play Store policy blocks terminal emulators)
  2. User manually installs Redis, curl, and Bun inside Termux via `pkg install`
  3. User runs a custom PRoot Debian environment (as documented in the AI builder prompt at KIV.md:120)
- This is **not a Play Store app** — it's a CLI/TUI workflow requiring technical user setup.

**Background Service Restrictions:**
- Android 8+ (API 26) restricts background services. A persistent proxy must use a **foreground service** with a persistent notification.
- Doze mode and App Standby can throttle network operations when the device is idle.
- Battery optimization settings (manufacturer-specific) can kill long-running processes.

**Play Store Policies:**
- Apps that run persistent background services or act as network proxies face additional scrutiny. VPNs and proxy apps require the `android.permission.BIND_VPN_SERVICE` or `android.permission.BIND_NETD` permission, which has a high review bar.

---

## 5. Architectural Approaches Analysis

### Approach A: On-Device Native Proxy (❌ NOT FEASIBLE)

**Concept:** Compile/run the full LiteRouter stack (Bun + Valkey + proxy) natively on iOS/Android.

**Blocked by:**
1. **Bun is unavailable for iOS/Android** — no binary exists, no compilation target.
2. **iOS sandbox prohibits server listening** — App Store apps cannot bind to ports and accept connections.
3. **Valkey cannot run on iOS** — no iOS binary for the Redis/Valkey server.
4. **No filesystem access for models.json/fusion.json** — sandboxed document storage, not arbitrary paths.
5. **Background execution limitations** — iOS kills non-permitted background processes.

**Verdict: Hard blocker. Not achievable without fundamentally rearchitecting LiteRouter to not use Bun.**

### Approach B: Mobile Frontend + Remote Gateway (✅ VIABLE — RECOMMENDED)

**Concept:** The mobile app is a lightweight React Native / Expo client that:
- Stores LiteRouter auth keys and gateway URLs in the device's secure keychain
- Provides a UI for managing multiple gateway endpoints (e.g., `http://travelpuck.local:7766`, `https://cloud-gateway.example.com`)
- Acts as a **settings/config manager** — the actual proxy runs on a remote host (cloud, home server, OpenWrt router, or Termux device)
- Can optionally embed an in-app browser for web-based AI chats that point to the configured gateway

This aligns with the existing **Travel Puck** concept documented in KIV.md:82-107 — *"Laptop only knows BASE_URL=http://travelpuck.local:7766/v1 with a dummy LAN token. Real provider keys live physically isolated inside Valkey / .env.local on the pocket hardware."*

**Technical path:**
- Use **React Native + Expo** (or Swift/Kotlin natively) for the mobile app
- Use `expo-secure-store` or iOS Keychain / Android Keystore for API key storage
- The app makes standard HTTPS POST requests to `/v1/chat/completions` — identical to how OpenCode or Cursor currently connect to LiteRouter
- For LAN discovery: use `react-native-zeroconf` for mDNS/Bonjour to discover `literouter.local`
- For the web-based UI: use `react-native-webview` to embed a lightweight chat interface pointing at the gateway

**Advantages:**
- Zero changes to existing LiteRouter codebase
- Full key rotation, fusion, cooldowns preserved (they run on the gateway)
- App Store / Play Store compatible
- Leverages existing `/v1/chat/completions` OpenAI-compatible protocol
- The KIV.md Travel Puck concept already documents the exact use case

**Disadvantages:**
- The gateway must be running on separate hardware (not on the phone itself)
- Requires initial setup of a gateway host (cloud instance, home server, OpenWrt router, or Termux phone)

**Verdict: Recommended MVP path.**

### Approach C: Mobile SDK Library Rewriting LiteRouter Core (⚠️ PARTIAL — HIGH EFFORT)

**Concept:** Port the key management and proxy logic from Bun/TypeScript into a mobile-native SDK (Swift for iOS, Kotlin for Android, or shared via Kotlin Multiplatform / Rust core) that can be embedded in mobile apps.

**What would need to be rewritten:**
1. **Valkey client** — `ioredis` doesn't work on mobile. Would need a native Redis protocol client (SwiftNIO Redis, or Kotlin coroutine-based Redis client).
2. **HTTP proxy logic** — `fetchWithFirstByteTimeout`, `createStreamTransformer` (SSE streaming), first-byte ghosting protection — all use Bun/Web APIs. Would need reimplementing in native networking (NSURLSession, OkHttp, or Ktor).
3. **Fusion fallback chains** — `executeFusion`, circuit breaker logic — pure logic, but currently tightly coupled to the Bun HTTP server framework.
4. **Environment loading** — `Bun.env.*` would need replacement with a mobile config system.
5. **File-based registries** — `models.json` and `fusion.json` would need to be embedded or fetched from a remote config service.

**Effort:** High (estimated 400–800 hours for a production-quality port)
**Risk:** Medium-high — streaming SSE transformation, Valkey Lua scripts, and first-byte timeout logic are complex to reimplement faithfully.

**Advantages:**
- Keys stored securely on-device (Keychain / Keystore)
- Could be distributed as an SDK to other mobile developers

**Verdict:** Viable but not recommended as an initial approach. Defer unless there is strong demand for on-device key rotation with a native mobile UI. The existing KIV.md Travel Puck concept is architecturally simpler and achieves the same security outcome (keys physically isolated on a pocket device).

---

## 6. Architecture Trade-offs

| Trade-off | Approach A (On-Device) | Approach B (Remote Gateway) | Approach C (SDK Rewrite) |
|---|---|---|---|
| **Code change to LiteRouter** | Massive (complete port) | Zero | Moderate (extract logic) |
| **App Store compatible** | ❌ No (server listen) | ✅ Yes | ✅ Yes |
| **Requires secondary device** | No | ✅ Yes (gateway host) | No (but keys in app) |
| **Valkey dependency** | Can't run on iOS/Android | Runs on gateway host | Must reimplement client |
| **Key security** | Best (isolated device) | Best (isolated device) | Weaker (keys in mobile app) |
| **Streaming fidelity** | Full (uses Bun) | Full (gateway handles it) | Risk of SSE/protocol loss |
| **Development effort** | Impossible | Low (React Native app) | Very High |
| **Background operation** | Impossible | Not needed | Not needed |

---

## 7. Recommendation

**Primary Path: Approach B — Mobile Frontend + Remote Gateway**

This is the only approach that is both technically feasible and App Store/Play Store compatible. It leverages the existing KIV.md "Travel Puck" concept (KIV.md:82-107) where LiteRouter runs on a pocket device (old Android phone in Termux, Raspberry Pi Zero, or OpenWrt router) and the mobile app is a client configuration manager.

### Minimal Viable Mobile App (Approach B MVP)
A React Native / Expo app with:
1. **Secure key storage** — store `LITEROUTER_AUTH_KEY` and gateway URLs in `expo-secure-store`
2. **Gateway management UI** — add/edit/remove gateway endpoints, test connectivity via `/health`
3. **Model browser** — fetch `/v1/models` from configured gateways and display available models
4. **Web chat view** — `react-native-webview` pointing to a lightweight chat UI that sends requests to the configured gateway
5. **LAN discovery** — `react-native-zeroconf` to auto-discover `literouter.local` on the network

### Follow-up Path: Approach C — Kotlin Multiplatform Core (if demand arises)
If there is strong demand for a native iOS/Android SDK that can be embedded in other apps:
- Extract the key rotation logic (Valkey ZSET + Lua script) into a shared Kotlin Multiplatform module
- Rewrite the proxy and SSE streaming layer natively (NSURLSession for iOS, Ktor for Android)
- Package as an SDK that other mobile AI apps can integrate

---

## 8. Grounded References

| Item | Source |
|---|---|
| Bun platform support: Linux/macOS/Windows only | `README.md` (bun.sh GitHub, line: "Bun supports Linux (x64 & arm64), macOS (x64 & Apple Silicon), and Windows (x64 & arm64).") |
| Complete Bun docs index (no mobile pages) | `https://bun.sh/docs/llms.txt` (250+ pages, 0 mobile-related) |
| LiteRouter uses Bun runtime exclusively | `src/index.ts:1` — `import { serve } from "bun"` |
| LiteRouter listens on port (server mode) | `src/index.ts:655` — `serve({ port: LITEROUTER_PORT, ... })` |
| Valkey/Redis is a hard dependency | `src/index.ts:279,291` — `process.exit(1)` on Redis error |
| ioredis npm dependency (incompatible with RN) | `package.json:12` — `"ioredis": "^5.3.2"` |
| KIV.md Travel Puck concept | `docs/KIV.md:82-107` (Termux, Pi Zero, mDNS discovery) |
| Plain HTTP on port 7766 | `src/index.ts:655`; KIV.md:102 |
| iOS App Store sandbox restrictions | Apple App Store Review Guidelines Section 2.5 (no server listening, no code execution) |
| iOS background execution limits | iOS Background Execution Guide — permitted background modes: audio, location, Bluetooth, AirPlay, external accessories only |
| iOS App Transport Security (HTTPS required) | iOS Info.plist documentation — `NSAppTransportSecurity` |
| Android background service restrictions | Android 8.0 (API 26) behavioral changes — background service limits |
| Android Doze/App Standby | Android Power Management documentation |
