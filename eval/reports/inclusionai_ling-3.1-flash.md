# 🏛️ Consolidated Multi-Wire Evaluation Report: `inclusionai/ling-3.1-flash`

> **Generated:** `2026-10-07T04:16:04.897Z`  
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
- ⚡ **Best Wire for Explorer**: N/A (no wire met the <2000ms TTFT gate)

#### ⚠️ Observed Limitations & Caveats
- ⚠️ Failed code stages: Stage 1: Wire Protocol & Long Context Hydration
- ⚠️ Sub-optimal web frontend or accessibility compliance

---

## 📊 Cross-Wire Comparison Matrix

| Metric / Dimension | Wire 1: Chat Completions | Wire 2: Responses API | Wire 3: Anthropic Messages |
|---|:---:|:---:|:---:|
| **Directive Key** | `lr-or-oa-ch-no` | `lr-or-oo-rs-no` | `lr-or-cl-ms-no` |
| **Endpoint** | `/v1/chat/completions` | `/v1/responses` | `/v1/messages` |
| **Overall Verdict** | 🔴 ERROR (upstream) | 🔴 ERROR (upstream) | 🔴 ERROR (upstream) |
| **Throughput Speed** | `not measured` | `not measured` | `not measured` |
| **Average TTFT** | `-` | `-` | `-` |
| **Average Latency** | `-` | `-` | `-` |
| **Code Pass Rate** | `0/1 (0%)` | `0/1 (0%)` | `0/1 (0%)` |
| **Web Pass Rate** | `0/1 (0/100)` | `0/1 (0/100)` | `0/1 (0/100)` |
| **Wire Role** | **Explorer** | **Explorer** | **Explorer** |

---

## 🔌 Wire 1: Chat Completions (`chat`)

> **Directive Key:** `lr-or-oa-ch-no`  
> **Endpoint Target:** `http://literouter.lan:7766/v1/chat/completions`  
> **Verdict:** 🔴 ERROR (upstream)  

### ⚡ Speed & Throughput Benchmark

| Model | Iterations | TTFT (min / avg / max) | Avg Latency | Tokens | Speed |
|---|:---:|:---:|:---:|:---:|:---:|
| `inclusionai/ling-3.1-flash` | 0 | 0 / 0 / 0 ms | 0 ms | 0 | 0.0 tok/s |

