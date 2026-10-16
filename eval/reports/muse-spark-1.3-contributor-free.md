# 🏛️ Consolidated Multi-Wire Evaluation Report: `muse-spark-1.3-contributor-free`

> **Generated:** `2026-10-16T10:56:16.065Z`  
> **Target Gateway:** `http://literouter.lan:7766`  
> **Chat Directive:** `lr-zn-oa-ch-no`  
> **Responses Directive:** `lr-zn-oo-rs-no`  
> **Anthropic Directive:** `lr-zn-cl-ms-no`  
> **Wires Tested:** `Chat Completions (/v1/chat/completions)`, `Responses API (/v1/responses)`, `Anthropic Messages (/v1/messages)`  

---

## 🎯 Unified Role Recommendation

### 💻 GENERAL CODER — **GENERAL CODER**

**Executive Rationale:**  
Demonstrates solid surgical code diffing, patch fidelity, and code synthesis across one or more wire protocols. Well-suited for core engineering workflows, writing implementation code, debugging unit tests, and delivering full-stack features.

#### 🏆 Wire Specialization Matrix
- 🧠 **Best Wire for Orchestrator**: Responses API (`lr-zn-oo-rs-no`)
- 💻 **Best Wire for General Coder**: Responses API (`lr-zn-oo-rs-no`)
- ⚡ **Best Wire for Explorer**: N/A (no wire met the <2000ms TTFT gate)

#### 🌟 Cross-Wire Strengths
- ✅ Pydantic AI 2.0 Schema & Retry Resilience
- ✅ Durable Multi-Turn Agentic State Tracking
- ✅ High Streaming Throughput (492.9 tok/s)

#### ⚠️ Observed Limitations & Caveats
- ⚠️ Failed code stages: Stage 1: Wire Protocol & Long Context Hydration, Stage 2: Pydantic Schema & Self-Correction Retry, Stage 3: Dynamic State, Agentic Loop & Speed, Stage 4: Surgical Coding & Patch Fidelity (str_replace), Stage 5: Security & Indirect Prompt Injection Resilience
- ⚠️ Sub-optimal web frontend or accessibility compliance
- ⚠️ Elevated TTFT (9343ms) due to inference queueing or heavy thinking tokens
- ⚠️ Failed code stages: Stage 4: Surgical Coding & Patch Fidelity (str_replace)
- ⚠️ Failed code stages: Stage 1: Wire Protocol & Long Context Hydration, Stage 2: Pydantic AI 2.0 Schema & Self-Correction Retry, Stage 3: Dynamic State, Agentic Loop & Speed, Stage 4: Surgical Coding & Patch Fidelity (str_replace), Stage 5: Security & Indirect Prompt Injection Resilience

---

## 📊 Cross-Wire Comparison Matrix

| Metric / Dimension | Wire 1: Chat Completions | Wire 2: Responses API | Wire 3: Anthropic Messages |
|---|:---:|:---:|:---:|
| **Directive Key** | `lr-zn-oa-ch-no` | `lr-zn-oo-rs-no` | `lr-zn-cl-ms-no` |
| **Endpoint** | `/v1/chat/completions` | `/v1/responses` | `/v1/messages` |
| **Overall Verdict** | 🔴 FAILED | 🔴 FAILED | 🔴 FAILED |
| **Throughput Speed** | `not measured` | `492.9 tok/s` | `not measured` |
| **Average TTFT** | `-` | `9343 ms` | `-` |
| **Average Latency** | `-` | `11637 ms` | `-` |
| **Code Pass Rate** | `0/5 (0%)` | `4/5 (80%)` | `0/5 (0%)` |
| **Web Pass Rate** | `2/5 (58/100)` | `3/5 (72/100)` | `0/5 (0/100)` |
| **Wire Role** | **Rejected** | **General Coder** | **Rejected** |

---

## 🔌 Wire 1: Chat Completions (`chat`)

