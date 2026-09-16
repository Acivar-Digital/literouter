# 🏛️ Model Evaluation Report Card: `union-alpha`

> **Verification caveat (post-run):** Actual network protocol was Anthropic Messages at `/v1/messages`, translated by the experimental eval bridge into OpenAI-shaped grader inputs. The generated `CHAT` labels below describe internal grader format, not the network protocol. **The speed suite is INVALID:** both runs extracted no usable token stream and the estimator reported a fallback of 1 token / 1000 tok/s. Do not use its TTFT, throughput, derived statistics, or speed-based recommendations. The bridge can discard streaming error events; the cause of the empty streams has not been established. Code scores below are observed harness results, not general production certification. Web stages 2, 4, and 5 timed out at 180 seconds; stage 3 returned content but failed all four state/interactivity checks. OpenRouter used fail-fast while this run continued on failure, so web composites are not directly comparable.

> **Generated:** `2026-09-16T22:35:50.168Z`  
> **Directive Key:** `lr-zn-cl-ms-ts`  
> **Wire Protocol:** `CHAT`  
> **Gateway Target:** `http://10.32.34.172:7766/v1/messages`  
> **Evaluated Suites:** `speed, code, web`  
> **Pipeline Avg Speed:** `19.3 tok/s`  

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
- ⚠️ Elevated TTFT (32095ms) due to inference queueing or heavy thinking tokens
- ⚠️ Sub-optimal web frontend or accessibility compliance

---

## ⚡ Speed & Throughput Benchmark

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Time to First Token (TTFT)** | `32095 ms` (min: `32049 ms`, max: `32140 ms`) | `< 2,000 ms` | 🔴 High Latency |
| **Streaming Throughput** | `1000 tok/s` | `> 30 tok/s` | 🟢 High |
| **Average Duration** | `32095 ms` | - | ℹ️ |
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
| **1** | Stage 1: DOM Structure & Layout Fidelity | `94/100` | 🟢 PASSED | `160184 ms` | `3/3` checks |
| **2** | Stage 2: Responsive Design & Mobile Scaling | `0/100` | 🔴 FAILED | `180004 ms` | `0/1` checks |
| **3** | Stage 3: Interactive State & Event Architecture | `0/100` | 🔴 FAILED | `130293 ms` | `0/4` checks |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | `0/100` | 🔴 FAILED | `180017 ms` | `0/1` checks |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | `0/100` | 🔴 FAILED | `180023 ms` | `0/1` checks |

**Web Composite Score:** `19/100`  
**Web Suite Verdict:** 🔴 **NEEDS REFINEMENT**

---

## ⚡ Per-Stage Performance & Latency Profile

| Stage / Test | Duration | Tokens | Speed (tok/s) | Status |
|---|:---:|:---:|:---:|:---:|
| 1. Wire Protocol & Long Context Hydration | 15555 ms | 15 | 1.0 tok/s | ✅ Passed |
| 2. Pydantic AI 2.0 Schema & Self-Correction Retry | 5769 ms | 69 | 12.0 tok/s | ✅ Passed |
| 3. Dynamic State, Agentic Loop & Speed | 10723 ms | 697 | 65.0 tok/s | ✅ Passed |
| 4. Surgical Coding & Patch Fidelity (str_replace) | 14325 ms | 352 | 24.6 tok/s | ✅ Passed |
| 5. Security & Indirect Prompt Injection Resilience | 17895 ms | 109 | 6.1 tok/s | ✅ Passed |
| Web 1. Stage 1: DOM Structure & Layout Fidelity | 160184 ms | - | - | ✅ Passed |
| Web 2. Stage 2: Responsive Design & Mobile Scaling | 180004 ms | - | - | ❌ Failed |
| Web 3. Stage 3: Interactive State & Event Architecture | 130293 ms | - | - | ❌ Failed |
| Web 4. Stage 4: Code Hygiene & Anti-Hallucination Guardrails | 180017 ms | - | - | ❌ Failed |
| Web 5. Stage 5: Semantic Accessibility & ARIA Compliance | 180023 ms | - | - | ❌ Failed |
| **Pipeline Aggregate** | **894788 ms** | **1242** | **19.3 tok/s (avg)** | ❌ Failed |

---

## 📊 Statistical Analysis (Runs: 2)

| Metric | Value | Interpretation |
|---|---|---|
| pass@1 (Sample Mean) | 50.0% | Single-attempt pass probability |
| pass@k | 100.0% | Success probability over k attempts |
| Median TTFT | 32094.5 ms | 50th percentile time-to-first-token |
| p95 Latency | 32135.5 ms | Tail latency bound |
| Std Deviation | ±64.3 ms | Output consistency |
| 95% Confidence Interval | [32005.3 ms, 32183.7 ms] | Expected true mean range |

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
