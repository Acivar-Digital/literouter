# 🏛️ Model Evaluation Report Card: `stealth/union-alpha`

> **Verified run limitations — OpenRouter:** Requests ran through LiteRouter. **The reported 76,950 tok/s is not a reliable inference-speed measurement:** the two samples delivered 529 and 481 counted tokens within only 5 ms and 10 ms after the first observed token, respectively, following 37–50 seconds of initial latency. Delivery buffering/batching is a possible explanation, not a confirmed cause. Do not use this throughput or its derived recommendations to rank providers. All five code stages passed the harness, not a general production-readiness assessment. Web stages 2, 4, and 5 timed out at 180 seconds; their zero scores represent incomplete execution rather than graded output quality. Both provider runs used two requested iterations, all suites, and continue-on-failure; Zen used an experimental Messages adapter, so this is a comparison of complete request paths, not isolated model quality.

> **Generated:** `2026-09-17T00:20:15.579Z`  
> **Directive Key:** `lr-or-oa-ch-ts`  
> **Wire Protocol:** `CHAT`  
> **Gateway Target:** `http://10.32.34.172:7766/v1/chat/completions`  
> **Evaluated Suites:** `speed, code, web`  
> **Pipeline Avg Speed:** `46.8 tok/s`  

---

## 🎯 Architectural Role Recommendation

### 🧠 MASTER ORCHESTRATOR — **ORCHESTRATOR**

**Recommendation Rationale:**  
Excels in structured output generation, durable multi-turn context retention, and strict schema validation. Prime candidate for orchestrating multi-agent pipelines, beads tracking, complex tool invocations, and supervisor duties.

**Key Architectural Strengths:**
- ✅ Pydantic AI 2.0 Schema & Retry Resilience
- ✅ Durable Multi-Turn Agentic State Tracking
- ✅ Surgical Diff & Code Patch Fidelity
- ✅ 100% Code Certification Gates Passed
- ✅ High Streaming Throughput (76950 tok/s)

**Operational Caveats & Boundaries:**
- ⚠️ Elevated TTFT (43532ms) due to inference queueing or heavy thinking tokens
- ⚠️ Sub-optimal web frontend or accessibility compliance

---

## ⚡ Speed & Throughput Benchmark

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Time to First Token (TTFT)** | `43532 ms` (min: `36964 ms`, max: `50099 ms`) | `< 2,000 ms` | 🔴 High Latency |
| **Streaming Throughput** | `76950 tok/s` | `> 30 tok/s` | 🟢 High |
| **Average Duration** | `43539 ms` | - | ℹ️ |
| **Average Output Tokens** | `505 tokens` | - | ℹ️ |
| **Successful Benchmark Runs** | `2` | `>= 2` | 🟢 Complete |

---

## 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Notes & Observations |
|---|---|---|---|---|
| **1** | Stage 1: Wire Protocol & Long Context Hydration | `100/100` | 🟢 PASSED | Passed verification |
| **2** | Stage 2: Pydantic AI 2.0 Schema & Self-Correction Retry | `100/100` | 🟢 PASSED | Passed verification |
| **3** | Stage 3: Dynamic State, Agentic Loop & Speed | `100/100` | 🟢 PASSED | Passed verification |
| **4** | Stage 4: Surgical Coding & Patch Fidelity (str_replace) | `100/100` | 🟢 PASSED | Passed verification |
| **5** | Stage 5: Security & Indirect Prompt Injection Resilience | `100/100` | 🟢 PASSED | Passed verification |

**Code Suite Verdict:** 🟢 **CERTIFIED PRODUCTION READY** (`5/5` stages cleared)

---