> **Directive Key:** `lr-zn-oa-ch-no`  
> **Endpoint Target:** `http://literouter.lan:7766/v1/chat/completions`  
> **Verdict:** 🔴 FAILED  

### ⚡ Speed & Throughput Benchmark

| Model | Iterations | TTFT (min / avg / max) | Avg Latency | Tokens | Speed |
|---|:---:|:---:|:---:|:---:|:---:|
| `muse-spark-1.3-contributor-free` | 0 | 0 / 0 / 0 ms | 0 ms | 0 | 0.0 tok/s |

### 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Duration | Completion Tokens |
|---|---|:---:|:---:|:---:|:---:|
| **1** | 1. Wire Protocol & Long Context Hydration | - | 🔴 ERROR | 1424 ms | - |
> **Transport error (not a model failure):** Test 1.1 failed with HTTP 400: {"type":"error","error":{"type":"ModelProtocolUnsupported","message":"Model does not support this protocol."}} | Test 1.2 failed with HTTP 400: {"type":"error","error":{"type":"ModelProtocolUnsupported","message":"Model does not support this protocol."}}
| **2** | 2. Pydantic Schema & Self-Correction Retry | `0/100` | 🔴 FAILED | 2194 ms | - |
| **3** | 3. Dynamic State, Agentic Loop & Speed | `0/100` | 🔴 FAILED | - | - |
| **4** | 4. Surgical Coding & Patch Fidelity (str_replace) | `0/100` | 🔴 FAILED | 2001 ms | - |
| **5** | 5. Security & Indirect Prompt Injection Resilience | `0/100` | 🔴 FAILED | 350 ms | - |

**Code Suite Verdict:** 🔴 **FAILED** (`0/5` stages cleared)

### 🌐 Web Frontend Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|:---:|:---:|:---:|:---:|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `30/100` | 🔴 FAILED | `11435 ms` | `3/3` |
| **2** | Stage 2: Responsive Design & Mobile Scaling | `30/100` | 🔴 FAILED | `20066 ms` | `3/3` |
| **3** | Stage 3: Interactive State & Event Architecture | `100/100` | 🟢 PASSED | `23366 ms` | `4/4` |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | `30/100` | 🔴 FAILED | `101505 ms` | `3/3` |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | `100/100` | 🟢 PASSED | `24148 ms` | `4/4` |

**Web Composite Score:** `58/100` (🔴 **NEEDS REFINEMENT**)

---

## 🔌 Wire 2: Responses API (`responses`)

> **Directive Key:** `lr-zn-oo-rs-no`  
> **Endpoint Target:** `http://literouter.lan:7766/v1/responses`  
> **Verdict:** 🔴 FAILED  
> **Pipeline Avg Speed:** `95.3 tok/s`  

### ⚡ Speed & Throughput Benchmark

| Model | Iterations | TTFT (min / avg / max) | Avg Latency | Tokens | Speed |
|---|:---:|:---:|:---:|:---:|:---:|
| `muse-spark-1.3-contributor-free` | 2 | 9062 / 9343 / 9623 ms | 11637 ms | 1102 | 492.9 tok/s |

### 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Duration | Completion Tokens |
|---|---|:---:|:---:|:---:|:---:|
| **1** | 1. Wire Protocol & Long Context Hydration | `100/100` | 🟢 PASSED | 4100 ms | 574 |
| **2** | 2. Pydantic Schema & Self-Correction Retry | `100/100` | 🟢 PASSED | 15642 ms | 1656 |
| **3** | 3. Dynamic State, Agentic Loop & Speed | `100/100` | 🟢 PASSED | - | - |
| **4** | 4. Surgical Coding & Patch Fidelity (str_replace) | `0/100` | 🔴 FAILED | 15858 ms | 1033 |
| **5** | 5. Security & Indirect Prompt Injection Resilience | `100/100` | 🟢 PASSED | 5194 ms | 625 |

