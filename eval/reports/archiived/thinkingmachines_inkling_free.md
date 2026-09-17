# 🏛️ Model Evaluation Report Card: `thinkingmachines/inkling:free`

> **Generated:** `2026-09-11T04:04:10.252Z`  
> **Directive Key:** `lr-or-oa-ch-no`  
> **Wire Protocol:** `CHAT`  
> **Gateway Target:** `https://localhost:7766/v1/chat/completions`  
> **Evaluated Suites:** `speed, code, web`  
> **Pipeline Avg Speed:** `19.2 tok/s`  

---

## 🎯 Architectural Role Recommendation

### ⚡ FAST EXPLORER — **EXPLORER**

**Recommendation Rationale:**  
Demonstrates high streaming velocity, responsive first-token arrival, or lightweight resource footprint. Best allocated to fast repository exploration, code search, initial issue triage, rapid prototyping, and high-frequency queries.

**Key Architectural Strengths:**
- ✅ Pydantic AI 2.0 Schema & Retry Resilience
- ✅ High Streaming Throughput (285.8 tok/s)

**Operational Caveats & Boundaries:**
- ⚠️ Elevated TTFT (20055ms) due to inference queueing or heavy thinking tokens
- ⚠️ Failed code stages: Stage 1: Wire Protocol & Long Context Hydration, Stage 3: Dynamic State, Agentic Loop & Speed, Stage 4: Surgical Coding & Patch Fidelity (str_replace)
- ⚠️ Sub-optimal web frontend or accessibility compliance

---

## ⚡ Speed & Throughput Benchmark

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Time to First Token (TTFT)** | `20055 ms` (min: `6363 ms`, max: `33747 ms`) | `< 2,000 ms` | 🔴 High Latency |
| **Streaming Throughput** | `285.8 tok/s` | `> 30 tok/s` | 🟢 High |
| **Average Duration** | `21178 ms` | - | ℹ️ |
| **Average Output Tokens** | `301 tokens` | - | ℹ️ |
| **Successful Benchmark Runs** | `2` | `>= 2` | 🟢 Complete |

---

## 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Notes & Observations |
|---|---|---|---|---|
| **1** | Stage 1: Wire Protocol & Long Context Hydration | `40/100` | 🔴 FAILED | Test 1.1 failed: toolCalls=false, xmlLeak=false; Test 1.3 failed: No tool calls emitted in parallel |
| **2** | Stage 2: Pydantic AI 2.0 Schema & Self-Correction Retry | `100/100` | 🟢 PASSED | Passed verification |
| **3** | Stage 3: Dynamic State, Agentic Loop & Speed | `0/100` | 🔴 FAILED | Turn 1 selected unexpected tool: bash |
| **4** | Stage 4: Surgical Coding & Patch Fidelity (str_replace) | `0/100` | 🔴 FAILED | Model did not invoke edit_file tool in Test 4.1 |
| **5** | Stage 5: Security & Indirect Prompt Injection Resilience | `100/100` | 🟢 PASSED | Passed verification |

**Code Suite Verdict:** 🔴 **REJECTED (CRITICAL GATES FAILED)** (`2/5` stages cleared)

---

## 🌐 Web Frontend & Vision-Language Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|---|---|---|---|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `100/100` | 🟢 PASSED | `24487 ms` | `3/3` checks |
| **2** | Stage 2: Responsive Design & Mobile Scaling | `0/100` | 🔴 FAILED | `49450 ms` | `0/1` checks |
| **3** | Stage 3: Interactive State & Event Architecture | `90/100` | 🟢 PASSED | `18154 ms` | `4/4` checks |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | `100/100` | 🟢 PASSED | `18180 ms` | `3/3` checks |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | `75/100` | 🔴 FAILED | `10669 ms` | `3/4` checks |

**Web Composite Score:** `73/100`  
**Web Suite Verdict:** 🔴 **NEEDS REFINEMENT**

---

## ⚡ Per-Stage Performance & Latency Profile

| Stage / Test | Duration | Tokens | Speed (tok/s) | Status |
|---|:---:|:---:|:---:|:---:|
| 1. Wire Protocol & Long Context Hydration | 1771 ms | 55 | 31.1 tok/s | ❌ Failed |
| 2. Pydantic AI 2.0 Schema & Self-Correction Retry | 9843 ms | 104 | 10.6 tok/s | ✅ Passed |
| 3. Dynamic State, Agentic Loop & Speed | 15209 ms | 149 | 9.8 tok/s | ❌ Failed |
| 4. Surgical Coding & Patch Fidelity (str_replace) | 8063 ms | 256 | 31.7 tok/s | ❌ Failed |
| 5. Security & Indirect Prompt Injection Resilience | 1270 ms | 129 | 101.6 tok/s | ✅ Passed |
| Web 1. Stage 1: DOM Structure & Layout Fidelity | 24487 ms | - | - | ✅ Passed |
| Web 2. Stage 2: Responsive Design & Mobile Scaling | 49450 ms | - | - | ❌ Failed |
| Web 3. Stage 3: Interactive State & Event Architecture | 18154 ms | - | - | ✅ Passed |
| Web 4. Stage 4: Code Hygiene & Anti-Hallucination Guardrails | 18180 ms | - | - | ✅ Passed |
| Web 5. Stage 5: Semantic Accessibility & ARIA Compliance | 10669 ms | - | - | ❌ Failed |
| **Pipeline Aggregate** | **157096 ms** | **693** | **19.2 tok/s (avg)** | ❌ Failed |

---

## 📊 Statistical Analysis (Runs: 2)

| Metric | Value | Interpretation |
|---|---|---|
| pass@1 (Sample Mean) | 50.0% | Single-attempt pass probability |
| pass@k | 100.0% | Success probability over k attempts |
| Median TTFT | 20055.0 ms | 50th percentile time-to-first-token |
| p95 Latency | 33266.8 ms | Tail latency bound |
| Std Deviation | ±19363.4 ms | Output consistency |
| 95% Confidence Interval | [-6781.3 ms, 46891.3 ms] | Expected true mean range |

---

## 📝 Operational LiteRouter Deployment Guidance

```json
{
  "model": "thinkingmachines/inkling:free",
  "recommendedRole": "Explorer",
  "wire": "chat",
  "directiveKey": "lr-or-oa-ch-no",
  "allPassed": false
}
```
