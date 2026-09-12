# 🏛️ Model Evaluation Report Card: `poolside/laguna-s-2.1:free`

> **Generated:** `2026-09-11T13:32:01.118Z`  
> **Directive Key:** `lr-or-oa-ch-no`  
> **Wire Protocol:** `CHAT`  
> **Gateway Target:** `https://localhost:7766/v1/chat/completions`  
> **Evaluated Suites:** `speed, code, web`  
> **Pipeline Avg Speed:** `7.9 tok/s`  

---

## 🎯 Architectural Role Recommendation

### ⚡ FAST EXPLORER — **EXPLORER**

**Recommendation Rationale:**  
Demonstrates high streaming velocity, responsive first-token arrival, or lightweight resource footprint. Best allocated to fast repository exploration, code search, initial issue triage, rapid prototyping, and high-frequency queries.

**Key Architectural Strengths:**
- ✅ Pydantic AI 2.0 Schema & Retry Resilience
- ✅ High Streaming Throughput (49.7 tok/s)

**Operational Caveats & Boundaries:**
- ⚠️ Elevated TTFT (2545ms) due to inference queueing or heavy thinking tokens
- ⚠️ Failed code stages: Stage 3: Dynamic State, Agentic Loop & Speed
- ⚠️ Sub-optimal web frontend or accessibility compliance

---

## ⚡ Speed & Throughput Benchmark

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Time to First Token (TTFT)** | `2545 ms` (min: `1028 ms`, max: `4062 ms`) | `< 2,000 ms` | 🟡 Acceptable |
| **Streaming Throughput** | `49.7 tok/s` | `> 30 tok/s` | 🟢 High |
| **Average Duration** | `17275 ms` | - | ℹ️ |
| **Average Output Tokens** | `740 tokens` | - | ℹ️ |
| **Successful Benchmark Runs** | `2` | `>= 2` | 🟢 Complete |

---

## 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Notes & Observations |
|---|---|---|---|---|
| **1** | Stage 1: Wire Protocol & Long Context Hydration | `60/100` | 🟢 PASSED | Test 1.2 failed with HTTP 429: {"type":"error","error":{"type":"rate_limit_error","message":"Provider returned error","error_type":"rate_limit_exceeded"},"request_id":"gen-1789133508-76A3FH4ElEuKkLZITLsF","metadata":{"raw":"poolside/laguna-s-2.1:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations","provider_name":"Poolside","is_byok":false,"limit_source":"upstream_provider_shared_pool","remedy_hint":"Retry shortly, add your own provider key (https://openrouter.ai/settings/integrations), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing"}} |
| **2** | Stage 2: Pydantic AI 2.0 Schema & Self-Correction Retry | `70/100` | 🟢 PASSED | Test 2.1 failed with HTTP 429 |
| **3** | Stage 3: Dynamic State, Agentic Loop & Speed | `0/100` | 🔴 FAILED | Stage 3 Turn 1 failed with HTTP 429 |

**Code Suite Verdict:** 🔴 **REJECTED (CRITICAL GATES FAILED)** (`2/3` stages cleared)

---

## 🌐 Web Frontend & Vision-Language Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|---|---|---|---|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `0/100` | 🔴 FAILED | `51 ms` | `0/1` checks |

**Web Composite Score:** `0/100`  
**Web Suite Verdict:** 🔴 **NEEDS REFINEMENT**

---

## ⚡ Per-Stage Performance & Latency Profile

| Stage / Test | Duration | Tokens | Speed (tok/s) | Status |
|---|:---:|:---:|:---:|:---:|
| 1. Wire Protocol & Long Context Hydration | 5307 ms | 42 | 7.9 tok/s | ✅ Passed |
| 2. Pydantic AI 2.0 Schema & Self-Correction Retry | 842 ms | - | - | ✅ Passed |
| 3. Dynamic State, Agentic Loop & Speed | 840 ms | - | - | ❌ Failed |
| Web 1. Stage 1: DOM Structure & Layout Fidelity | 51 ms | - | - | ❌ Failed |
| **Pipeline Aggregate** | **7040 ms** | **42** | **7.9 tok/s (avg)** | ❌ Failed |

---

## 📊 Statistical Analysis (Runs: 2)

| Metric | Value | Interpretation |
|---|---|---|
| pass@1 (Sample Mean) | 50.0% | Single-attempt pass probability |
| pass@k | 100.0% | Success probability over k attempts |
| Median TTFT | 2545.0 ms | 50th percentile time-to-first-token |
| p95 Latency | 21069.4 ms | Tail latency bound |
| Std Deviation | ±2145.4 ms | Output consistency |
| 95% Confidence Interval | [-428.3 ms, 5518.3 ms] | Expected true mean range |

---

## 📝 Operational LiteRouter Deployment Guidance

```json
{
  "model": "poolside/laguna-s-2.1:free",
  "recommendedRole": "Explorer",
  "wire": "chat",
  "directiveKey": "lr-or-oa-ch-no",
  "allPassed": false
}
```