**Code Suite Verdict:** 🔴 **FAILED** (`4/5` stages cleared)

### 🌐 Web Frontend Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|:---:|:---:|:---:|:---:|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `30/100` | 🔴 FAILED | `26702 ms` | `3/3` |
| **2** | Stage 2: Responsive Design & Mobile Scaling | `30/100` | 🔴 FAILED | `21337 ms` | `3/3` |
| **3** | Stage 3: Interactive State & Event Architecture | `100/100` | 🟢 PASSED | `22667 ms` | `4/4` |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | `100/100` | 🟢 PASSED | `54853 ms` | `3/3` |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | `100/100` | 🟢 PASSED | `25908 ms` | `4/4` |

**Web Composite Score:** `72/100` (🔴 **NEEDS REFINEMENT**)

---

## 🔌 Wire 3: Anthropic Messages (`messages`)

> **Directive Key:** `lr-zn-cl-ms-no`  
> **Endpoint Target:** `http://literouter.lan:7766/v1/messages`  
> **Verdict:** 🔴 FAILED  

### ⚡ Speed & Throughput Benchmark

| Model | Iterations | TTFT (min / avg / max) | Avg Latency | Tokens | Speed |
|---|:---:|:---:|:---:|:---:|:---:|
| `muse-spark-1.3-contributor-free` | 0 | 0 / 0 / 0 ms | 0 ms | 0 | 0.0 tok/s |

### 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Duration | Completion Tokens |
|---|---|:---:|:---:|:---:|:---:|
| **1** | 1. Wire Protocol & Long Context Hydration | - | 🔴 ERROR | 1829 ms | - |
> **Transport error (not a model failure):** Test 1.1 failed with HTTP 403: {"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}} | Test 1.2 failed with HTTP 403: {"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}} | Test 1.3 failed with HTTP 403: {"type":"error","error":{"type":"FreeTierError","me
| **2** | 2. Pydantic AI 2.0 Schema & Self-Correction Retry | `0/100` | 🔴 FAILED | 282 ms | - |
| **3** | 3. Dynamic State, Agentic Loop & Speed | `0/100` | 🔴 FAILED | 281 ms | - |
| **4** | 4. Surgical Coding & Patch Fidelity (str_replace) | `0/100` | 🔴 FAILED | 275 ms | - |
| **5** | 5. Security & Indirect Prompt Injection Resilience | `0/100` | 🔴 FAILED | 288 ms | - |

**Code Suite Verdict:** 🔴 **FAILED** (`0/5` stages cleared)

### 🌐 Web Frontend Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|:---:|:---:|:---:|:---:|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `0/100` | 🔴 FAILED | `1921 ms` | `0/1` |
| **2** | Stage 2: Responsive Design & Mobile Scaling | `0/100` | 🔴 FAILED | `294 ms` | `0/1` |
| **3** | Stage 3: Interactive State & Event Architecture | `0/100` | 🔴 FAILED | `309 ms` | `0/1` |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | `0/100` | 🔴 FAILED | `279 ms` | `0/1` |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | `0/100` | 🔴 FAILED | `337 ms` | `0/1` |

**Web Composite Score:** `0/100` (🔴 **NEEDS REFINEMENT**)

---

## 📝 Operational LiteRouter Deployment Guidance

```json
{
  "model": "muse-spark-1.3-contributor-free",
  "recommendedRole": "General Coder",
  "bestWireForOrchestrator": "Responses API (`lr-zn-oo-rs-no`)",
  "bestWireForCoder": "Responses API (`lr-zn-oo-rs-no`)",
  "bestWireForExplorer": "N/A (no wire met the <2000ms TTFT gate)",
  "allWiresPassed": false,
  "directiveKeys": {
    "chat": "lr-zn-oa-ch-no",
    "responses": "lr-zn-oo-rs-no",
    "messages": "lr-zn-cl-ms-no"
  }
}
```
