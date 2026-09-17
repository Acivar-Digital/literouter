# 🏛️ Model Evaluation Report Card: `thinkingmachines/inkling-small:free`

> **Generated:** `2026-09-11T04:03:24.218Z`  
> **Directive Key:** `lr-or-oa-ch-no`  
> **Wire Protocol:** `CHAT`  
> **Gateway Target:** `https://localhost:7766/v1/chat/completions`  
> **Evaluated Suites:** `speed, code, web`  
> **Pipeline Avg Speed:** `27.3 tok/s`  

---

## 🎯 Architectural Role Recommendation

### 💻 GENERAL CODER — **GENERAL CODER**

**Recommendation Rationale:**  
Displays dependable code generation, AST patch fidelity, or responsive frontend authoring. Well-suited for core engineering workflows, writing implementation code, debugging unit tests, and delivering full-stack features.

**Key Architectural Strengths:**
- ✅ Pydantic AI 2.0 Schema & Retry Resilience
- ✅ Durable Multi-Turn Agentic State Tracking
- ✅ High Streaming Throughput (567.3 tok/s)

**Operational Caveats & Boundaries:**
- ⚠️ Elevated TTFT (5190ms) due to inference queueing or heavy thinking tokens
- ⚠️ Failed code stages: Stage 1: Wire Protocol & Long Context Hydration, Stage 4: Surgical Coding & Patch Fidelity (str_replace)
- ⚠️ Sub-optimal web frontend or accessibility compliance

---

## ⚡ Speed & Throughput Benchmark

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Time to First Token (TTFT)** | `5190 ms` (min: `4602 ms`, max: `5777 ms`) | `< 2,000 ms` | 🔴 High Latency |
| **Streaming Throughput** | `567.3 tok/s` | `> 30 tok/s` | 🟢 High |
| **Average Duration** | `5710 ms` | - | ℹ️ |
| **Average Output Tokens** | `289 tokens` | - | ℹ️ |
| **Successful Benchmark Runs** | `2` | `>= 2` | 🟢 Complete |

---

## 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Notes & Observations |
|---|---|---|---|---|
| **1** | Stage 1: Wire Protocol & Long Context Hydration | `40/100` | 🔴 FAILED | Test 1.1 failed: toolCalls=false, xmlLeak=false; Test 1.3 failed: No tool calls emitted in parallel |
| **2** | Stage 2: Pydantic AI 2.0 Schema & Self-Correction Retry | `100/100` | 🟢 PASSED | Passed verification |
| **3** | Stage 3: Dynamic State, Agentic Loop & Speed | `50/100` | 🟢 PASSED | Turn 1 selected unexpected tool: bash |
| **4** | Stage 4: Surgical Coding & Patch Fidelity (str_replace) | `0/100` | 🔴 FAILED | Model did not invoke edit_file tool in Test 4.1 |
| **5** | Stage 5: Security & Indirect Prompt Injection Resilience | `100/100` | 🟢 PASSED | Passed verification |

**Code Suite Verdict:** 🔴 **REJECTED (CRITICAL GATES FAILED)** (`3/5` stages cleared)

---

## 🌐 Web Frontend & Vision-Language Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|---|---|---|---|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `94/100` | 🟢 PASSED | `20064 ms` | `3/3` checks |
| **2** | Stage 2: Responsive Design & Mobile Scaling | `66/100` | 🔴 FAILED | `21065 ms` | `2/3` checks |
| **3** | Stage 3: Interactive State & Event Architecture | `80/100` | 🟢 PASSED | `14467 ms` | `4/4` checks |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | `0/100` | 🔴 FAILED | `1356 ms` | `0/1` checks |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | `100/100` | 🟢 PASSED | `6972 ms` | `4/4` checks |

**Web Composite Score:** `68/100`  
**Web Suite Verdict:** 🔴 **NEEDS REFINEMENT**

---

## ⚡ Per-Stage Performance & Latency Profile

| Stage / Test | Duration | Tokens | Speed (tok/s) | Status |
|---|:---:|:---:|:---:|:---:|
| 1. Wire Protocol & Long Context Hydration | 43952 ms | 55 | 1.3 tok/s | ❌ Failed |
| 2. Pydantic AI 2.0 Schema & Self-Correction Retry | 1610 ms | 104 | 64.6 tok/s | ✅ Passed |
| 3. Dynamic State, Agentic Loop & Speed | 4678 ms | 207 | 44.2 tok/s | ✅ Passed |
| 4. Surgical Coding & Patch Fidelity (str_replace) | 32444 ms | 1825 | 56.3 tok/s | ❌ Failed |
| 5. Security & Indirect Prompt Injection Resilience | 1540 ms | 108 | 70.1 tok/s | ✅ Passed |
| Web 1. Stage 1: DOM Structure & Layout Fidelity | 20064 ms | - | - | ✅ Passed |
| Web 2. Stage 2: Responsive Design & Mobile Scaling | 21065 ms | - | - | ❌ Failed |
| Web 3. Stage 3: Interactive State & Event Architecture | 14467 ms | - | - | ✅ Passed |
| Web 4. Stage 4: Code Hygiene & Anti-Hallucination Guardrails | 1356 ms | - | - | ❌ Failed |
| Web 5. Stage 5: Semantic Accessibility & ARIA Compliance | 6972 ms | - | - | ✅ Passed |
| **Pipeline Aggregate** | **148148 ms** | **2299** | **27.3 tok/s (avg)** | ❌ Failed |

---

## 📊 Statistical Analysis (Runs: 2)

| Metric | Value | Interpretation |
|---|---|---|
| pass@1 (Sample Mean) | 50.0% | Single-attempt pass probability |
| pass@k | 100.0% | Success probability over k attempts |
| Median TTFT | 5189.5 ms | 50th percentile time-to-first-token |
| p95 Latency | 6319.3 ms | Tail latency bound |
| Std Deviation | ±830.9 ms | Output consistency |
| 95% Confidence Interval | [4038.0 ms, 6341.0 ms] | Expected true mean range |

---

## 📝 Operational LiteRouter Deployment Guidance

```json
{
  "model": "thinkingmachines/inkling-small:free",
  "recommendedRole": "General Coder",
  "wire": "chat",
  "directiveKey": "lr-or-oa-ch-no",
  "allPassed": false
}
```
