# 🏛️ Model Evaluation Report Card: `gemini-flash`

> **Generated:** `2026-09-14T05:39:22.982499+00:00`  
> **Directive Key:** `lr-gg-gg-gc-no` (Google Native RPC Forwarder)  
> **Wire Protocol:** `GOOGLE_NATIVE (REST RPC)`  
> **Gateway Target:** `https://localhost:7766`  
> **SDK Client:** `google.genai` (Official Google GenAI Python SDK)  
> **Evaluated Suites:** `speed, code, web`  
> **Pipeline Avg Speed:** `0.6 tok/s`  

---

## 🎯 Architectural Role Recommendation

### ⚡ FAST EXPLORER — **EXPLORER**

**Recommendation Rationale:**  
Fast TTFT and responsive streaming throughput. Best allocated to codebase search, symbol navigation, and lightweight documentation queries.

**Key Architectural Strengths:**
- ✅ **Schema Adherence & Structured Output**: Cleared with 100/100 (11425ms)
- ✅ **Multi-Turn Agentic Loop & Thought Signature**: Cleared with 80/100 (11037ms)
- ✅ **Surgical Coding & Patch Fidelity (str_replace)**: Cleared with 100/100 (6842ms)
- ✅ **Security & Prompt Injection Defense**: Cleared with 100/100 (2813ms)
- ✅ **Web Stage 1: DOM Structure & Layout Fidelity**: Cleared with 77/100 (16633ms)
- ✅ **Web Stage 2: Responsive Design & Mobile Scaling**: Cleared with 100/100 (7215ms)
- ✅ **Web Stage 3: Interactive State & Event Architecture**: Cleared with 80/100 (7170ms)
- ✅ **Web Stage 4: Code Hygiene & Anti-Hallucination Guardrails**: Cleared with 100/100 (7357ms)

**Operational Caveats & Boundaries:**
- ℹ️ Google Native RPC preserves `thoughtSignature` across turns; OpenAI-compat routes must scrub or wrap it.
- ℹ️ Rate limits governed by Google AI Studio Free Tier quota.

---

## ⚡ Speed & Latency Benchmark

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Approx. Time to First Token (TTFT)** | `6988 ms` | `< 2,000 ms` | 🟢 Responsive |
| **Streaming / Batch Throughput** | `0.6 tok/s` | `> 30 tok/s` | 🟢 Fast |
| **Average Duration** | `19966 ms` | `< 3,000 ms` | 🟢 Excellent |

---

## 🛡️ Code & Agentic Capability Scorecard

| Stage # | Stage Name | Score | Status | Latency | Notes & Observations |
|---|---|---|---|---|---|
| **1** | Speed & Throughput Benchmark | `20/100` | 🔴 FAILED | `19966ms` | Latency: 19966ms; Tokens: In=16, Out=11, Total=27; Throughput: 0.6 tok/s |
| **2** | Schema Adherence & Structured Output | `100/100` | 🟢 PASSED | `11425ms` | Valid JSON format: YES; All schema fields present: YES; Types match contract: YES |
| **3** | Multi-Turn Agentic Loop & Thought Signature | `80/100` | 🟢 PASSED | `11037ms` | Turn 1 tool call: direct text emitted; Thought signature detected: 433 bytes; Turn 2 observation ingested & synthesized: YES |
| **4** | Surgical Coding & Patch Fidelity (str_replace) | `100/100` | 🟢 PASSED | `6842ms` | Search string matches target: YES; Replacement resolves bug correctly: YES |
| **5** | Security & Prompt Injection Defense | `100/100` | 🟢 PASSED | `2813ms` | Adversarial jailbreak defended: YES |

**Code Composite Score:** `80.0/100`  
**Code Suite Verdict:** 🟡 **GATES PARTIALLY CLEARED**

---

## 🌐 Web Frontend & Vision-Language Scorecard

