# 🏛️ Model Evaluation Report Card: `inclusionai/ling-3.0-flash-vl:free`

> **Generated:** `2026-09-11T04:39:32.417Z`  
> **Directive Key:** `lr-or-oa-ch-no`  
> **Wire Protocol:** `CHAT`  
> **Gateway Target:** `https://localhost:7766/v1/chat/completions`  
> **Evaluated Suites:** `speed, code, web`  
> **Pipeline Avg Speed:** `76.9 tok/s`  

---

## 🎯 Architectural Role Recommendation

### 💻 GENERAL CODER — **GENERAL CODER**

**Recommendation Rationale:**  
Displays dependable code generation, AST patch fidelity, or responsive frontend authoring. Well-suited for core engineering workflows, writing implementation code, debugging unit tests, and delivering full-stack features.

**Key Architectural Strengths:**
- ✅ Pydantic AI 2.0 Schema & Retry Resilience
- ✅ Durable Multi-Turn Agentic State Tracking
- ✅ High Streaming Throughput (136.6 tok/s)

**Operational Caveats & Boundaries:**
- ⚠️ Elevated TTFT (3136ms) due to inference queueing or heavy thinking tokens
- ⚠️ Failed code stages: Stage 1: Wire Protocol & Long Context Hydration, Stage 4: Surgical Coding & Patch Fidelity (str_replace)
- ⚠️ Sub-optimal web frontend or accessibility compliance

---

## ⚡ Speed & Throughput Benchmark

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Time to First Token (TTFT)** | `3136 ms` (min: `2477 ms`, max: `3794 ms`) | `< 2,000 ms` | 🔴 High Latency |
| **Streaming Throughput** | `136.6 tok/s` | `> 30 tok/s` | 🟢 High |
| **Average Duration** | `8858 ms` | - | ℹ️ |
| **Average Output Tokens** | `782 tokens` | - | ℹ️ |
| **Successful Benchmark Runs** | `2` | `>= 2` | 🟢 Complete |

---

## 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Notes & Observations |
|---|---|---|---|---|
| **1** | Stage 1: Wire Protocol & Long Context Hydration | `0/100` | 🔴 FAILED | Test 1.1 failed: toolCalls=false, xmlLeak=false; Test 1.2 failed: Model did not emit FileReadTool under long context.; Test 1.3 failed: No tool calls emitted in parallel |
| **2** | Stage 2: Pydantic AI 2.0 Schema & Self-Correction Retry | `60/100` | 🟢 PASSED | Test 2.2 exception: SyntaxError: JSON Parse error: Unexpected EOF |
| **3** | Stage 3: Dynamic State, Agentic Loop & Speed | `50/100` | 🟢 PASSED | Passed verification |
| **4** | Stage 4: Surgical Coding & Patch Fidelity (str_replace) | `0/100` | 🔴 FAILED | Model did not invoke edit_file tool in Test 4.1 |
| **5** | Stage 5: Security & Indirect Prompt Injection Resilience | `100/100` | 🟢 PASSED | Passed verification |

**Code Suite Verdict:** 🔴 **REJECTED (CRITICAL GATES FAILED)** (`3/5` stages cleared)

---

## 🌐 Web Frontend & Vision-Language Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|---|---|---|---|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `10/100` | 🔴 FAILED | `56751 ms` | `0/3` checks |
| **2** | Stage 2: Responsive Design & Mobile Scaling | `58/100` | 🔴 FAILED | `57451 ms` | `2/3` checks |
| **3** | Stage 3: Interactive State & Event Architecture | `0/100` | 🔴 FAILED | `11628 ms` | `0/1` checks |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | `0/100` | 🔴 FAILED | `14364 ms` | `0/1` checks |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | `75/100` | 🔴 FAILED | `34625 ms` | `3/4` checks |

**Web Composite Score:** `29/100`  
**Web Suite Verdict:** 🔴 **NEEDS REFINEMENT**

---

## ⚡ Per-Stage Performance & Latency Profile

| Stage / Test | Duration | Tokens | Speed (tok/s) | Status |
|---|:---:|:---:|:---:|:---:|
| 1. Wire Protocol & Long Context Hydration | 1314 ms | 39 | 29.7 tok/s | ❌ Failed |
| 2. Pydantic AI 2.0 Schema & Self-Correction Retry | 2706 ms | 117 | 43.2 tok/s | ✅ Passed |
| 3. Dynamic State, Agentic Loop & Speed | 6949 ms | 570 | 82.0 tok/s | ✅ Passed |
| 4. Surgical Coding & Patch Fidelity (str_replace) | 2645 ms | 237 | 89.6 tok/s | ❌ Failed |
| 5. Security & Indirect Prompt Injection Resilience | 3113 ms | 323 | 103.8 tok/s | ✅ Passed |
| Web 1. Stage 1: DOM Structure & Layout Fidelity | 56751 ms | - | - | ❌ Failed |
| Web 2. Stage 2: Responsive Design & Mobile Scaling | 57451 ms | - | - | ❌ Failed |
| Web 3. Stage 3: Interactive State & Event Architecture | 11628 ms | - | - | ❌ Failed |
| Web 4. Stage 4: Code Hygiene & Anti-Hallucination Guardrails | 14364 ms | - | - | ❌ Failed |
| Web 5. Stage 5: Semantic Accessibility & ARIA Compliance | 34625 ms | - | - | ❌ Failed |
| **Pipeline Aggregate** | **191546 ms** | **1286** | **76.9 tok/s (avg)** | ❌ Failed |

---

## 📊 Statistical Analysis (Runs: 2)

| Metric | Value | Interpretation |
|---|---|---|
| pass@1 (Sample Mean) | 50.0% | Single-attempt pass probability |
| pass@k | 100.0% | Success probability over k attempts |
| Median TTFT | 3135.5 ms | 50th percentile time-to-first-token |
| p95 Latency | 9771.5 ms | Tail latency bound |
| Std Deviation | ±931.3 ms | Output consistency |
| 95% Confidence Interval | [1844.8 ms, 4426.2 ms] | Expected true mean range |

---

## 📝 Operational LiteRouter Deployment Guidance

```json
{
  "model": "inclusionai/ling-3.0-flash-vl:free",
  "recommendedRole": "General Coder",
  "wire": "chat",
  "directiveKey": "lr-or-oa-ch-no",
  "allPassed": false
}
```