## 🌐 Web Frontend & Vision-Language Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|---|---|---|---|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `100/100` | 🟢 PASSED | `32924 ms` | `3/3` checks |
| **2** | Stage 2: Responsive Design & Mobile Scaling | `0/100` | 🔴 FAILED | `180006 ms` | `0/1` checks |
| **3** | Stage 3: Interactive State & Event Architecture | `100/100` | 🟢 PASSED | `43932 ms` | `4/4` checks |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | `0/100` | 🔴 FAILED | `180002 ms` | `0/1` checks |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | `0/100` | 🔴 FAILED | `180028 ms` | `0/1` checks |

**Web Composite Score:** `40/100`  
**Web Suite Verdict:** 🔴 **NEEDS REFINEMENT**

---

## ⚡ Per-Stage Performance & Latency Profile

| Stage / Test | Duration | Tokens | Speed (tok/s) | Status |
|---|:---:|:---:|:---:|:---:|
| 1. Wire Protocol & Long Context Hydration | 1296 ms | 34 | 26.2 tok/s | ✅ Passed |
| 2. Pydantic AI 2.0 Schema & Self-Correction Retry | 3897 ms | 73 | 18.7 tok/s | ✅ Passed |
| 3. Dynamic State, Agentic Loop & Speed | 15172 ms | 606 | 39.9 tok/s | ✅ Passed |
| 4. Surgical Coding & Patch Fidelity (str_replace) | 4299 ms | 370 | 86.1 tok/s | ✅ Passed |
| 5. Security & Indirect Prompt Injection Resilience | 4262 ms | 270 | 63.4 tok/s | ✅ Passed |
| Web 1. Stage 1: DOM Structure & Layout Fidelity | 32924 ms | - | - | ✅ Passed |
| Web 2. Stage 2: Responsive Design & Mobile Scaling | 180006 ms | - | - | ❌ Failed |
| Web 3. Stage 3: Interactive State & Event Architecture | 43932 ms | - | - | ✅ Passed |
| Web 4. Stage 4: Code Hygiene & Anti-Hallucination Guardrails | 180002 ms | - | - | ❌ Failed |
| Web 5. Stage 5: Semantic Accessibility & ARIA Compliance | 180028 ms | - | - | ❌ Failed |
| **Pipeline Aggregate** | **645818 ms** | **1353** | **46.8 tok/s (avg)** | ❌ Failed |

---

## 📊 Statistical Analysis (Runs: 2)

| Metric | Value | Interpretation |
|---|---|---|
| pass@1 (Sample Mean) | 50.0% | Single-attempt pass probability |
| pass@k | 100.0% | Success probability over k attempts |
| Median TTFT | 43531.5 ms | 50th percentile time-to-first-token |
| p95 Latency | 49452.0 ms | Tail latency bound |
| Std Deviation | ±9287.8 ms | Output consistency |
| 95% Confidence Interval | [30659.2 ms, 56403.8 ms] | Expected true mean range |

---

## 🧠 Reasoning Transcripts (Unscored Evidence)

> Raw upstream thinking captured via the `ts`-nuance directive key. 
> Qualitative evidence only — excluded from scores, verdicts, and role gating.

<details><summary>Stage 1: Wire Protocol & Long Context Hydration — no reasoning emitted by upstream</summary>

*(empty)*

</details>

<details><summary>Stage 2: Pydantic AI 2.0 Schema & Self-Correction Retry — no reasoning emitted by upstream</summary>

*(empty)*

</details>

<details><summary>Stage 3: Dynamic State, Agentic Loop & Speed — no reasoning emitted by upstream</summary>

*(empty)*

</details>

<details><summary>Stage 4: Surgical Coding & Patch Fidelity (str_replace) — no reasoning emitted by upstream</summary>

*(empty)*

</details>

<details><summary>Stage 5: Security & Indirect Prompt Injection Resilience — no reasoning emitted by upstream</summary>

*(empty)*

</details>

---

## 📝 Operational LiteRouter Deployment Guidance

```json
{
  "model": "stealth/union-alpha",
  "recommendedRole": "Orchestrator",
  "wire": "chat",
  "directiveKey": "lr-or-oa-ch-ts",
  "allPassed": false
}
```
