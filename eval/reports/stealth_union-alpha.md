# 🏛️ Model Evaluation Report Card: `stealth/union-alpha`

> **Generated:** `2026-09-16T21:02:08.743Z`  
> **Directive Key:** `lr-or-oa-ch-ts`  
> **Wire Protocol:** `CHAT`  
> **Gateway Target:** `http://10.32.34.172:7766/v1/chat/completions`  
> **Evaluated Suites:** `speed, code, web`  

---

## 🎯 Architectural Role Recommendation

### ⚡ FAST EXPLORER — **EXPLORER**

**Recommendation Rationale:**  
Demonstrates high streaming velocity, responsive first-token arrival, or lightweight resource footprint. Best allocated to fast repository exploration, code search, initial issue triage, rapid prototyping, and high-frequency queries.

**Key Architectural Strengths:**
- ✅ High Streaming Throughput (5764.7 tok/s)

**Operational Caveats & Boundaries:**
- ⚠️ Elevated TTFT (37755ms) due to inference queueing or heavy thinking tokens
- ⚠️ Failed code stages: Stage 1: Wire Protocol & Long Context Hydration
- ⚠️ Sub-optimal web frontend or accessibility compliance

---

## ⚡ Speed & Throughput Benchmark

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Time to First Token (TTFT)** | `37755 ms` (min: `37755 ms`, max: `37755 ms`) | `< 2,000 ms` | 🔴 High Latency |
| **Streaming Throughput** | `5764.7 tok/s` | `> 30 tok/s` | 🟢 High |
| **Average Duration** | `37840 ms` | - | ℹ️ |
| **Average Output Tokens** | `490 tokens` | - | ℹ️ |
| **Successful Benchmark Runs** | `1` | `>= 2` | 🟢 Complete |

---

## 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Notes & Observations |
|---|---|---|---|---|
| **1** | Stage 1: Wire Protocol & Long Context Hydration | `0/100` | 🔴 FAILED | Test 1.1 failed with HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"stealth/union-alpha is temporarily rate-limited upstream. Please retry shortly.","provider_name":"Stealth","is_byok":false,"limit_source":"upstream_provider_shared_pool","remedy_hint":"Retry shortly, add your own provider key (https://openrouter.ai/settings/integrations), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing"}},"user_id":"user_3IfVny6SNCg0s2xIOaxQ89RyAXx"}; Test 1.2 failed with HTTP 429: {"type":"error","error":{"type":"rate_limit_error","message":"Provider returned error","error_type":"rate_limit_exceeded"},"request_id":"gen-1789592524-KrYPQWEyjICRToHfanTy","metadata":{"raw":"stealth/union-alpha is temporarily rate-limited upstream. Please retry shortly.","provider_name":"Stealth","is_byok":false,"limit_source":"upstream_provider_shared_pool","remedy_hint":"Retry shortly, add your own provider key (https://openrouter.ai/settings/integrations), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing"}}; Test 1.3 failed with HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"stealth/union-alpha is temporarily rate-limited upstream. Please retry shortly.","provider_name":"Stealth","is_byok":false,"limit_source":"upstream_provider_shared_pool","remedy_hint":"Retry shortly, add your own provider key (https://openrouter.ai/settings/integrations), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing"}},"user_id":"user_3C2Nv3kQ0KZL4Rd4z31q2i50R9J"} |

**Code Suite Verdict:** 🔴 **REJECTED (CRITICAL GATES FAILED)** (`0/1` stages cleared)

---

## 🌐 Web Frontend & Vision-Language Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|---|---|---|---|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `0/100` | 🔴 FAILED | `2105 ms` | `0/1` checks |

**Web Composite Score:** `0/100`  
**Web Suite Verdict:** 🔴 **NEEDS REFINEMENT**

---

## ⚡ Per-Stage Performance & Latency Profile

| Stage / Test | Duration | Tokens | Speed (tok/s) | Status |
|---|:---:|:---:|:---:|:---:|
| 1. Wire Protocol & Long Context Hydration | 2347 ms | - | - | ❌ Failed |
| Web 1. Stage 1: DOM Structure & Layout Fidelity | 2105 ms | - | - | ❌ Failed |
| **Pipeline Aggregate** | **4452 ms** | **-** | **-** | ❌ Failed |

---

## 📊 Statistical Analysis (Runs: 2)

| Metric | Value | Interpretation |
|---|---|---|
| pass@1 (Sample Mean) | 0.0% | Single-attempt pass probability |
| pass@k | 0.0% | Success probability over k attempts |
| Median TTFT | 37755.0 ms | 50th percentile time-to-first-token |
| p95 Latency | 37840.0 ms | Tail latency bound |
| Std Deviation | ±0.0 ms | Output consistency |
| 95% Confidence Interval | [37755.0 ms, 37755.0 ms] | Expected true mean range |

---

## 🧠 Reasoning Transcripts (Unscored Evidence)

> Raw upstream thinking captured via the `ts`-nuance directive key. 
> Qualitative evidence only — excluded from scores, verdicts, and role gating.

<details><summary>Stage 1: Wire Protocol & Long Context Hydration — no reasoning emitted by upstream</summary>

*(empty)*

</details>

---

## 📝 Operational LiteRouter Deployment Guidance

```json
{
  "model": "stealth/union-alpha",
  "recommendedRole": "Explorer",
  "wire": "chat",
  "directiveKey": "lr-or-oa-ch-ts",
  "allPassed": false
}
```
