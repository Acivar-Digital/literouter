---
name: literouter-streaming-benchmarking
description: Gold-standard benchmarking, streaming verification, and reasoning flow invariant testing for LiteRouter proxy and OpenCode2 client integration.
---

# Skill: literouter-streaming-benchmarking

## 🚨 Pre-Execution Verification Checklist
Before modifying or validating any streaming, reasoning, or pacing code in LiteRouter:
1. **Single Responsibility**: Focus on verifying streaming throughput, thinking delivery, payload sanitization, or tool-calling parity.
2. **Server Health Probe**: Ensure LiteRouter is running (`curl -k https://localhost:7766/health`) or run in-process unit tests (`bun test tests/benchmarking/`).
3. **No API Key / Secret Touch**: Never touch `.env.local` or raw API keys. Rely on existing pool keys loaded by the gateway.
4. **Gold Standard Invariant Alignment**: Ensure downstream thinking is delivered live to TUI, upstream reasoning history is stripped before sending to providers, and default pacer spacing is 200ms.

---

## 🏗️ Design Mindsets

### 1. The Asymmetric Reasoning Principle
* **Why**: LLM providers often return reasoning/thinking tokens that client TUIs (OpenCode2) want to render live. However, sending past reasoning tokens back into multi-turn upstream requests triggers HTTP 400 validation errors on non-reasoning providers.
* **Action**:
  - Downstream: Pass through `delta.reasoning` / `delta.reasoning_content` to the client in real-time.
  - Upstream: Cleanse conversation history with `scrubReasoningFromMessages()` before dispatching.

### 2. Zero-Stall TTFT Streaming
* **Why**: Buffering entire sentences or waiting for completion tokens destroys the interactive feel of CLI agents.
* **Action**:
  - `readFirstContentChunkWithTimeout` must inspect `TOKEN_SIGNATURES` immediately.
  - As soon as the first byte of a delta or thought arrives, flush it directly into the stream pipeline.

### 3. High-Velocity Pacer Cadence (200ms)
* **Why**: Agentic workflows execute rapid tool loops (bash, file reads, grep) in sub-second intervals. A 2000ms pacer introduces crippling multi-second stalls across turns.
* **Action**:
  - Maintain default provider pacer delay at `200ms`.
  - Allow bursting up to configured RPM limits while smoothing out anti-429 bursts.

---

## 🚀 Execution & Verification Protocol

### Step 1: Run Invariant Unit Test Suite
```bash
bun test tests/benchmarking/streaming_reasoning_benchmark.test.ts
```
**Gate**: Must report `6 pass, 0 fail` with exit code 0.

### Step 2: Run Full Automated Benchmark Runner
```bash
tests/benchmarking/run_benchmarks.sh
```
**Gate**: Must output all green PASS markers for Health, Invariants, ox-alpha live streaming, and hy3-free multi-turn scrubbing.

### Step 3: Run OpenCode2 Live Tool & Reasoning Parity Check
```bash
# Test OpenRouter route
opencode2 run -m lr-or/stealth/ox-alpha --auto "Use bash to echo 'BENCHMARK_VERIFIED' and report what it printed."

# Test Zen route
opencode2 run -m lr-zn/hy3-free --auto "Use bash to echo 'BENCHMARK_VERIFIED' and report what it printed."
```
**Gate**: Both commands must execute tool calls, return exit code 0, and output identical answer structures to direct provider runs.

---

## 🚨 Failure Recovery & Troubleshooting

| Symptom | Root Cause | Remediation |
|---|---|---|
| TUI receives no thinking tokens | `determineShouldFilterReasoning` returning `true` | Ensure default is `false`; only filter on explicit `sb` nuance |
| Upstream returns HTTP 400 on turn 2 | `reasoning_content` leaking in message history | Check `scrubReasoningFromMessages()` in `transformMessages()` |
| High TTFT (> 5s) on reasoning models | First chunk buffering waiting for `content` | Verify `reasoning` and `thought` in `TOKEN_SIGNATURES` in `fetcher.ts` |
| Slow multi-turn loops | Pacer delay set to legacy 2000ms | Verify default is 200ms in `schema.ts`, `env.ts`, and `pacer.ts` |
