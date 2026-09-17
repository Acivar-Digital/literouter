# 🏛️ Model Evaluation Report Card: `union-alpha`

> **Generated:** `2026-09-17T01:45:54.684Z`  
> **Directive Key:** `lr-zn-cl-ms-ts`  
> **Wire Protocol:** `CHAT`  
> **Gateway Target:** `http://192.168.50.10:7766/v1/messages`  
> **Evaluated Suites:** `speed, code, web`  
> **Pipeline Avg Speed:** `31.7 tok/s`  

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
- ✅ High Streaming Throughput (1000 tok/s)

**Operational Caveats & Boundaries:**
- ⚠️ Elevated TTFT (31344ms) due to inference queueing or heavy thinking tokens
- ⚠️ Sub-optimal web frontend or accessibility compliance

---

## ⚡ Speed & Throughput Benchmark

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Time to First Token (TTFT)** | `31344 ms` (min: `30171 ms`, max: `32517 ms`) | `< 2,000 ms` | 🔴 High Latency |
| **Streaming Throughput** | `1000 tok/s` | `> 30 tok/s` | 🟢 High |
| **Average Duration** | `31344 ms` | - | ℹ️ |
| **Average Output Tokens** | `1 tokens` | - | ℹ️ |
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
| **1** | Stage 1: DOM Structure & Layout Fidelity | `100/100` | 🟢 PASSED | `32200 ms` | `3/3` checks |
| **2** | Stage 2: Responsive Design & Mobile Scaling | `100/100` | 🟢 PASSED | `171798 ms` | `3/3` checks |
| **3** | Stage 3: Interactive State & Event Architecture | `0/100` | 🔴 FAILED | `126638 ms` | `0/1` checks |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | `—` | ⏭️ SKIPPED | `—` | Aborted: Stage 3 failed in fail-fast mode |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | `—` | ⏭️ SKIPPED | `—` | Aborted: Stage 3 failed in fail-fast mode |

**Web Composite Score:** `67/100`  
**Web Suite Verdict:** 🔴 **NEEDS REFINEMENT**

---

## ⚡ Per-Stage Performance & Latency Profile

| Stage / Test | Duration | Tokens | Speed (tok/s) | Status |
|---|:---:|:---:|:---:|:---:|
| 1. Wire Protocol & Long Context Hydration | 12004 ms | 15 | 1.2 tok/s | ✅ Passed |
| 2. Pydantic AI 2.0 Schema & Self-Correction Retry | 5927 ms | 95 | 16.0 tok/s | ✅ Passed |
| 3. Dynamic State, Agentic Loop & Speed | 12839 ms | 519 | 40.4 tok/s | ✅ Passed |
| 4. Surgical Coding & Patch Fidelity (str_replace) | 23566 ms | 1103 | 46.8 tok/s | ✅ Passed |
| 5. Security & Indirect Prompt Injection Resilience | 6487 ms | 199 | 30.7 tok/s | ✅ Passed |
| Web 1. Stage 1: DOM Structure & Layout Fidelity | 32200 ms | - | - | ✅ Passed |
| Web 2. Stage 2: Responsive Design & Mobile Scaling | 171798 ms | - | - | ✅ Passed |
| Web 3. Stage 3: Interactive State & Event Architecture | 126638 ms | - | - | ❌ Failed |
| Web 4. Stage 4: Code Hygiene & Anti-Hallucination Guardrails | - | - | - | ⏭️ Skipped (Fail-Fast: Stage 3) |
| Web 5. Stage 5: Semantic Accessibility & ARIA Compliance | - | - | - | ⏭️ Skipped (Fail-Fast: Stage 3) |
| **Pipeline Aggregate** | **391459 ms** | **1931** | **31.7 tok/s (avg)** | ❌ Failed |

---

## 📊 Statistical Analysis (Runs: 2)

| Metric | Value | Interpretation |
|---|---|---|
| pass@1 (Sample Mean) | 100.0% | Single-attempt pass probability |
| pass@k | 100.0% | Success probability over k attempts |
| Median TTFT | 31344.0 ms | 50th percentile time-to-first-token |
| p95 Latency | 32399.7 ms | Tail latency bound |
| Std Deviation | ±1658.9 ms | Output consistency |
| 95% Confidence Interval | [29044.9 ms, 33643.1 ms] | Expected true mean range |

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
  "model": "union-alpha",
  "recommendedRole": "Orchestrator",
  "wire": "chat",
  "directiveKey": "lr-zn-cl-ms-ts",
  "allPassed": false
}
```
