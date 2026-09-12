# 🏛️ Model Evaluation Report Card: `poolside/laguna-xs-2.1:free`

> **Generated:** `2026-09-11T13:21:29.282Z`  
> **Directive Key:** `lr-or-oa-ch-no`  
> **Wire Protocol:** `CHAT`  
> **Gateway Target:** `https://localhost:7766/v1/chat/completions`  
> **Evaluated Suites:** `speed, code, web`  

---

## 🎯 Architectural Role Recommendation

### ⚡ FAST EXPLORER — **EXPLORER**

**Recommendation Rationale:**  
Demonstrates high streaming velocity, responsive first-token arrival, or lightweight resource footprint. Best allocated to fast repository exploration, code search, initial issue triage, rapid prototyping, and high-frequency queries.

**Key Architectural Strengths:**
- ✅ Ultra-Low TTFT (651ms)
- ✅ High Streaming Throughput (89.5 tok/s)

**Operational Caveats & Boundaries:**
- ⚠️ Failed code stages: Stage 1: Wire Protocol & Long Context Hydration
- ⚠️ Sub-optimal web frontend or accessibility compliance

---

## ⚡ Speed & Throughput Benchmark

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Time to First Token (TTFT)** | `651 ms` (min: `651 ms`, max: `651 ms`) | `< 2,000 ms` | 🟢 Snappy |
| **Streaming Throughput** | `89.5 tok/s` | `> 30 tok/s` | 🟢 High |
| **Average Duration** | `61909 ms` | - | ℹ️ |
| **Average Output Tokens** | `5485 tokens` | - | ℹ️ |
| **Successful Benchmark Runs** | `1` | `>= 2` | 🟢 Complete |

---

## 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Notes & Observations |
|---|---|---|---|---|
| **1** | Stage 1: Wire Protocol & Long Context Hydration | `55/100` | 🔴 FAILED | Test 1.1 failed with HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"poolside/laguna-xs-2.1:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations","provider_name":"Poolside","is_byok":false,"limit_source":"upstream_provider_shared_pool","remedy_hint":"Retry shortly, add your own provider key (https://openrouter.ai/settings/integrations), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing"}},"user_id":"user_3C2NwCED33T0fX5W5q0n4p3KRjb"}; Test 1.3 partial: Emitted 1 tool calls (expected 3) |

**Code Suite Verdict:** 🔴 **REJECTED (CRITICAL GATES FAILED)** (`0/1` stages cleared)

---

## 🌐 Web Frontend & Vision-Language Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|---|---|---|---|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `0/100` | 🔴 FAILED | `46 ms` | `0/1` checks |

**Web Composite Score:** `0/100`  
**Web Suite Verdict:** 🔴 **NEEDS REFINEMENT**

---

## ⚡ Per-Stage Performance & Latency Profile

| Stage / Test | Duration | Tokens | Speed (tok/s) | Status |
|---|:---:|:---:|:---:|:---:|
| 1. Wire Protocol & Long Context Hydration | 891 ms | - | - | ❌ Failed |
| Web 1. Stage 1: DOM Structure & Layout Fidelity | 46 ms | - | - | ❌ Failed |
| **Pipeline Aggregate** | **937 ms** | **-** | **-** | ❌ Failed |

---

## 📊 Statistical Analysis (Runs: 2)

| Metric | Value | Interpretation |
|---|---|---|
| pass@1 (Sample Mean) | 0.0% | Single-attempt pass probability |
| pass@k | 0.0% | Success probability over k attempts |
| Median TTFT | 651.0 ms | 50th percentile time-to-first-token |
| p95 Latency | 61909.0 ms | Tail latency bound |
| Std Deviation | ±0.0 ms | Output consistency |
| 95% Confidence Interval | [651.0 ms, 651.0 ms] | Expected true mean range |

---

## 📝 Operational LiteRouter Deployment Guidance

```json
{
  "model": "poolside/laguna-xs-2.1:free",
  "recommendedRole": "Explorer",
  "wire": "chat",
  "directiveKey": "lr-or-oa-ch-no",
  "allPassed": false
}
```