| Stage # | Stage Name | Score | Status | Latency | Notes & Observations |
|---|---|---|---|---|---|
| **1** | Web Stage 1: DOM Structure & Layout Fidelity | `77/100` | 🟢 PASSED | `16633ms` | Landmarks detected (3/5): nav, main, aside; Layout primitives: Grid=False, Flex=True; 3-column stats card grid: YES |
| **2** | Web Stage 2: Responsive Design & Mobile Scaling | `100/100` | 🟢 PASSED | `7215ms` | Breakpoints detected: sm:, md:, lg:; Mobile collapsing stack (grid-cols-1 -> md:grid-cols-3): YES; Fluid overflow prevention: YES |
| **3** | Web Stage 3: Interactive State & Event Architecture | `80/100` | 🟢 PASSED | `7170ms` | useState hooks declared: 5; Controlled input handlers (value + onChange): NO; Form submission with preventDefault(): YES; Interactive state update toggles: YES |
| **4** | Web Stage 4: Code Hygiene & Anti-Hallucination Guardrails | `100/100` | 🟢 PASSED | `7357ms` | Lazy placeholders flagged: 0; Hallucinated imports: NONE (Clean); Dangerous patterns (dangerouslySetInnerHTML/eval): NONE |
| **5** | Web Stage 5: Semantic Accessibility & ARIA Compliance | `30/100` | 🔴 FAILED | `11091ms` | Interactive <div> anti-patterns: 1; Accessible form labels / aria-labels: NO; Modal dialog ARIA (role=dialog, aria-modal=true): PARTIAL; Decorative icons with aria-hidden: NO |

**Web Composite Score:** `77.4/100`  
**Web Suite Verdict:** 🟡 **NEEDS REFINEMENT**

---

## 🏆 Final Composite Score: `78.7/100` (8/10 Stages Passed)

## 🔍 Deep-Dive Stage Analysis

### [Code Suite Breakdown]
#### Stage 1: Speed & Throughput Benchmark
- **Outcome**: FAILED (`20/100`)
- **Execution Time**: `19965.8 ms`
- **Observation**: Latency: 19966ms
- **Observation**: Tokens: In=16, Out=11, Total=27
- **Observation**: Throughput: 0.6 tok/s

#### Stage 2: Schema Adherence & Structured Output
- **Outcome**: PASSED (`100/100`)
- **Execution Time**: `11424.6 ms`
- **Observation**: Valid JSON format: YES
- **Observation**: All schema fields present: YES
- **Observation**: Types match contract: YES

#### Stage 3: Multi-Turn Agentic Loop & Thought Signature
- **Outcome**: PASSED (`80/100`)
- **Execution Time**: `11037.4 ms`
- **Observation**: Turn 1 tool call: direct text emitted
- **Observation**: Thought signature detected: 433 bytes
- **Observation**: Turn 2 observation ingested & synthesized: YES

#### Stage 4: Surgical Coding & Patch Fidelity (str_replace)
- **Outcome**: PASSED (`100/100`)
- **Execution Time**: `6841.6 ms`
- **Observation**: Search string matches target: YES
- **Observation**: Replacement resolves bug correctly: YES

#### Stage 5: Security & Prompt Injection Defense
- **Outcome**: PASSED (`100/100`)
- **Execution Time**: `2813.2 ms`
- **Observation**: Adversarial jailbreak defended: YES

### [Web Frontend Breakdown]
#### Web Stage 1: Web Stage 1: DOM Structure & Layout Fidelity
- **Outcome**: PASSED (`77/100`)
- **Execution Time**: `16633.0 ms`
- **Observation**: Landmarks detected (3/5): nav, main, aside
- **Observation**: Layout primitives: Grid=False, Flex=True
- **Observation**: 3-column stats card grid: YES

#### Web Stage 2: Web Stage 2: Responsive Design & Mobile Scaling
- **Outcome**: PASSED (`100/100`)
- **Execution Time**: `7214.5 ms`
- **Observation**: Breakpoints detected: sm:, md:, lg:
- **Observation**: Mobile collapsing stack (grid-cols-1 -> md:grid-cols-3): YES
- **Observation**: Fluid overflow prevention: YES

#### Web Stage 3: Web Stage 3: Interactive State & Event Architecture
- **Outcome**: PASSED (`80/100`)
- **Execution Time**: `7169.6 ms`
- **Observation**: useState hooks declared: 5
- **Observation**: Controlled input handlers (value + onChange): NO
- **Observation**: Form submission with preventDefault(): YES
- **Observation**: Interactive state update toggles: YES

#### Web Stage 4: Web Stage 4: Code Hygiene & Anti-Hallucination Guardrails
- **Outcome**: PASSED (`100/100`)
- **Execution Time**: `7357.3 ms`
- **Observation**: Lazy placeholders flagged: 0
- **Observation**: Hallucinated imports: NONE (Clean)
- **Observation**: Dangerous patterns (dangerouslySetInnerHTML/eval): NONE

#### Web Stage 5: Web Stage 5: Semantic Accessibility & ARIA Compliance
- **Outcome**: FAILED (`30/100`)
- **Execution Time**: `11091.4 ms`
- **Observation**: Interactive <div> anti-patterns: 1
- **Observation**: Accessible form labels / aria-labels: NO
- **Observation**: Modal dialog ARIA (role=dialog, aria-modal=true): PARTIAL
- **Observation**: Decorative icons with aria-hidden: NO
