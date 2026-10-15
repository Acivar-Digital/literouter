# 🏛️ Consolidated Multi-Wire Evaluation Report: `inclusionai/ling-3.0-flash-sante:free`

> **Generated:** `2026-10-07T04:20:11.718Z`  
> **Target Gateway:** `http://literouter.lan:7766`  
> **Chat Directive:** `lr-or-oa-ch-no`  
> **Responses Directive:** `lr-or-oo-rs-no`  
> **Anthropic Directive:** `lr-or-cl-ms-no`  
> **Wires Tested:** `Chat Completions (/v1/chat/completions)`, `Responses API (/v1/responses)`, `Anthropic Messages (/v1/messages)`  

---

## 🎯 Unified Role Recommendation

### ⚡ FAST EXPLORER — **EXPLORER**

**Executive Rationale:**  
Recommended for fast browsing, repo exploration, and symbol navigation.

#### 🏆 Wire Specialization Matrix
- 🧠 **Best Wire for Orchestrator**: Responses API (`lr-or-oo-rs-no`)
- 💻 **Best Wire for General Coder**: Chat Completions (`lr-or-oa-ch-no`)
- ⚡ **Best Wire for Explorer**: Anthropic Messages (`194.5 tok/s` (1230ms TTFT))

#### 🌟 Cross-Wire Strengths
- ✅ High Streaming Throughput (726.4 tok/s)
- ✅ High Streaming Throughput (780.5 tok/s)
- ✅ High Streaming Throughput (194.5 tok/s)

#### ⚠️ Observed Limitations & Caveats
- ⚠️ Elevated TTFT (21285ms) due to inference queueing or heavy thinking tokens
- ⚠️ Failed code stages: Stage 1: Wire Protocol & Long Context Hydration
- ⚠️ Sub-optimal web frontend or accessibility compliance
- ⚠️ Elevated TTFT (9141ms) due to inference queueing or heavy thinking tokens

---

## 📊 Cross-Wire Comparison Matrix

| Metric / Dimension | Wire 1: Chat Completions | Wire 2: Responses API | Wire 3: Anthropic Messages |
|---|:---:|:---:|:---:|
| **Directive Key** | `lr-or-oa-ch-no` | `lr-or-oo-rs-no` | `lr-or-cl-ms-no` |
| **Endpoint** | `/v1/chat/completions` | `/v1/responses` | `/v1/messages` |
| **Overall Verdict** | 🔴 FAILED | 🔴 FAILED | 🔴 FAILED |
| **Throughput Speed** | `726.4 tok/s` | `780.5 tok/s` | `194.5 tok/s` |
| **Average TTFT** | `21285 ms` | `9141 ms` | `1230 ms` |
| **Average Latency** | `23474 ms` | `10872 ms` | `8252 ms` |
| **Code Pass Rate** | `0/1 (0%)` | `0/1 (0%)` | `0/1 (0%)` |
| **Web Pass Rate** | `0/1 (0/100)` | `1/2 (58/100)` | `0/1 (0/100)` |
| **Wire Role** | **Explorer** | **Explorer** | **Explorer** |

---

## 🔌 Wire 1: Chat Completions (`chat`)

> **Directive Key:** `lr-or-oa-ch-no`  
> **Endpoint Target:** `http://literouter.lan:7766/v1/chat/completions`  
> **Verdict:** 🔴 FAILED  
> **Pipeline Avg Speed:** `28.9 tok/s`  

### ⚡ Speed & Throughput Benchmark

| Model | Iterations | TTFT (min / avg / max) | Avg Latency | Tokens | Speed |
|---|:---:|:---:|:---:|:---:|:---:|
| `inclusionai/ling-3.0-flash-sante:free` | 2 | 7918 / 21285 / 34652 ms | 23474 ms | 1581 | 726.4 tok/s |

### 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Duration | Completion Tokens |
|---|---|:---:|:---:|:---:|:---:|
| **1** | 1. Wire Protocol & Long Context Hydration | `40/100` | 🔴 FAILED | 1142 ms | 33 |
| **2** | 2. Pydantic AI 2.0 Schema & Self-Correction Retry | - | ⏭️ SKIPPED | - | - |
| **3** | 3. Dynamic State, Agentic Loop & Speed | - | ⏭️ SKIPPED | - | - |
| **4** | 4. Surgical Coding & Patch Fidelity (str_replace) | - | ⏭️ SKIPPED | - | - |
| **5** | 5. Security & Indirect Prompt Injection Resilience | - | ⏭️ SKIPPED | - | - |

**Code Suite Verdict:** 🔴 **FAILED** (`0/1` stages cleared)

### 🌐 Web Frontend Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|:---:|:---:|:---:|:---:|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `0/100` | 🔴 FAILED | `300 ms` | `0/1` |
| **2** | Stage 2: Responsive Design & Mobile Scaling | - | ⏭️ SKIPPED | - | - |
| **3** | Stage 3: Interactive State & Event Architecture | - | ⏭️ SKIPPED | - | - |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | - | ⏭️ SKIPPED | - | - |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | - | ⏭️ SKIPPED | - | - |

**Web Composite Score:** `0/100` (🔴 **NEEDS REFINEMENT**)

---

## 🔌 Wire 2: Responses API (`responses`)

> **Directive Key:** `lr-or-oo-rs-no`  
> **Endpoint Target:** `http://literouter.lan:7766/v1/responses`  
> **Verdict:** 🔴 FAILED  

