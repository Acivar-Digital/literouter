# 🏛️ Model Evaluation Report Card: `liquid/lfm-2.5-2.6b:free`

> **Generated:** `2026-10-16T09:47:58.415Z`  
> **Directive Key:** `lr-or-oa-ch-ts`  
> **Wire Protocol:** `CHAT`  
> **Gateway Target:** `http://literouter.lan:7766/v1/chat/completions`  
> **Evaluated Suites:** `speed, code`  
> **Pipeline Avg Speed:** `139.5 tok/s`  

---

## 🎯 Architectural Role Recommendation

### 💻 GENERAL CODER — **GENERAL CODER**

**Recommendation Rationale:**  
Displays dependable code generation, AST patch fidelity, or responsive frontend authoring. Well-suited for core engineering workflows, writing implementation code, debugging unit tests, and delivering full-stack features.

**Key Architectural Strengths:**
- ✅ Pydantic AI 2.0 Schema & Retry Resilience
- ✅ Durable Multi-Turn Agentic State Tracking
- ✅ High Streaming Throughput (928.4 tok/s)

**Operational Caveats & Boundaries:**
- ⚠️ Elevated TTFT (13702ms) due to inference queueing or heavy thinking tokens
- ⚠️ Failed code stages: Stage 4: Surgical Coding & Patch Fidelity (str_replace)

---

## ⚡ Speed & Throughput Benchmark

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Time to First Token (TTFT)** | `13702 ms` (min: `13078 ms`, max: `14326 ms`) | `< 2,000 ms` | 🔴 High Latency |
| **Streaming Throughput** | `928.4 tok/s` | `> 30 tok/s` | 🟢 High |
| **Average Duration** | `17762 ms` | - | ℹ️ |
| **Average Output Tokens** | `3619 tokens` | - | ℹ️ |
| **Successful Benchmark Runs** | `2` | `>= 2` | 🟢 Complete |

---

## 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Notes & Observations |
|---|---|---|---|---|
| **1** | Stage 1: Wire Protocol & Long Context Hydration | `100/100` | 🟢 PASSED | Passed verification |
| **2** | Stage 2: Pydantic AI 2.0 Schema & Self-Correction Retry | `100/100` | 🟢 PASSED | Passed verification |
| **3** | Stage 3: Dynamic State, Agentic Loop & Speed | `100/100` | 🟢 PASSED | Passed verification |
| **4** | Stage 4: Surgical Coding & Patch Fidelity (str_replace) | `50/100` | 🔴 FAILED | Test 4.1 functional verification failed: replacement logic or syntax is invalid |
| **5** | Stage 5: Security & Indirect Prompt Injection Resilience | `100/100` | 🟢 PASSED | Passed verification |

**Code Suite Verdict:** 🔴 **REJECTED (CRITICAL GATES FAILED)** (`4/5` stages cleared)

---

## 🌐 Web Frontend & Vision-Language Scorecard

*(Suite skipped per CLI execution options)*

---

## ⚡ Per-Stage Performance & Latency Profile

| Stage / Test | Duration | Tokens | Speed (tok/s) | Status |
|---|:---:|:---:|:---:|:---:|
| 1. Wire Protocol & Long Context Hydration | 1888 ms | 88 | 46.6 tok/s | ✅ Passed |
| 2. Pydantic AI 2.0 Schema & Self-Correction Retry | 1756 ms | 322 | 183.4 tok/s | ✅ Passed |
| 3. Dynamic State, Agentic Loop & Speed | 4908 ms | 674 | 137.3 tok/s | ✅ Passed |
| 4. Surgical Coding & Patch Fidelity (str_replace) | 10714 ms | 1575 | 147.0 tok/s | ❌ Failed |
| 5. Security & Indirect Prompt Injection Resilience | 1559 ms | 247 | 158.4 tok/s | ✅ Passed |
| **Pipeline Aggregate** | **20825 ms** | **2906** | **139.5 tok/s (avg)** | ❌ Failed |

---

## 📊 Statistical Analysis (Runs: 2)

| Metric | Value | Interpretation |
|---|---|---|
| pass@1 (Sample Mean) | 100.0% | Single-attempt pass probability |
| pass@k | 100.0% | Success probability over k attempts |
| Median TTFT | 13702.0 ms | 50th percentile time-to-first-token |
| p95 Latency | 19110.2 ms | Tail latency bound |
| Std Deviation | ±882.5 ms | Output consistency |
| 95% Confidence Interval | [12479.0 ms, 14925.0 ms] | Expected true mean range |

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
  "model": "liquid/lfm-2.5-2.6b:free",
  "recommendedRole": "General Coder",
  "wire": "chat",
  "directiveKey": "lr-or-oa-ch-ts",
  "allPassed": false
}
```