### 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Duration | Completion Tokens |
|---|---|:---:|:---:|:---:|:---:|
| **1** | 1. Wire Protocol & Long Context Hydration | - | 🔴 ERROR | 369 ms | - |
> **Transport error (not a model failure):** Test 1.1 failed with HTTP 403: {"error":{"message":"Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/3022dc8711e70bf0119d6375efa5e8c830f8923e2f3287ce4b0bf019a8f8e4d2","code":403}} | Test 1.2 failed with HTTP 403: {"type":"error","error":{"type":"permission_error","message":"Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/16d8f8c2171d14de9459658f305040edd1e41fd615c2712f76669084fb3878b3","error_type":"pe
| **2** | 2. Pydantic AI 2.0 Schema & Self-Correction Retry | - | ⏭️ SKIPPED | - | - |
| **3** | 3. Dynamic State, Agentic Loop & Speed | - | ⏭️ SKIPPED | - | - |
| **4** | 4. Surgical Coding & Patch Fidelity (str_replace) | - | ⏭️ SKIPPED | - | - |
| **5** | 5. Security & Indirect Prompt Injection Resilience | - | ⏭️ SKIPPED | - | - |

**Code Suite Verdict:** 🔴 **ERROR** (upstream unreachable — model not evaluated) (`0/1` stages cleared)

### 🌐 Web Frontend Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|:---:|:---:|:---:|:---:|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `0/100` | 🔴 FAILED | `483 ms` | `0/1` |
| **2** | Stage 2: Responsive Design & Mobile Scaling | - | ⏭️ SKIPPED | - | - |
| **3** | Stage 3: Interactive State & Event Architecture | - | ⏭️ SKIPPED | - | - |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | - | ⏭️ SKIPPED | - | - |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | - | ⏭️ SKIPPED | - | - |

**Web Composite Score:** `0/100` (🔴 **NEEDS REFINEMENT**)

---

## 🔌 Wire 2: Responses API (`responses`)

> **Directive Key:** `lr-or-oo-rs-no`  
> **Endpoint Target:** `http://literouter.lan:7766/v1/responses`  
> **Verdict:** 🔴 ERROR (upstream)  

### ⚡ Speed & Throughput Benchmark

| Model | Iterations | TTFT (min / avg / max) | Avg Latency | Tokens | Speed |
|---|:---:|:---:|:---:|:---:|:---:|
| `inclusionai/ling-3.1-flash` | 0 | 0 / 0 / 0 ms | 0 ms | 0 | 0.0 tok/s |

### 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Duration | Completion Tokens |
|---|---|:---:|:---:|:---:|:---:|
| **1** | 1. Wire Protocol & Long Context Hydration | - | 🔴 ERROR | 473 ms | - |
> **Transport error (not a model failure):** Test 1.1 failed with HTTP 403: {"error":{"message":"Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/a24873c4dce3596395846a1094ff954608fbb3530b80016d27c49de0bb676e9c","code":403}} | Test 1.2 failed with HTTP 403: {"error":{"message":"Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/489fd48a7fb1dd9be74e4d205ecf2a573539299e2220e1fd5fd95c61f1429377","code":403}}
| **2** | 2. Pydantic AI 2.0 Schema & Self-Correction Retry | - | ⏭️ SKIPPED | - | - |
| **3** | 3. Dynamic State, Agentic Loop & Speed | - | ⏭️ SKIPPED | - | - |
| **4** | 4. Surgical Coding & Patch Fidelity (str_replace) | - | ⏭️ SKIPPED | - | - |
| **5** | 5. Security & Indirect Prompt Injection Resilience | - | ⏭️ SKIPPED | - | - |

**Code Suite Verdict:** 🔴 **ERROR** (upstream unreachable — model not evaluated) (`0/1` stages cleared)

### 🌐 Web Frontend Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|:---:|:---:|:---:|:---:|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `0/100` | 🔴 FAILED | `467 ms` | `0/1` |
| **2** | Stage 2: Responsive Design & Mobile Scaling | - | ⏭️ SKIPPED | - | - |
| **3** | Stage 3: Interactive State & Event Architecture | - | ⏭️ SKIPPED | - | - |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | - | ⏭️ SKIPPED | - | - |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | - | ⏭️ SKIPPED | - | - |

**Web Composite Score:** `0/100` (🔴 **NEEDS REFINEMENT**)

---

## 🔌 Wire 3: Anthropic Messages (`messages`)

> **Directive Key:** `lr-or-cl-ms-no`  
> **Endpoint Target:** `http://literouter.lan:7766/v1/messages`  
> **Verdict:** 🔴 ERROR (upstream)  

### ⚡ Speed & Throughput Benchmark

| Model | Iterations | TTFT (min / avg / max) | Avg Latency | Tokens | Speed |
|---|:---:|:---:|:---:|:---:|:---:|
| `inclusionai/ling-3.1-flash` | 0 | 0 / 0 / 0 ms | 0 ms | 0 | 0.0 tok/s |

### 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Duration | Completion Tokens |
|---|---|:---:|:---:|:---:|:---:|
| **1** | 1. Wire Protocol & Long Context Hydration | - | 🔴 ERROR | 336 ms | - |
> **Transport error (not a model failure):** Test 1.1 failed with HTTP 403: {"type":"error","error":{"type":"permission_error","message":"Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/1147bc44b3b157fc8f056f45ad5f7600f54afaa217f86e665b0e3cf42da1b1fe","error_type":"permission_denied"},"request_id":"gen-1791346562-5QKZb3dko7j5ZpTH2576"} | Test 1.2 failed with HTTP 403: {"type":"error","error":{"type":"permission_error","message":"Key limit exceeded (total limit). Manage it using https://openro
| **2** | 2. Pydantic AI 2.0 Schema & Self-Correction Retry | - | ⏭️ SKIPPED | - | - |
| **3** | 3. Dynamic State, Agentic Loop & Speed | - | ⏭️ SKIPPED | - | - |
| **4** | 4. Surgical Coding & Patch Fidelity (str_replace) | - | ⏭️ SKIPPED | - | - |
| **5** | 5. Security & Indirect Prompt Injection Resilience | - | ⏭️ SKIPPED | - | - |

**Code Suite Verdict:** 🔴 **ERROR** (upstream unreachable — model not evaluated) (`0/1` stages cleared)

### 🌐 Web Frontend Scorecard

| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |
|---|---|:---:|:---:|:---:|:---:|
| **1** | Stage 1: DOM Structure & Layout Fidelity | `0/100` | 🔴 FAILED | `476 ms` | `0/1` |
| **2** | Stage 2: Responsive Design & Mobile Scaling | - | ⏭️ SKIPPED | - | - |
| **3** | Stage 3: Interactive State & Event Architecture | - | ⏭️ SKIPPED | - | - |
| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | - | ⏭️ SKIPPED | - | - |
| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | - | ⏭️ SKIPPED | - | - |

**Web Composite Score:** `0/100` (🔴 **NEEDS REFINEMENT**)

---

## 📝 Operational LiteRouter Deployment Guidance

```json
{
  "model": "inclusionai/ling-3.1-flash",
  "recommendedRole": "Explorer",
  "bestWireForOrchestrator": "Responses API (`lr-or-oo-rs-no`)",
  "bestWireForCoder": "Chat Completions (`lr-or-oa-ch-no`)",
  "bestWireForExplorer": "N/A (no wire met the <2000ms TTFT gate)",
  "allWiresPassed": false,
  "directiveKeys": {
    "chat": "lr-or-oa-ch-no",
    "responses": "lr-or-oo-rs-no",
    "messages": "lr-or-cl-ms-no"
  }
}
```