### ⚡ Speed & Throughput Benchmark

| Model | Iterations | TTFT (min / avg / max) | Avg Latency | Tokens | Speed |
|---|:---:|:---:|:---:|:---:|:---:|
| `inclusionai/ling-3.0-flash-sante:free` | 1 | 9141 / 9141 / 9141 ms | 10872 ms | 1351 | 780.5 tok/s |

### 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Duration | Completion Tokens |
|---|---|:---:|:---:|:---:|:---:|
| **1** | 1. Wire Protocol & Long Context Hydration | - | 🔴 ERROR | 2825 ms | - |
> **Transport error (not a model failure):** Test 1.1 failed with HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"inclusionai/ling-3.0-flash-sante:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations","provider_name":"Novita","is_byok":false,"limit_source":"upstream_provider_shared_pool","remedy_hint":"Retry shortly, add your own provider key (https://openrouter.ai/settings/integrations), or rout
| **2** | 2. Pydantic AI 2.0 Schema & Self-Correction Retry | - | ⏭️ SKIPPED | - | - |
| **3** | 3. Dynamic State, Agentic Loop & Speed | - | ⏭️ SKIPPED | - | - |
| **4** | 4. Surgical Coding & Patch Fidelity (str_replace) | - | ⏭️ SKIPPED | - | - |
| **5** | 5. Security & Indirect Prompt Injection Resilience | - | ⏭️ SKIPPED | - | - |

**Code Suite Verdict:** 🔴 **ERROR** (upstream unreachable — model not evaluated) (`0/1` stages cleared)

### 🌐 Web Frontend Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|:---:|:---:|:---:|:---:|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `100/100` | 🟢 PASSED | `17652 ms` | `3/3` |
| **2** | Stage 2: Responsive Design & Mobile Scaling | `15/100` | 🔴 FAILED | `77713 ms` | `0/3` |
| **3** | Stage 3: Interactive State & Event Architecture | - | ⏭️ SKIPPED | - | - |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | - | ⏭️ SKIPPED | - | - |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | - | ⏭️ SKIPPED | - | - |

**Web Composite Score:** `58/100` (🔴 **NEEDS REFINEMENT**)

---

## 🔌 Wire 3: Anthropic Messages (`messages`)

> **Directive Key:** `lr-or-cl-ms-no`  
> **Endpoint Target:** `http://literouter.lan:7766/v1/messages`  
> **Verdict:** 🔴 FAILED  

### ⚡ Speed & Throughput Benchmark

| Model | Iterations | TTFT (min / avg / max) | Avg Latency | Tokens | Speed |
|---|:---:|:---:|:---:|:---:|:---:|
| `inclusionai/ling-3.0-flash-sante:free` | 2 | 1083 / 1230 / 1377 ms | 8252 ms | 1405 | 194.5 tok/s |

### 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Duration | Completion Tokens |
|---|---|:---:|:---:|:---:|:---:|
| **1** | 1. Wire Protocol & Long Context Hydration | `30/100` | 🔴 FAILED | 2814 ms | - |
| **2** | 2. Pydantic AI 2.0 Schema & Self-Correction Retry | - | ⏭️ SKIPPED | - | - |
| **3** | 3. Dynamic State, Agentic Loop & Speed | - | ⏭️ SKIPPED | - | - |
| **4** | 4. Surgical Coding & Patch Fidelity (str_replace) | - | ⏭️ SKIPPED | - | - |
| **5** | 5. Security & Indirect Prompt Injection Resilience | - | ⏭️ SKIPPED | - | - |

**Code Suite Verdict:** 🔴 **FAILED** (`0/1` stages cleared)

### 🌐 Web Frontend Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|:---:|:---:|:---:|:---:|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `0/100` | 🔴 FAILED | `310 ms` | `0/1` |
| **2** | Stage 2: Responsive Design & Mobile Scaling | - | ⏭️ SKIPPED | - | - |
| **3** | Stage 3: Interactive State & Event Architecture | - | ⏭️ SKIPPED | - | - |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | - | ⏭️ SKIPPED | - | - |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | - | ⏭️ SKIPPED | - | - |

**Web Composite Score:** `0/100` (🔴 **NEEDS REFINEMENT**)

---

## 🔍 Upstream Reasoning Transcripts (Empirical Audit)

<details><summary>[Anthropic Messages] Stage 1: Wire Protocol & Long Context Hydration — transcript 1 (218 chars)</summary>

The user wants me to read three files simultaneously: 'a.ts', 'b.ts', and 'c.ts'. Since these are independent read operations with no dependencies between them, I can make all three calls in parallel in a single block.

</details>

---

## 📝 Operational LiteRouter Deployment Guidance

```json
{
  "model": "inclusionai/ling-3.0-flash-sante:free",
  "recommendedRole": "Explorer",
  "bestWireForOrchestrator": "Responses API (`lr-or-oo-rs-no`)",
  "bestWireForCoder": "Chat Completions (`lr-or-oa-ch-no`)",
  "bestWireForExplorer": "Anthropic Messages (`194.5 tok/s` (1230ms TTFT))",
  "allWiresPassed": false,
  "directiveKeys": {
    "chat": "lr-or-oa-ch-no",
    "responses": "lr-or-oo-rs-no",
    "messages": "lr-or-cl-ms-no"
  }
}
```
